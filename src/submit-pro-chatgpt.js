import { StepError, ERROR_CODES } from './errors.js';
import { submitDesktopChatgpt } from './desktop/submit-desktop-chatgpt.js';

export async function submitProChatgpt(argv = []) {
  return submitDesktopChatgpt(normalizeSubmitProArgs(argv));
}

export function normalizeSubmitProArgs(argv = []) {
  let hasMode = false;
  let hasNewChat = false;
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

    normalized.push(token);
  }

  if (!hasMode) {
    normalized.push('--mode', 'pro');
  }
  if (!hasNewChat) {
    normalized.push('--new-chat');
  }

  return normalized;
}
