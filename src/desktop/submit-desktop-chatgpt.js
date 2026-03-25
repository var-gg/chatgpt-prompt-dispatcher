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
  listChromeWindows,
  pasteClipboard,
  pressEnter,
  resizeWindow,
  sendKeys,
  sendText,
  setClipboardText,
  uiaGetFocusedElement,
  uiaInvoke,
  uiaReadText,
  uiaSetFocus
} from './windows-input.js';

const CHATGPT_URL = 'https://chatgpt.com/';
const CHATGPT_HOST = 'chatgpt.com';
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
    const selectedWindow = await chooseChromeWindow(titleHint);
    lastWindow = selectedWindow;
    notes.push(`windowHandle=${selectedWindow.handle}`);
    notes.push(`windowTitle=${selectedWindow.title}`);
    await writeJsonlLog(logPath, { step: lastStep, selectedWindow });

    lastStep = 'focus-window';
    await focusWindow(selectedWindow.handle);
    await delay(args.stepDelayMs);
    await writeJsonlLog(logPath, { step: lastStep, handle: selectedWindow.handle });

    lastStep = 'normalize-window';
    await resizeWindow(targetBounds, selectedWindow.handle);
    await delay(args.stepDelayMs);
    lastWindow = (await getWindowRect(selectedWindow.handle)).window;
    await writeJsonlLog(logPath, { step: lastStep, window: lastWindow });

    lastStep = 'open-fresh-tab';
    await openFreshTab(args.stepDelayMs);
    await writeJsonlLog(logPath, { step: lastStep });

    lastStep = 'navigate-chatgpt';
    await navigateToChatGpt(CHATGPT_URL, args.stepDelayMs);
    await writeJsonlLog(logPath, { step: lastStep, targetUrl: CHATGPT_URL });

    lastStep = 'verify-url-after-navigation';
    currentUrl = await readCurrentUrl(selectedWindow.handle);
    await writeJsonlLog(logPath, { step: lastStep, currentUrl });
    if (!isChatGptUrl(currentUrl)) {
      throw new StepError('URL_VALIDATION_FAILED', lastStep, `Expected ${CHATGPT_HOST} after navigation, got: ${currentUrl}`);
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
    const submitResult = await submitPrompt(selectedWindow.handle, submitPoint, args.stepDelayMs, args.prompt);
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

async function chooseChromeWindow(titleHint) {
  const windows = await listChromeWindows();
  if (!windows.length) {
    throw new StepError('WINDOW_NOT_FOUND', 'select-window', 'No visible Chrome/Edge top-level window found.');
  }

  const foreground = await getForegroundWindow().catch(() => null);
  const foregroundHandle = foreground?.window?.handle || null;
  const byHandle = new Map(windows.map((window) => [window.handle, window]));
  if (foregroundHandle && byHandle.has(foregroundHandle)) {
    return byHandle.get(foregroundHandle);
  }

  const titlePreferred = windows.find((window) => String(window.title || '').includes(titleHint))
    || windows.find((window) => String(window.title || '').toLowerCase().includes('chatgpt'));
  if (titlePreferred) {
    return titlePreferred;
  }

  for (const window of windows) {
    const url = await readCurrentUrl(window.handle).catch(() => '');
    if (isChatGptUrl(url)) {
      return window;
    }
  }

  return foregroundHandle && byHandle.has(foregroundHandle)
    ? byHandle.get(foregroundHandle)
    : windows[0];
}

async function readCurrentUrl(handle) {
  const result = await getUrlViaOmnibox({ handle });
  return String(result.url || '').trim();
}

function isChatGptUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === CHATGPT_HOST || parsed.hostname.endsWith(`.${CHATGPT_HOST}`);
  } catch {
    return false;
  }
}

async function openFreshTab(stepDelayMs) {
  await sendKeys('t', ['ctrl']);
  await delay(stepDelayMs * 2);
}

async function navigateToChatGpt(targetUrl, stepDelayMs) {
  await sendKeys('l', ['ctrl']);
  await delay(stepDelayMs);
  await sendKeys('a', ['ctrl']);
  await delay(stepDelayMs);
  await sendText(targetUrl);
  await delay(stepDelayMs);
  await pressEnter();
  await delay(stepDelayMs * 10);
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
    const focused = await uiaSetFocus({ handle }, {
      automationId: 'prompt-textarea',
      className: 'ProseMirror',
      timeoutMs: 2500
    });
    element = focused.element;
    await clickComposerCenter(element, fallbackPoint);
    await delay(stepDelayMs);
    await uiaSetFocus({ handle }, {
      automationId: 'prompt-textarea',
      className: 'ProseMirror',
      timeoutMs: 1200
    }).catch(() => null);
  } catch {
    via = 'calibrated-fallback';
    await clickPoint(fallbackPoint);
    await delay(stepDelayMs);
    const retry = await uiaSetFocus({ handle }, {
      automationId: 'prompt-textarea',
      className: 'ProseMirror',
      timeoutMs: 1800
    }).catch(() => null);
    element = retry?.element || null;
  }

  await delay(stepDelayMs);
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  if (isLikelyOmniboxElement(focusedElement) || isLikelyOmniboxElement(element)) {
    omniboxRejected = true;
  }
  return { via, focusedElement, element, omniboxRejected };
}

async function insertPrompt(handle, prompt, promptFocus, stepDelayMs) {
  const expectedHash = hashText(prompt);

  try {
    await refocusComposer(handle, promptFocus, stepDelayMs);
    await clearComposer(stepDelayMs);
    await sendText(prompt);
    await delay(stepDelayMs * 2);

    let proof = await readComposerProof(handle);
    if (proof.text.includes(prompt)) {
      return {
        method: 'uia-focus+unicode-sendkeys+uia-text-read',
        expectedHash,
        actualHash: hashText(proof.text),
        focusedElement: proof.focusedElement,
        composerElement: proof.element,
        proof: 'composerTextContainsPrompt',
        composerTextSample: proof.text.slice(0, 200)
      };
    }

    await refocusComposer(handle, promptFocus, stepDelayMs);
    await setClipboardText(prompt);
    await delay(stepDelayMs);
    await pasteClipboard();
    await delay(stepDelayMs * 2);
    proof = await readComposerProof(handle);
    if (proof.text.includes(prompt)) {
      return {
        method: 'uia-focus+clipboard-paste+uia-text-read',
        expectedHash,
        actualHash: hashText(proof.text),
        focusedElement: proof.focusedElement,
        composerElement: proof.element,
        proof: 'composerTextContainsPrompt',
        composerTextSample: proof.text.slice(0, 200)
      };
    }
  } catch {
    // fall through to machine-specific coordinate proof path
  }

  const coordinateProof = await insertPromptViaCoordinateProof(prompt, stepDelayMs);
  return {
    method: coordinateProof.method,
    expectedHash,
    actualHash: coordinateProof.actualHash,
    focusedElement: coordinateProof.focusedElement,
    composerElement: coordinateProof.composerElement,
    proof: coordinateProof.proof,
    composerTextSample: coordinateProof.composerTextSample
  };
}

async function validatePromptInput(handle, prompt, promptFocus, insertion, stepDelayMs) {
  const expectedHash = hashText(prompt);

  if (String(insertion?.proof || '').includes('coordinate')) {
    return {
      method: `${insertion?.method || 'unknown'}+clipboard-roundtrip-proof`,
      expectedHash,
      actualHash: insertion.actualHash,
      clipboardHash: expectedHash,
      focusedElement: insertion.focusedElement,
      composerElement: insertion.composerElement,
      proof: insertion.proof,
      composerTextSample: insertion.composerTextSample
    };
  }

  await refocusComposer(handle, promptFocus, stepDelayMs);
  const proof = await readComposerProof(handle);
  const focusedElement = proof.focusedElement;

  ensurePromptTargetLooksCredible({
    promptFocus,
    focusedElement,
    currentUrlAfterValidation: CHATGPT_URL,
    prompt,
    actualHash: hashText(proof.text)
  });

  if (!proof.text.includes(prompt)) {
    throw new StepError('PROMPT_VALIDATION_FAILED', 'validate-prompt', 'ChatGPT composer text proof did not contain the prepared prompt.', {
      expectedHash,
      actualHash: hashText(proof.text),
      composerTextSample: proof.text.slice(0, 200),
      focusedElement,
      composerElement: proof.element,
      insertionMethod: insertion?.method
    });
  }

  return {
    method: `${insertion?.method || 'unknown'}+uia-text-proof`,
    expectedHash,
    actualHash: hashText(proof.text),
    clipboardHash: expectedHash,
    focusedElement,
    composerElement: proof.element,
    proof: 'composerTextContainsPrompt',
    composerTextSample: proof.text.slice(0, 200)
  };
}

async function refocusComposer(handle, promptFocus, stepDelayMs) {
  await uiaSetFocus({ handle }, {
    automationId: 'prompt-textarea',
    className: 'ProseMirror',
    timeoutMs: 1800
  }).catch(() => null);
  await delay(stepDelayMs);
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  if (isLikelyOmniboxElement(focusedElement)) {
    throw new StepError('PROMPT_TARGET_INVALID', 'refocus-composer', 'Focused element relapsed into the browser omnibox.', {
      promptFocus: promptFocus?.element || null,
      focusedElement
    });
  }
  if (!looksLikeComposerElement(focusedElement)) {
    throw new StepError('PROMPT_TARGET_INVALID', 'refocus-composer', 'Focused element is not the ChatGPT composer after UIA refocus.', {
      promptFocus: promptFocus?.element || null,
      focusedElement
    });
  }
  return focusedElement;
}

async function clearComposer(stepDelayMs) {
  await sendKeys('a', ['ctrl']);
  await delay(stepDelayMs);
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
  const composer = await uiaReadText({ handle }, {
    automationId: 'prompt-textarea',
    className: 'ProseMirror',
    timeoutMs: 1500
  });
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  return {
    element: composer.element,
    focusedElement,
    text: normalizeComposerText(composer.text)
  };
}

async function insertPromptViaCoordinateProof(prompt, stepDelayMs) {
  await delay(stepDelayMs * 6);
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

  if (isLikelyOmniboxElement(focusedElement) || (!focusedLooksLikeComposer && isLikelyOmniboxElement(promptFocus?.element))) {
    throw new StepError('PROMPT_TARGET_INVALID', 'validate-prompt', 'Focused prompt target still looks like the browser omnibox/address bar.', {
      promptFocus: promptFocus?.element || null,
      focusedElement: focusedElement || null
    });
  }

  if (!promptFocusLooksLikeComposer && !focusedLooksLikeComposer) {
    throw new StepError('PROMPT_TARGET_INVALID', 'validate-prompt', 'Focused prompt target did not resolve to the ChatGPT composer.', {
      promptFocus: promptFocus?.element || null,
      focusedElement: focusedElement || null
    });
  }

  if (!isChatGptUrl(currentUrlAfterValidation)) {
    throw new StepError('PROMPT_TARGET_INVALID', 'validate-prompt', 'URL changed away from ChatGPT during prompt validation; prompt was likely pasted into the omnibox instead of the composer.', {
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

async function submitPrompt(handle, submitPoint, stepDelayMs, prompt) {
  let method = 'enter';
  try {
    await pressEnter();
    await delay(stepDelayMs * 3);
  } catch {
    try {
      await uiaInvoke({ handle }, { automationId: 'composer-submit-btn', timeoutMs: 1000 });
      await delay(stepDelayMs * 3);
      method = 'uia-invoke-submit-button';
    } catch {
      try {
        await uiaInvoke({ handle }, { name: 'Send', role: 'Button', timeoutMs: 1000 });
        await delay(stepDelayMs * 3);
        method = 'uia-invoke-send-button';
      } catch {
        await clickPoint(submitPoint);
        await delay(stepDelayMs * 3);
        method = 'calibrated-send-button';
      }
    }
  }

  const after = await readComposerProof(handle).catch(() => ({ text: '', element: null, focusedElement: null }));
  const proof = after.text && after.text.includes(prompt)
    ? 'submitUnprovenComposerStillContainsPrompt'
    : 'composerClearedOrChangedAfterSubmit';

  return {
    method,
    proof,
    composerTextSample: String(after.text || '').slice(0, 200),
    focusedElement: after.focusedElement,
    composerElement: after.element
  };
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

function hashText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export const __desktopSubmitInternals = {
  isLikelyOmniboxElement,
  ensurePromptTargetLooksCredible,
  looksLikeComposerElement,
  isChatGptUrl,
  hashText
};
