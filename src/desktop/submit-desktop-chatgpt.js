import { createFailureReceipt, createReceipt } from '../receipt.js';
import { StepError, ERROR_CODES } from '../errors.js';
import { parseDesktopSubmitArgs } from '../args.js';
import { loadCalibrationProfile } from './calibration-store.js';
import { getStandardWindowBounds, resolveAnchorPoint } from './geometry.js';
import {
  clickPoint,
  delay,
  focusWindowByTitle,
  pasteClipboard,
  pressEnter,
  resizeWindow,
  setClipboardText
} from './windows-input.js';

const CHATGPT_URL = 'https://chatgpt.com/';

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
  const notes = [];

  try {
    const args = await parseDesktopSubmitArgs(argv);
    enforceDesktopFirstConstraints(args);
    lastStep = 'load-calibration-profile';
    const calibration = await loadCalibrationProfile(args.calibrationProfile, {
      baseDir: args.calibrationDir
    });
    const targetBounds = getStandardWindowBounds(calibration);
    const titleHint = args.windowTitle || calibration?.window?.titleHint || 'ChatGPT';
    notes.push('transport=desktop');
    notes.push('transportStatus=default');
    notes.push(`desktopMode=windows-input`);
    notes.push(`calibrationProfile=${args.calibrationProfile}`);
    notes.push(`titleHint=${titleHint}`);
    notes.push(`targetBounds=${targetBounds.x},${targetBounds.y},${targetBounds.width},${targetBounds.height}`);

    lastStep = 'focus-window';
    if (!args.dryRun) {
      await focusWindowByTitle(titleHint);
      await delay(args.stepDelayMs);
    }

    lastStep = 'resize-window';
    if (!args.dryRun) {
      await resizeWindow(targetBounds);
      await delay(args.stepDelayMs);
    }

    const promptPoint = resolveAnchorPoint(calibration, 'promptInput', targetBounds);
    const submitPoint = resolveAnchorPoint(calibration, 'submitButton', targetBounds);
    notes.push(`promptPoint=${promptPoint.x},${promptPoint.y}`);
    notes.push(`submitPoint=${submitPoint.x},${submitPoint.y}`);

    lastStep = 'prepare-prompt';
    if (!args.dryRun) {
      await setClipboardText(args.prompt);
      await delay(args.stepDelayMs);
    }

    lastStep = 'click-prompt';
    if (!args.dryRun) {
      await clickPoint(promptPoint);
      await delay(args.stepDelayMs);
    }

    lastStep = 'paste-prompt';
    if (!args.dryRun) {
      await pasteClipboard();
      await delay(args.stepDelayMs);
    }

    if (args.submit) {
      lastStep = 'submit-prompt';
      if (!args.dryRun) {
        if (args.submitMethod === 'enter') {
          await pressEnter();
        } else {
          await clickPoint(submitPoint);
        }
      }
      notes.push(`submitMethod=${args.submitMethod}`);
    } else {
      notes.push('submit=false');
    }

    return createReceipt({
      submitted: args.submit && !args.dryRun,
      modeResolved: 'desktop-chatgpt',
      projectResolved: null,
      url: CHATGPT_URL,
      notes
    });
  } catch (error) {
    const normalizedError = error instanceof StepError
      ? error
      : new StepError(error?.code || ERROR_CODES.SUBMIT_FAILED, error?.step || lastStep, error?.message || String(error));
    notes.push(`lastStep=${lastStep}`);
    return createFailureReceipt({
      error: normalizedError,
      url: CHATGPT_URL,
      notes
    });
  }
}
