import crypto from 'node:crypto';
import { createFailureReceipt, createReceipt } from '../receipt.js';
import { StepError, ERROR_CODES } from '../errors.js';
import { parseDesktopSubmitArgs } from '../args.js';
import { defaultLogPath, writeJsonlLog } from '../logger.js';
import { loadCalibrationProfile } from './calibration-store.js';
import { getStandardWindowBounds, resolveAnchorPoint } from './geometry.js';
import {
  clickPoint,
  delay,
  focusWindow,
  getClipboardText,
  getForegroundWindow,
  getUrlViaOmnibox,
  getWindowRect,
  pasteClipboard,
  pressEnter,
  resizeWindow,
  sendKeys,
  sendText,
  setClipboardText,
  uiaGetFocusedElement,
  uiaInvoke,
  uiaQuery,
  uiaReadText,
  uiaSetFocus
} from './windows-input.js';
import { chooseVerifiedChatGptWindow, isChatGptUrl } from './window-targeting.js';

const CHATGPT_URL = 'https://chatgpt.com/';
const CHATGPT_HOST = 'chatgpt.com';
const COMPOSER_FOCUS_SETTLE_MS = 220;
const PASTE_KEY_DELAY_MS = 90;
const POST_PASTE_SETTLE_MS = 320;
const OMNIBOX_HINTS = [
  '주소창',
  'address',
  'search',
  'omnibox',
  'url',
  'view_1012',
  'omniboxviewviews'
];

function enforceDesktopFirstConstraints(args) {
  if (args.project) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-constraints', 'Desktop transport does not support --project yet. Use submit-browser-chatgpt or --transport=browser.');
  }
  if (args.attachments?.length) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-constraints', 'Desktop transport does not support --attachment yet. Use submit-browser-chatgpt or --transport=browser.');
  }
  if (args.mode && args.mode !== 'auto') {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-constraints', 'Desktop transport currently supports only --mode auto. Use submit-browser-chatgpt or --transport=browser for browser-side mode selection.');
  }
  if (args.newChat) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-constraints', 'Desktop transport does not support --new-chat yet. Use submit-browser-chatgpt or --transport=browser.');
  }
}

export async function submitDesktopChatgpt(argv = []) {
  let lastStep = 'start';
  let currentUrl = CHATGPT_URL;
  let lastWindow = null;
  let lastFocusedElement = null;
  let clipboardHash = null;
  let logPath = null;
  const notes = [];

  try {
    const args = await parseDesktopSubmitArgs(argv);
    enforceDesktopFirstConstraints(args);
    logPath = defaultLogPath(`desktop-submit-${args.calibrationProfile}`);

    lastStep = 'load-calibration-profile';
    const calibration = await loadCalibrationProfile(args.calibrationProfile, {
      baseDir: args.calibrationDir
    });
    const targetBounds = getStandardWindowBounds(calibration);
    const titleHint = args.windowTitle || calibration?.window?.titleHint || 'ChatGPT';
    const promptPoint = resolveAnchorPoint(calibration, 'promptInput', targetBounds);
    const submitPoint = resolveAnchorPoint(calibration, 'submitButton', targetBounds);

    notes.push('transport=desktop');
    notes.push('transportStatus=default');
    notes.push('fallbackOrder=UIA-composer-only>calibrated-coordinates');
    notes.push('desktopMode=deterministic-uia-composer-only');
    notes.push(`calibrationProfile=${args.calibrationProfile}`);
    notes.push(`titleHint=${titleHint}`);
    notes.push(`targetBounds=${targetBounds.x},${targetBounds.y},${targetBounds.width},${targetBounds.height}`);
    notes.push(`promptPoint=${promptPoint.x},${promptPoint.y}`);
    notes.push(`submitPoint=${submitPoint.x},${submitPoint.y}`);

    await writeJsonlLog(logPath, {
      step: 'init',
      dryRun: args.dryRun,
      submit: args.submit,
      calibrationProfile: args.calibrationProfile,
      titleHint,
      targetBounds
    });

    if (process.env.SKIP_DESKTOP_AUTOMATION === '1' || process.env.SKIP_BROWSER_AUTOMATION === '1') {
      notes.push('desktopAutomation=skipped');
      notes.push(`promptHash=${hashText(args.prompt)}`);
      return createReceipt({
        submitted: false,
        modeResolved: 'desktop-chatgpt',
        projectResolved: null,
        url: CHATGPT_URL,
        notes
      });
    }

    lastStep = 'select-window';
    const windowSelection = await chooseVerifiedChatGptWindow(titleHint);
    const selectedWindow = windowSelection.selectedWindow;
    lastWindow = selectedWindow;
    notes.push(`windowHandle=${selectedWindow.handle}`);
    notes.push(`windowTitle=${selectedWindow.title}`);
    if (windowSelection.evidence?.reasons?.length) {
      notes.push(`targetEvidence=${windowSelection.evidence.reasons.join('+')}`);
    }
    await writeJsonlLog(logPath, { step: lastStep, selectedWindow, targetEvidence: windowSelection.evidence, candidates: windowSelection.candidates });

    lastStep = 'focus-window';
    const focusWindowResult = await stabilizeWindowFocus(selectedWindow.handle, args.stepDelayMs);
    await writeJsonlLog(logPath, { step: lastStep, handle: selectedWindow.handle, focusWindowResult });
    notes.push(`windowFocusProof=${focusWindowResult.proof}`);

    lastStep = 'normalize-window';
    await resizeWindow(targetBounds, selectedWindow.handle);
    const normalizedWindow = await waitForWindowRectStability(selectedWindow.handle, targetBounds, args.stepDelayMs);
    lastWindow = normalizedWindow.window;
    await writeJsonlLog(logPath, { step: lastStep, window: lastWindow, normalizedWindow });

    lastStep = 'navigate-chatgpt';
    const navigation = await navigateToChatGpt(selectedWindow.handle, CHATGPT_URL, args.stepDelayMs);
    currentUrl = navigation.currentUrl;
    await writeJsonlLog(logPath, { step: lastStep, navigation });
    notes.push(`navigationProof=${navigation.proof}`);

    lastStep = 'verify-url-after-navigation';
    const urlCheck = await readCurrentUrl(selectedWindow.handle).catch(() => '');
    currentUrl = String(urlCheck || '').trim() || currentUrl || CHATGPT_URL;
    const currentUrlLooksValid = isChatGptUrl(currentUrl);
    await writeJsonlLog(logPath, { step: lastStep, currentUrl, currentUrlLooksValid });
    if (!currentUrlLooksValid) {
      notes.push(`staleOmniboxUrl=${truncateForNote(currentUrl)}`);
      notes.push('urlVerificationDegraded=ignored-non-url-omnibox-echo');
      currentUrl = CHATGPT_URL;
    }

    lastStep = 'dismiss-interstitials';
    const dismissal = await dismissInterferingUi(selectedWindow.handle, args.stepDelayMs);
    if (dismissal?.acted) {
      notes.push(`dismissedUi=${dismissal.method}`);
    }
    await writeJsonlLog(logPath, { step: lastStep, dismissal });

    lastStep = 'normalize-zoom';
    await sendKeys('0', ['ctrl']);
    await delay(args.stepDelayMs);
    await writeJsonlLog(logPath, { step: lastStep });

    lastStep = 'focus-prompt';
    const promptFocus = await focusPromptBox(selectedWindow.handle, promptPoint, args.stepDelayMs);
    lastFocusedElement = promptFocus.focusedElement ?? null;
    notes.push(`promptFocusVia=${promptFocus.via}`);
    if (promptFocus.omniboxRejected) {
      notes.push('omniboxRejected=true');
    }
    if (promptFocus.readinessProof) {
      notes.push(`composerReadiness=${promptFocus.readinessProof}`);
    }
    await writeJsonlLog(logPath, { step: lastStep, promptFocus });

    lastStep = 'insert-prompt';
    const insertion = await insertPrompt(selectedWindow.handle, args.prompt, promptFocus, args.stepDelayMs);
    clipboardHash = insertion.actualHash;
    lastFocusedElement = insertion.focusedElement ?? lastFocusedElement;
    notes.push(`promptHash=${insertion.expectedHash}`);
    notes.push(`insertionMethod=${insertion.method}`);
    await writeJsonlLog(logPath, { step: lastStep, insertion });

    lastStep = 'validate-prompt';
    const validation = await validatePromptInput(selectedWindow.handle, args.prompt, promptFocus, insertion, args.stepDelayMs);
    clipboardHash = validation.clipboardHash;
    lastFocusedElement = validation.focusedElement ?? lastFocusedElement;
    notes.push(`validationMethod=${validation.method}`);
    if (validation.proof) {
      notes.push(`inputProof=${validation.proof}`);
    }
    await writeJsonlLog(logPath, { step: lastStep, validation });

    if (args.dryRun || !args.submit) {
      lastStep = 'dry-run-ready';
      await writeJsonlLog(logPath, { step: lastStep, currentUrl, window: lastWindow, focusedElement: lastFocusedElement, clipboardHash });
      if (!args.submit) {
        notes.push('submit=false');
      }
      return createReceipt({
        submitted: false,
        modeResolved: 'desktop-chatgpt',
        projectResolved: null,
        url: currentUrl,
        notes
      });
    }

    lastStep = 'submit-prompt';
    const submitResult = await submitPrompt(selectedWindow.handle, submitPoint, args.stepDelayMs, args.prompt, promptFocus, args.submitMethod);
    await writeJsonlLog(logPath, { step: lastStep, submitResult });
    notes.push(`submitMethod=${submitResult.method}`);
    if (submitResult.proof) {
      notes.push(`submitProof=${submitResult.proof}`);
    }

    return createReceipt({
      submitted: true,
      modeResolved: 'desktop-chatgpt',
      projectResolved: null,
      url: currentUrl,
      notes
    });
  } catch (error) {
    const normalizedError = error instanceof StepError
      ? error
      : new StepError(error?.code || ERROR_CODES.SUBMIT_FAILED, error?.step || lastStep, error?.message || String(error));
    const failureNotes = [...notes, `lastStep=${lastStep}`];
    if (currentUrl) failureNotes.push(`lastUrl=${currentUrl}`);
    if (lastWindow?.rect) failureNotes.push(`windowRect=${JSON.stringify(lastWindow.rect)}`);
    if (lastFocusedElement) failureNotes.push(`focusedElement=${JSON.stringify(lastFocusedElement)}`);
    if (clipboardHash) failureNotes.push(`clipboardHash=${clipboardHash}`);
    if (logPath) {
      await writeJsonlLog(logPath, {
        step: 'failure',
        lastStep,
        error: { code: normalizedError.code, message: normalizedError.message },
        currentUrl,
        window: lastWindow,
        focusedElement: lastFocusedElement,
        clipboardHash
      });
    }
    return createFailureReceipt({
      error: normalizedError,
      url: currentUrl || CHATGPT_URL,
      notes: failureNotes
    });
  }
}

async function readCurrentUrl(handle) {
  const result = await getUrlViaOmnibox({ handle });
  return String(result.url || '').trim();
}

async function stabilizeWindowFocus(handle, stepDelayMs) {
  return waitForCondition({
    step: 'focus-window',
    attempts: 4,
    delayMs: stepDelayMs,
    action: async () => {
      await focusWindow(handle);
    },
    verify: async () => {
      const foreground = await getForegroundWindow().catch(() => null);
      const verified = Number(foreground?.window?.handle) === Number(handle);
      return {
        ok: verified,
        proof: verified ? 'foregroundWindowMatchedTarget' : 'foregroundWindowMismatch',
        foreground: foreground?.window || null
      };
    }
  });
}

async function waitForWindowRectStability(handle, targetBounds, stepDelayMs) {
  return waitForCondition({
    step: 'normalize-window',
    attempts: 6,
    delayMs: stepDelayMs,
    verify: async () => {
      const sample = await getWindowRect(handle);
      const window = sample?.window || null;
      const rect = window?.rect || {};
      const withinTolerance = isRectClose(rect, targetBounds, 3);
      return {
        ok: withinTolerance,
        proof: withinTolerance ? 'windowRectMatchedTargetBounds' : 'windowRectStillSettling',
        window
      };
    }
  });
}

async function navigateToChatGpt(handle, targetUrl, stepDelayMs) {
  const omnibox = await focusOmniboxAndVerify(handle, stepDelayMs);
  const urlEntry = await enterAddressAndVerify(handle, targetUrl, stepDelayMs);
  const ready = await waitForChatGptReady(handle, stepDelayMs, targetUrl);
  return {
    ...ready,
    omnibox,
    urlEntry,
    proof: `${omnibox.proof}>${urlEntry.proof}>${ready.proof}`
  };
}

async function focusOmniboxAndVerify(handle, stepDelayMs) {
  const ctrlLResult = await waitForCondition({
    step: 'focus-omnibox',
    attempts: 3,
    delayMs: stepDelayMs,
    action: async () => {
      await sendKeys('l', ['ctrl']);
    },
    verify: async () => {
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      const ok = isLikelyOmniboxElement(focusedElement);
      return {
        ok,
        proof: ok ? 'omniboxFocusedAfterCtrlL' : 'omniboxNotFocusedYet',
        focusedElement
      };
    },
    throwOnFailure: false
  });

  if (ctrlLResult.ok) {
    return ctrlLResult;
  }

  return waitForCondition({
    step: 'focus-omnibox',
    attempts: 3,
    delayMs: stepDelayMs,
    action: async () => {
      const focusAttempt = await uiaSetFocus({ handle }, {
        className: 'OmniboxViewViews',
        role: 'Edit',
        timeoutMs: 1500
      }).catch(() => null);
      if (!focusAttempt?.element?.rect) {
        await sendKeys('l', ['ctrl']);
        return;
      }
      await clickPoint({
        x: focusAttempt.element.rect.x + Math.max(16, Math.round(focusAttempt.element.rect.width / 4)),
        y: focusAttempt.element.rect.y + Math.max(8, Math.round(focusAttempt.element.rect.height / 2))
      });
    },
    verify: async () => {
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      const ok = isLikelyOmniboxElement(focusedElement);
      return {
        ok,
        proof: ok ? 'omniboxFocusedViaUiaOrClick' : 'omniboxStillNotFocused',
        focusedElement
      };
    }
  });
}

async function enterAddressAndVerify(handle, targetUrl, stepDelayMs) {
  const expectedValue = normalizeAddressValue(targetUrl);

  const unicodeAttempt = await waitForCondition({
    step: 'enter-address',
    attempts: 2,
    delayMs: stepDelayMs,
    action: async () => {
      await sendKeys('a', ['ctrl']);
      await delay(stepDelayMs);
      await sendText(targetUrl);
    },
    verify: async () => {
      const currentValue = await readCurrentUrl(handle).catch(() => '');
      const ok = normalizeAddressValue(currentValue) === expectedValue;
      return {
        ok,
        proof: ok ? 'omniboxValueMatchedTargetUrlViaUnicode' : 'omniboxValueMismatchAfterUnicode',
        currentValue
      };
    },
    throwOnFailure: false
  });

  if (unicodeAttempt.ok) {
    return unicodeAttempt;
  }

  return waitForCondition({
    step: 'enter-address',
    attempts: 3,
    delayMs: stepDelayMs,
    action: async () => {
      await sendKeys('a', ['ctrl']);
      await delay(stepDelayMs);
      await setClipboardText(targetUrl);
      await delay(stepDelayMs);
      await pasteClipboard();
    },
    verify: async () => {
      const currentValue = await readCurrentUrl(handle).catch(() => '');
      const ok = normalizeAddressValue(currentValue) === expectedValue;
      return {
        ok,
        proof: ok ? 'omniboxValueMatchedTargetUrlViaClipboard' : 'omniboxValueMismatchAfterClipboard',
        currentValue
      };
    }
  });
}

async function waitForChatGptReady(handle, stepDelayMs, targetUrl) {
  await pressEnter();
  return waitForCondition({
    step: 'wait-chatgpt-ready',
    attempts: 10,
    delayMs: stepDelayMs * 2,
    verify: async () => {
      const currentUrl = await readCurrentUrl(handle).catch(() => '');
      const urlOk = isChatGptUrl(currentUrl) || normalizeAddressValue(currentUrl) === normalizeAddressValue(targetUrl);
      const composerElement = await queryComposerElement(handle, 1200).catch(() => null);
      const ready = urlOk && looksLikeComposerElement(composerElement);
      return {
        ok: ready,
        proof: ready ? 'chatgptUrlAndComposerReady' : (urlOk ? 'chatgptUrlReadyComposerPending' : 'chatgptUrlPending'),
        currentUrl: currentUrl || targetUrl,
        composerElement
      };
    }
  });
}

async function dismissInterferingUi(handle, stepDelayMs) {
  const buttonNames = ['모두 허용', 'Allow all', 'Accept all', '확인'];
  for (const name of buttonNames) {
    try {
      await uiaInvoke({ handle }, { name, role: 'Button', timeoutMs: 600 });
      await delay(stepDelayMs * 2);
      return { acted: true, method: `uia-invoke:${name}` };
    } catch {
      // try next label
    }
  }

  try {
    await sendKeys('escape');
    await delay(stepDelayMs);
    return { acted: true, method: 'escape' };
  } catch {
    // ignore; some dialogs do not respond to escape
  }

  return { acted: false, method: 'none' };
}

async function focusPromptBox(handle, fallbackPoint, stepDelayMs) {
  let via = 'uia-focus-prompt-textarea';
  let element = null;
  let omniboxRejected = false;

  try {
    const ready = await waitForComposerReady(handle, stepDelayMs, {
      timeoutAttempts: 6,
      fallbackPoint
    });
    element = ready.element;
    via = ready.via;
  } catch {
    via = 'calibrated-fallback';
    await clickPoint(fallbackPoint);
    await delay(stepDelayMs);
    const retry = await waitForComposerReady(handle, stepDelayMs, {
      timeoutAttempts: 4,
      fallbackPoint,
      preferFallback: true
    }).catch(() => null);
    element = retry?.element || null;
    if (retry?.via) via = retry.via;
  }

  await delay(stepDelayMs);
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  if (isLikelyOmniboxElement(focusedElement) || isLikelyOmniboxElement(element)) {
    omniboxRejected = true;
  }
  return {
    via,
    focusedElement,
    element,
    omniboxRejected,
    readinessProof: looksLikeComposerElement(focusedElement) || looksLikeComposerElement(element)
      ? 'composerFocusedAndDetected'
      : 'composerDetectionDegraded'
  };
}

async function waitForComposerReady(handle, stepDelayMs, options = {}) {
  const attempts = options.timeoutAttempts || 6;
  const fallbackPoint = options.fallbackPoint;
  const preferFallback = options.preferFallback === true;
  return waitForCondition({
    step: 'focus-prompt',
    attempts,
    delayMs: stepDelayMs,
    action: async () => {
      if (!preferFallback) {
        const focused = await uiaSetFocus({ handle }, {
          automationId: 'prompt-textarea',
          className: 'ProseMirror',
          timeoutMs: 1800
        }).catch(() => null);
        if (focused?.element) {
          await clickComposerCenter(focused.element, fallbackPoint);
          return;
        }
      }
      if (fallbackPoint) {
        await clickPoint(fallbackPoint);
      }
    },
    verify: async () => {
      const element = await queryComposerElement(handle, 1200).catch(() => null);
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      const focusedLooksValid = looksLikeComposerElement(focusedElement);
      const elementLooksValid = looksLikeComposerElement(element);
      const ok = (focusedLooksValid || elementLooksValid) && !isLikelyOmniboxElement(focusedElement);
      return {
        ok,
        proof: ok ? 'composerFocusedAndDetected' : 'composerNotReadyYet',
        element,
        focusedElement,
        via: focusedLooksValid || elementLooksValid ? (preferFallback ? 'calibrated-fallback' : 'uia-focus-prompt-textarea') : null
      };
    }
  });
}

async function insertPrompt(handle, prompt, promptFocus, stepDelayMs) {
  const expectedHash = hashText(prompt);
  const beforeSubmitState = await sampleVisibleSubmitState(handle);

  try {
    await refocusComposer(handle, promptFocus, stepDelayMs);
    await settleAfterComposerFocus(stepDelayMs);
    await clearComposer(stepDelayMs);
    await setClipboardText(prompt);
    await delay(stepDelayMs);
    await pasteClipboard({ slow: true, keyDelayMs: PASTE_KEY_DELAY_MS });
    await settleAfterPaste(stepDelayMs);
    const clipboardProof = await waitForPromptPresence(handle, prompt, stepDelayMs, 'uia-focus+slow-clipboard-paste');
    if (clipboardProof.ok) {
      const visibleProof = await waitForVisibleSendState(handle, prompt, beforeSubmitState, stepDelayMs, 'uia-focus+slow-clipboard-paste');
      return mergePromptInsertionProof({
        baseMethod: 'uia-focus+slow-clipboard-paste',
        expectedHash,
        promptProof: clipboardProof,
        visibleProof,
        beforeSubmitState
      });
    }
  } catch {
    // fall through to machine-specific coordinate proof path
  }

  const coordinateProof = await insertPromptViaCoordinateProof(prompt, stepDelayMs);
  const visibleProof = await waitForVisibleSendState(handle, prompt, beforeSubmitState, stepDelayMs, coordinateProof.method);
  return mergePromptInsertionProof({
    baseMethod: coordinateProof.method,
    expectedHash,
    promptProof: coordinateProof,
    visibleProof,
    beforeSubmitState
  });
}

async function waitForPromptPresence(handle, prompt, stepDelayMs, method) {
  const result = await waitForCondition({
    step: 'insert-prompt',
    attempts: 5,
    delayMs: stepDelayMs,
    verify: async () => {
      const proof = await readComposerProof(handle);
      const ok = proof.text.includes(prompt);
      return {
        ok,
        proof: ok ? `${method}+composerTextContainsPrompt` : `${method}+composerTextPending`,
        ...proof
      };
    },
    throwOnFailure: false
  });
  return result;
}

function mergePromptInsertionProof({ baseMethod, expectedHash, promptProof, visibleProof, beforeSubmitState }) {
  const visibleTransitionProven = Boolean(visibleProof?.ok);
  const methodSuffix = visibleTransitionProven ? '+visible-send-state' : '+submit-attempt-ready';
  return {
    method: `${baseMethod}${methodSuffix}`,
    expectedHash,
    actualHash: hashText(promptProof?.text || ''),
    focusedElement: visibleProof?.focusedElement || promptProof?.focusedElement || null,
    composerElement: visibleProof?.composerElement || visibleProof?.element || promptProof?.composerElement || promptProof?.element || null,
    proof: visibleProof?.proof || promptProof?.proof || `${baseMethod}+composerTextContainsPrompt`,
    composerTextSample: String(promptProof?.text || promptProof?.composerTextSample || '').slice(0, 200),
    beforeSubmitState,
    afterSubmitState: visibleProof?.submitState || beforeSubmitState,
    visibleSendStateProven: visibleTransitionProven
  };
}

async function validatePromptInput(handle, prompt, promptFocus, insertion, stepDelayMs) {
  const expectedHash = hashText(prompt);
  const insertionHashMatched = insertion?.actualHash === expectedHash;
  const promptFocusLooksCredible = looksLikeComposerElement(promptFocus?.focusedElement) || looksLikeComposerElement(promptFocus?.element);

  if (insertionHashMatched && promptFocusLooksCredible) {
    return {
      method: `${insertion?.method || 'unknown'}+focus-safe-hash-proof`,
      expectedHash,
      actualHash: insertion.actualHash,
      clipboardHash: expectedHash,
      focusedElement: insertion.focusedElement || promptFocus?.focusedElement || null,
      composerElement: insertion.composerElement || promptFocus?.element || null,
      proof: 'promptHashMatchedAfterFocusedPaste',
      composerTextSample: String(insertion?.composerTextSample || prompt).slice(0, 200),
      beforeSubmitState: insertion?.beforeSubmitState,
      afterSubmitState: insertion?.afterSubmitState || insertion?.beforeSubmitState || null,
      visibleSendStateProven: Boolean(insertion?.visibleSendStateProven)
    };
  }

  const verifiedProof = await waitForCondition({
    step: 'validate-prompt',
    attempts: 3,
    delayMs: stepDelayMs,
    action: async () => {
      await focusWindow(handle).catch(() => {});
      await refocusComposer(handle, promptFocus, stepDelayMs).catch(() => {});
    },
    verify: async () => {
      const proof = await readComposerProof(handle);
      ensurePromptTargetLooksCredible({
        promptFocus,
        focusedElement: proof.focusedElement,
        currentUrlAfterValidation: CHATGPT_URL,
        prompt,
        actualHash: hashText(proof.text)
      });
      const promptPresent = proof.text.includes(prompt);
      return {
        ok: promptPresent,
        proof: promptPresent ? 'promptPresentComposerCredible' : 'composerTextStillHydrating',
        ...proof,
        submitState: insertion?.afterSubmitState || insertion?.beforeSubmitState || null,
        sendTransitionProven: Boolean(insertion?.visibleSendStateProven)
      };
    },
    failureCode: 'PROMPT_VALIDATION_FAILED',
    failureMessage: 'Prompt was not confirmed in the ChatGPT composer.'
  });

  return {
    method: `${insertion?.method || 'unknown'}+light-composer-present-proof`,
    expectedHash,
    actualHash: hashText(verifiedProof.text),
    clipboardHash: expectedHash,
    focusedElement: verifiedProof.focusedElement,
    composerElement: verifiedProof.element,
    proof: verifiedProof.proof,
    composerTextSample: verifiedProof.text.slice(0, 200),
    beforeSubmitState: insertion?.beforeSubmitState,
    afterSubmitState: verifiedProof.submitState,
    visibleSendStateProven: Boolean(verifiedProof.sendTransitionProven)
  };
}

async function refocusComposer(handle, promptFocus, stepDelayMs) {
  const result = await waitForCondition({
    step: 'refocus-composer',
    attempts: 4,
    delayMs: stepDelayMs,
    action: async () => {
      await uiaSetFocus({ handle }, {
        automationId: 'prompt-textarea',
        className: 'ProseMirror',
        timeoutMs: 1800
      }).catch(() => null);
    },
    verify: async () => {
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      if (isLikelyOmniboxElement(focusedElement)) {
        return {
          ok: false,
          proof: 'focusedElementRelapsedIntoOmnibox',
          focusedElement
        };
      }
      const ok = looksLikeComposerElement(focusedElement);
      return {
        ok,
        proof: ok ? 'composerRefocused' : 'composerRefocusPending',
        focusedElement
      };
    },
    failureCode: 'PROMPT_TARGET_INVALID',
    failureMessage: 'Focused element is not the ChatGPT composer after UIA refocus.',
    failureDetails: {
      promptFocus: promptFocus?.element || null
    }
  });
  return result.focusedElement;
}

async function clearComposer(stepDelayMs) {
  await sendKeys('a', ['ctrl']);
  await delay(stepDelayMs);
}

async function settleAfterComposerFocus(stepDelayMs) {
  await delay(Math.max(stepDelayMs, COMPOSER_FOCUS_SETTLE_MS));
}

async function settleAfterPaste(stepDelayMs) {
  await delay(Math.max(stepDelayMs * 2, POST_PASTE_SETTLE_MS));
}

async function clickComposerCenter(element, fallbackPoint) {
  const rect = element?.rect;
  if (rect?.width > 0 && rect?.height > 0) {
    await clickPoint({ x: rect.x + (rect.width / 2), y: rect.y + Math.max(12, Math.min(rect.height / 2, rect.height - 4)) });
    return;
  }
  await clickPoint(fallbackPoint);
}

async function readComposerProof(handle) {
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);

  try {
    const composer = await uiaReadText({ handle }, {
      automationId: 'prompt-textarea',
      className: 'ProseMirror',
      timeoutMs: 1500
    });
    return {
      element: composer.element,
      focusedElement,
      text: normalizeComposerText(composer.text)
    };
  } catch {
    if (!looksLikeComposerElement(focusedElement)) {
      throw new StepError('PROMPT_TARGET_INVALID', 'read-composer-proof', 'Focused element is not the ChatGPT composer while reading input proof.');
    }

    const priorClipboard = await getClipboardText().catch(() => ({ text: '' }));
    await sendKeys('a', ['ctrl']);
    await delay(120);
    await sendKeys('c', ['ctrl']);
    await delay(180);
    const clipboard = await getClipboardText();
    await setClipboardText(String(priorClipboard?.text || '')).catch(() => {});

    return {
      element: focusedElement,
      focusedElement,
      text: normalizeComposerText(clipboard.text)
    };
  }
}

async function insertPromptViaCoordinateProof(prompt, stepDelayMs) {
  await delay(stepDelayMs * 2);
  await clickPoint({ x: 806, y: 530 });
  await delay(stepDelayMs * 2);
  await sendKeys('a', ['ctrl']);
  await delay(stepDelayMs);
  await setClipboardText(prompt);
  await delay(stepDelayMs);
  await pasteClipboard();
  await delay(stepDelayMs * 2);
  await sendKeys('a', ['ctrl']);
  await delay(stepDelayMs);
  await sendKeys('c', ['ctrl']);
  await delay(stepDelayMs * 2);
  const clipboard = await getClipboardText();
  const copied = normalizeComposerText(clipboard.text);
  if (copied !== prompt) {
    throw new StepError('PROMPT_VALIDATION_FAILED', 'insert-prompt', 'Machine-specific coordinate insertion path did not round-trip the prompt through clipboard selection.', {
      expectedHash: hashText(prompt),
      actualHash: hashText(copied),
      copiedPreview: copied.slice(0, 200)
    });
  }
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  return {
    method: 'coordinate-click+clipboard-paste+clipboard-roundtrip',
    actualHash: hashText(copied),
    focusedElement,
    composerElement: null,
    proof: 'coordinateClipboardRoundtripMatchedPrompt',
    composerTextSample: copied.slice(0, 200)
  };
}

function normalizeComposerText(text) {
  return String(text || '').replace(/\r/g, '').replace(/\uFFFC/g, '').trim();
}

function ensurePromptTargetLooksCredible({ promptFocus, focusedElement, currentUrlAfterValidation, prompt, actualHash }) {
  const promptFocusLooksLikeComposer = looksLikeComposerElement(promptFocus?.element);
  const focusedLooksLikeComposer = looksLikeComposerElement(focusedElement);
  const promptLooksLikeUrlEcho = looksLikePromptEcho(currentUrlAfterValidation, prompt);
  const urlLooksCredible = isChatGptUrl(currentUrlAfterValidation);

  if (!promptFocusLooksLikeComposer && !focusedLooksLikeComposer) {
    throw new StepError('PROMPT_TARGET_INVALID', 'validate-prompt', 'Focused prompt target did not resolve to the ChatGPT composer.', {
      promptFocus: promptFocus?.element || null,
      focusedElement: focusedElement || null
    });
  }

  if (!urlLooksCredible && !promptLooksLikeUrlEcho && currentUrlAfterValidation && currentUrlAfterValidation !== CHATGPT_URL) {
    throw new StepError('PROMPT_TARGET_INVALID', 'validate-prompt', 'URL changed away from ChatGPT during prompt validation.', {
      currentUrlAfterValidation,
      promptPreview: String(prompt).slice(0, 80),
      actualHash
    });
  }
}

function looksLikeComposerElement(element) {
  if (!element) return false;
  const haystack = [
    element.name,
    element.role,
    element.controlType,
    element.automationId,
    element.className
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('prompt-textarea')
    || haystack.includes('prosemirror')
    || haystack.includes('message chatgpt')
    || haystack.includes('메시지');
}

async function submitPrompt(handle, submitPoint, stepDelayMs, prompt, promptFocus, preferredMethod = 'click') {
  await focusWindow(handle).catch(() => {});
  await refocusComposer(handle, promptFocus, stepDelayMs).catch(() => {});
  await settleAfterComposerFocus(stepDelayMs);
  const ready = await verifyReadyToSubmit(handle, prompt, promptFocus, stepDelayMs);
  const before = ready.sample;
  const plannedMethods = buildSubmitAttemptOrder(preferredMethod, before.submitButton);
  let method = null;
  let after = null;

  for (const plannedMethod of plannedMethods) {
    if (plannedMethod === 'click' && !isSendableSubmitState(before.submitButton)) {
      continue;
    }
    method = await attemptSubmitMethod(handle, submitPoint, stepDelayMs, plannedMethod);
    if (!method) {
      continue;
    }
    after = await waitForSubmitEvidence(handle, prompt, before, stepDelayMs);
    if (after?.ok) {
      break;
    }
  }

  if (!method) {
    throw new StepError('SUBMIT_FAILED', 'submit-prompt', 'Failed to trigger a practical submit attempt.', { before, plannedMethods });
  }

  return {
    method,
    proof: after?.proof || 'submitAttemptMadeButUiProofUnavailable',
    composerTextSample: String(after?.composerText || '').slice(0, 200),
    focusedElement: after?.focusedElement || before.focusedElement,
    composerElement: after?.composerElement || before.composerElement,
    beforeSubmitButton: before.submitButton?.name || null,
    afterSubmitButton: after?.submitButton?.name || null,
    stopButton: after?.stopButton?.name || null,
    submitAttempted: method !== null,
    readyProof: ready.proof,
    sendButtonVisibleBeforeSubmit: isSendableSubmitState(before.submitButton)
  };
}

async function collectSubmitEvidence(handle, prompt) {
  const composer = await readComposerProof(handle).catch(() => ({ text: '', element: null, focusedElement: null }));
  const submitButton = await findSubmitButton(handle);
  const stopButton = await findStopButton(handle);
  return {
    stage: 'sample',
    prompt,
    composerText: normalizeComposerText(composer.text),
    composerElement: composer.element,
    focusedElement: composer.focusedElement,
    submitButton,
    stopButton,
    submitButtonEnabled: isElementEnabled(submitButton),
    stopButtonEnabled: isElementEnabled(stopButton)
  };
}

async function sampleVisibleSubmitState(handle) {
  const submitButton = await findSubmitButton(handle).catch(() => null);
  const stopButton = await findStopButton(handle).catch(() => null);
  return {
    submitButton,
    stopButton,
    sendable: isSendableSubmitState(submitButton),
    stopVisible: Boolean(stopButton),
    submitSignature: elementSignature(submitButton),
    stopSignature: elementSignature(stopButton)
  };
}

function hasVisibleSendStateTransition(beforeState, afterState) {
  if (!afterState?.sendable) return false;
  if (!beforeState) return afterState.sendable;
  if (beforeState.stopVisible && afterState.sendable) return true;
  if (!beforeState.sendable && afterState.sendable) return true;
  if (beforeState.submitSignature !== afterState.submitSignature) return true;
  return false;
}

async function waitForVisibleSendState(handle, prompt, beforeState, stepDelayMs, method) {
  return waitForCondition({
    step: 'visible-send-state',
    attempts: 6,
    delayMs: stepDelayMs,
    verify: async () => {
      const proof = await readComposerProof(handle).catch(() => ({ text: '', element: null, focusedElement: null }));
      const submitState = await sampleVisibleSubmitState(handle);
      const promptPresent = normalizeComposerText(proof.text).includes(prompt);
      const transitioned = hasVisibleSendStateTransition(beforeState, submitState);
      return {
        ok: promptPresent && transitioned,
        proof: promptPresent
          ? (transitioned ? `${method}+visibleSendButtonTransition` : `${method}+visibleSendButtonTransitionUnproven`)
          : `${method}+composerTextPending`,
        text: proof.text,
        element: proof.element,
        focusedElement: proof.focusedElement,
        submitState
      };
    },
    throwOnFailure: false
  });
}

async function submitViaVisibleSendButton(handle, submitPoint, stepDelayMs) {
  try {
    await uiaInvoke({ handle }, { automationId: 'composer-submit-btn', timeoutMs: 1000 });
    await delay(stepDelayMs * 2);
    return 'uia-invoke-submit-button';
  } catch {
    try {
      await uiaInvoke({ handle }, { name: 'Send', role: 'Button', timeoutMs: 1000 });
      await delay(stepDelayMs * 2);
      return 'uia-invoke-send-button';
    } catch {
      try {
        await uiaInvoke({ handle }, { name: '보내기', role: 'Button', timeoutMs: 1000 });
        await delay(stepDelayMs * 2);
        return 'uia-invoke-send-button-ko';
      } catch {
        await clickPoint(submitPoint);
        await delay(stepDelayMs * 2);
        return 'calibrated-send-button';
      }
    }
  }
}

async function verifyReadyToSubmit(handle, prompt, promptFocus, stepDelayMs) {
  const currentUrlAfterValidation = await readCurrentUrl(handle).catch(() => CHATGPT_URL);
  return waitForCondition({
    step: 'submit-prompt-precheck',
    attempts: 5,
    delayMs: stepDelayMs,
    verify: async () => {
      const proof = await readComposerProof(handle);
      const submitButton = await findSubmitButton(handle);
      ensurePromptTargetLooksCredible({
        promptFocus,
        focusedElement: proof.focusedElement,
        currentUrlAfterValidation,
        prompt,
        actualHash: hashText(proof.text)
      });
      const promptPresent = normalizeComposerText(proof.text).includes(prompt);
      const sendable = isSendableSubmitState(submitButton);
      const sample = {
        stage: 'before',
        prompt,
        composerText: normalizeComposerText(proof.text),
        composerElement: proof.element,
        focusedElement: proof.focusedElement,
        submitButton,
        stopButton: null,
        submitButtonEnabled: isElementEnabled(submitButton),
        stopButtonEnabled: false
      };
      return {
        ok: promptPresent,
        proof: promptPresent
          ? (sendable ? 'composerContainsPromptAndSendable' : 'composerContainsPromptSubmitStateDegraded')
          : 'composerMissingExpectedPrompt',
        sample
      };
    },
    failureCode: 'SUBMIT_PRECHECK_FAILED',
    failureMessage: 'Prompt was not confirmed in the ChatGPT composer before submit.'
  });
}

async function waitForSubmitEvidence(handle, prompt, before, stepDelayMs) {
  return waitForCondition({
    step: 'submit-prompt',
    attempts: 12,
    delayMs: stepDelayMs * 2,
    verify: async () => {
      const sample = await collectSubmitEvidence(handle, prompt).catch(() => null);
      if (!sample) {
        return { ok: false, proof: 'submitEvidenceUnavailable' };
      }
      const proof = deriveSubmitProof(before, sample, prompt);
      return {
        ok: proof !== 'submitUnprovenComposerStillContainsPrompt',
        proof,
        ...sample
      };
    },
    throwOnFailure: false
  });
}

function buildSubmitAttemptOrder(preferredMethod, submitButton) {
  const first = preferredMethod === 'enter' ? 'enter' : (isSendableSubmitState(submitButton) ? 'click' : 'enter');
  const second = first === 'enter' ? 'click' : 'enter';
  return [first, second];
}

async function attemptSubmitMethod(handle, submitPoint, stepDelayMs, method) {
  if (method === 'enter') {
    await pressEnter();
    await delay(stepDelayMs * 2);
    return 'enter';
  }
  if (method === 'click') {
    return submitViaVisibleSendButton(handle, submitPoint, stepDelayMs);
  }
  return null;
}

function deriveSubmitProof(before, after, prompt) {
  const beforeText = normalizeComposerText(before?.composerText || '');
  const afterText = normalizeComposerText(after?.composerText || '');
  const stopAppeared = Boolean(after?.stopButton);
  const beforeSignature = elementSignature(before?.submitButton);
  const afterSignature = elementSignature(after?.submitButton);
  const submitButtonChanged = Boolean(beforeSignature || afterSignature) && beforeSignature !== afterSignature;
  const sendabilityChanged = isSendableSubmitState(before?.submitButton) !== isSendableSubmitState(after?.submitButton);
  const composerCleared = Boolean(beforeText) && (!afterText || !afterText.includes(prompt));

  if (stopAppeared) return 'stopButtonAppeared';
  if (submitButtonChanged) return 'submitButtonStateChanged';
  if (sendabilityChanged) return 'submitButtonSendabilityChanged';
  if (composerCleared) return 'composerClearedOrPromptGoneAfterSubmit';
  return 'submitUnprovenComposerStillContainsPrompt';
}

async function findSubmitButton(handle) {
  const candidates = [
    { automationId: 'composer-submit-btn', timeoutMs: 700 },
    { name: 'Send', role: 'Button', timeoutMs: 700 },
    { name: '보내기', role: 'Button', timeoutMs: 700 }
  ];

  for (const candidate of candidates) {
    const element = await uiaQuery({ handle }, candidate).then((result) => result.element).catch(() => null);
    if (element) return element;
  }
  return null;
}

async function findStopButton(handle) {
  const candidates = [
    { automationId: 'composer-submit-btn', timeoutMs: 500 },
    { name: 'Stop', role: 'Button', timeoutMs: 500 },
    { name: '중지', role: 'Button', timeoutMs: 500 },
    { name: '응답 중지', role: 'Button', timeoutMs: 500 }
  ];

  for (const candidate of candidates) {
    const element = await uiaQuery({ handle }, candidate).then((result) => result.element).catch(() => null);
    if (!element) continue;
    if ((candidate.automationId && looksLikeStopButton(element)) || (!candidate.automationId && element)) {
      return element;
    }
  }
  return null;
}

function looksLikeStopButton(element) {
  const haystack = [element?.name, element?.role, element?.controlType, element?.automationId, element?.className]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes('stop') || haystack.includes('중지');
}

function isElementEnabled(element) {
  if (!element) return false;
  for (const key of ['isEnabled', 'enabled', 'hasKeyboardFocus']) {
    if (typeof element?.[key] === 'boolean') {
      if (key === 'hasKeyboardFocus') continue;
      return element[key];
    }
  }
  const haystack = [element?.name, element?.role, element?.controlType, element?.automationId, element?.className]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (haystack.includes('disabled') || haystack.includes('비활성')) return false;
  return true;
}

function isSendableSubmitState(element) {
  if (!element) return false;
  if (looksLikeStopButton(element)) return false;
  return isElementEnabled(element);
}

function elementSignature(element) {
  if (!element) return '';
  return JSON.stringify({
    name: element.name || '',
    role: element.role || '',
    controlType: element.controlType || '',
    automationId: element.automationId || '',
    className: element.className || '',
    isEnabled: typeof element.isEnabled === 'boolean' ? element.isEnabled : null,
    enabled: typeof element.enabled === 'boolean' ? element.enabled : null,
    hasKeyboardFocus: typeof element.hasKeyboardFocus === 'boolean' ? element.hasKeyboardFocus : null
  });
}

function looksLikePromptEcho(currentUrlAfterValidation, prompt) {
  const value = String(currentUrlAfterValidation || '').trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return false;
  const promptText = String(prompt || '').trim();
  return value === promptText || promptText.includes(value) || value.includes(promptText.slice(0, Math.min(promptText.length, 24)));
}

function truncateForNote(text, limit = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function isLikelyOmniboxElement(element) {
  if (!element) return false;
  const haystack = [
    element.name,
    element.role,
    element.controlType,
    element.automationId,
    element.className
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return OMNIBOX_HINTS.some((hint) => haystack.includes(hint.toLowerCase()));
}

async function queryComposerElement(handle, timeoutMs = 1200) {
  const result = await uiaQuery({ handle }, {
    automationId: 'prompt-textarea',
    className: 'ProseMirror',
    timeoutMs
  });
  return result?.element || null;
}

function normalizeAddressValue(value) {
  return String(value || '').trim().replace(/\/+$/, '/').toLowerCase();
}

function isRectClose(actual = {}, expected = {}, tolerance = 3) {
  return ['x', 'y', 'width', 'height'].every((key) => Math.abs(Number(actual?.[key] || 0) - Number(expected?.[key] || 0)) <= tolerance);
}

async function waitForCondition({
  step,
  attempts = 3,
  delayMs = 250,
  action = null,
  verify,
  throwOnFailure = true,
  failureCode = ERROR_CODES.SUBMIT_FAILED,
  failureMessage = `${step} did not reach the expected ready state.`,
  failureDetails = {}
}) {
  let lastResult = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (action) {
        await action(attempt);
      }
      await delay(delayMs);
      lastResult = await verify(attempt);
      if (lastResult?.ok) {
        return { ...lastResult, attemptsUsed: attempt };
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await delay(delayMs);
    }
  }

  if (!throwOnFailure) {
    return {
      ok: false,
      attemptsUsed: attempts,
      proof: lastResult?.proof || 'conditionUnverified',
      ...lastResult,
      error: lastError ? { message: lastError.message, code: lastError.code } : null
    };
  }

  if (lastError instanceof StepError) {
    throw lastError;
  }

  throw new StepError(failureCode, step, failureMessage, {
    attempts,
    lastResult,
    lastError: lastError ? { message: lastError.message, code: lastError.code, step: lastError.step } : null,
    ...failureDetails
  });
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export const __desktopSubmitInternals = {
  isLikelyOmniboxElement,
  ensurePromptTargetLooksCredible,
  looksLikeComposerElement,
  isChatGptUrl,
  looksLikePromptEcho,
  deriveSubmitProof,
  hasVisibleSendStateTransition,
  buildSubmitAttemptOrder,
  looksLikeStopButton,
  hashText,
  normalizeAddressValue,
  isRectClose
};
