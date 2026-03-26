import { StepError, ERROR_CODES } from './errors.js';
import { submitDesktopChatgpt } from './desktop/submit-desktop-chatgpt.js';

export async function submitProChatgpt(argv = []) {
  return submitDesktopChatgpt(normalizeSubmitProArgs(argv));
}

export function normalizeSubmitProArgs(argv = []) {
  let hasMode = false;
  let hasNewChat = false;
  let hasSurface = false;
  let hasProofLevel = false;
  let hasSubmitMethod = false;
  const normalized = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--transport') {
      const value = argv[i + 1];
      if (value && value !== 'desktop') {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports the desktop transport.');
      }
      i += 1;
      continue;
    }

    if (token.startsWith('--transport=')) {
      const value = token.slice('--transport='.length);
      if (value && value !== 'desktop') {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports the desktop transport.');
      }
      continue;
    }

    if (token === '--mode') {
      const value = argv[i + 1];
      if (value !== 'pro') {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt always runs with --mode pro.');
      }
      hasMode = true;
      normalized.push(token, value);
      i += 1;
      continue;
    }

    if (token.startsWith('--mode=')) {
      const value = token.slice('--mode='.length);
      if (value !== 'pro') {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt always runs with --mode pro.');
      }
      hasMode = true;
      normalized.push(token);
      continue;
    }

    if (token === '--new-chat') {
      hasNewChat = true;
      normalized.push(token);
      continue;
    }

    if (token === '--no-new-chat') {
      throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt always starts a new chat.');
    }

    if (token === '--surface') {
      const value = argv[i + 1];
      if (!['same-window', 'new-window'].includes(value)) {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports --surface same-window or --surface new-window.');
      }
      hasSurface = true;
      normalized.push(token, value);
      i += 1;
      continue;
    }

    if (token.startsWith('--surface=')) {
      const value = token.slice('--surface='.length);
      if (!['same-window', 'new-window'].includes(value)) {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports --surface same-window or --surface new-window.');
      }
      hasSurface = true;
      normalized.push(token);
      continue;
    }

    if (token === '--proof-level') {
      const value = argv[i + 1];
      if (!['fast', 'strict'].includes(value)) {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports --proof-level fast or --proof-level strict.');
      }
      hasProofLevel = true;
      normalized.push(token, value);
      i += 1;
      continue;
    }

    if (token.startsWith('--proof-level=')) {
      const value = token.slice('--proof-level='.length);
      if (!['fast', 'strict'].includes(value)) {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports --proof-level fast or --proof-level strict.');
      }
      hasProofLevel = true;
      normalized.push(token);
      continue;
    }

    if (token === '--submit-method') {
      const value = argv[i + 1];
      if (!['click', 'enter'].includes(value)) {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports --submit-method click or enter.');
      }
      hasSubmitMethod = true;
      normalized.push(token, value);
      i += 1;
      continue;
    }

    if (token.startsWith('--submit-method=')) {
      const value = token.slice('--submit-method='.length);
      if (!['click', 'enter'].includes(value)) {
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'submit-pro-chatgpt', 'submit-pro-chatgpt only supports --submit-method click or enter.');
      }
      hasSubmitMethod = true;
      normalized.push(token);
      continue;
    }

    normalized.push(token);
  }

  if (!hasMode) {
    normalized.push('--mode', 'pro');
  }
  if (!hasNewChat) {
    normalized.push('--new-chat');
  }
  if (!hasSurface) {
    normalized.push('--surface', 'new-window');
  }
  if (!hasProofLevel) {
    normalized.push('--proof-level', 'strict');
  }
  if (!hasSubmitMethod) {
    normalized.push('--submit-method', 'enter');
  }

  return normalized;
}
