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
  setClipboardText,
  uiaGetFocusedElement,
  uiaInvoke,
  uiaQueryByNameRole,
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
    notes.push('fallbackOrder=UIA>keyboard-omnibox>calibrated-coordinates');
    notes.push('desktopMode=deterministic-submit');
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

    lastStep = 'set-prompt-clipboard';
    await setClipboardText(args.prompt);
    clipboardHash = hashText(args.prompt);
    await writeJsonlLog(logPath, { step: lastStep, clipboardHash, promptLength: args.prompt.length });

    lastStep = 'paste-prompt';
    await pasteClipboard();
    await delay(args.stepDelayMs);
    await writeJsonlLog(logPath, { step: lastStep });

    lastStep = 'validate-prompt';
    const validation = await validatePromptInput(selectedWindow.handle, args.prompt, promptFocus, args.stepDelayMs, currentUrl);
    clipboardHash = validation.clipboardHash;
    lastFocusedElement = validation.focusedElement ?? lastFocusedElement;
    currentUrl = validation.currentUrlAfterValidation || currentUrl;
    notes.push(`promptHash=${validation.expectedHash}`);
    notes.push(`validationMethod=${validation.method}`);
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
    const submitResult = await submitPrompt(selectedWindow.handle, submitPoint, args.stepDelayMs);
    await writeJsonlLog(logPath, { step: lastStep, submitResult });
    notes.push(`submitMethod=${submitResult.method}`);

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
  await setClipboardText(targetUrl);
  await delay(stepDelayMs);
  await sendKeys('l', ['ctrl']);
  await delay(stepDelayMs);
  await pasteClipboard();
  await delay(stepDelayMs);
  await pressEnter();
  await delay(stepDelayMs * 6);
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
      timeoutMs: 1500
    });
    element = focused.element;
  } catch {
    try {
      const result = await uiaQueryByNameRole({ handle }, { role: 'Edit', timeoutMs: 1200 });
      element = result.element;
      if (isLikelyOmniboxElement(element)) {
        omniboxRejected = true;
        via = 'keyboard-escape-tab-sequence';
        await sendKeys('escape');
        await delay(stepDelayMs);
        await sendKeys('tab', ['shift']);
        await delay(stepDelayMs);
        await sendKeys('tab');
        await delay(stepDelayMs);
        await sendKeys('tab');
      } else {
        via = 'uia-role-edit';
        await uiaSetFocus({ handle }, {
          role: 'Edit',
          name: element?.name,
          automationId: element?.automationId,
          className: element?.className,
          timeoutMs: 800
        });
      }
    } catch {
      via = 'calibrated-fallback';
      await clickPoint(fallbackPoint);
    }
  }

  await delay(stepDelayMs);
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  return { via, focusedElement, element, omniboxRejected };
}

async function validatePromptInput(handle, prompt, promptFocus, stepDelayMs, currentUrlHint = CHATGPT_URL) {
  const expectedHash = hashText(prompt);
  await sendKeys('a', ['ctrl']);
  await delay(stepDelayMs);
  await sendKeys('c', ['ctrl']);
  await delay(stepDelayMs);
  const clipboard = await getClipboardText();
  const copied = String(clipboard.text || '');
  const actualHash = hashText(copied);
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  const currentUrlAfterValidation = currentUrlHint;

  if (expectedHash !== actualHash) {
    throw new StepError('PROMPT_VALIDATION_FAILED', 'validate-prompt', 'Clipboard hash after Ctrl+A/C did not match the prepared prompt.', {
      expectedHash,
      actualHash
    });
  }

  ensurePromptTargetLooksCredible({
    promptFocus,
    focusedElement,
    currentUrlAfterValidation,
    prompt,
    actualHash
  });

  return {
    method: 'clipboard-hash+composer-focus+url-precheck',
    expectedHash,
    actualHash,
    clipboardHash: actualHash,
    focusedElement,
    currentUrlAfterValidation
  };
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

async function submitPrompt(handle, submitPoint, stepDelayMs) {
  try {
    await pressEnter();
    await delay(stepDelayMs);
    return { method: 'enter' };
  } catch {
    // continue to fallback
  }

  try {
    await uiaInvoke({ handle }, { automationId: 'composer-submit-btn', timeoutMs: 1000 });
    await delay(stepDelayMs);
    return { method: 'uia-invoke-submit-button' };
  } catch {
    // continue to named button fallback
  }

  try {
    await uiaInvoke({ handle }, { name: 'Send', role: 'Button', timeoutMs: 1000 });
    await delay(stepDelayMs);
    return { method: 'uia-invoke-send-button' };
  } catch {
    // continue to calibrated fallback
  }

  await clickPoint(submitPoint);
  await delay(stepDelayMs);
  return { method: 'calibrated-send-button' };
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
