import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StepError, ERROR_CODES } from './errors.js';

function consumeValue(argv, index, token) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'parse-args', `Missing value for ${token}`);
  }
  return value;
}

function parseCommonArgs(argv = [], options = {}) {
  const parsed = {
    attachments: [],
    dryRun: false,
    newChat: undefined,
    profile: 'default',
    mode: 'auto',
    holdOpenMs: 0,
    ...options
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--prompt':
        parsed.prompt = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--prompt-file':
        parsed.promptFile = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--mode':
        parsed.mode = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--project':
        parsed.project = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--new-chat':
        parsed.newChat = true;
        break;
      case '--no-new-chat':
        parsed.newChat = false;
        break;
      case '--attachment':
        parsed.attachments.push(consumeValue(argv, i, token));
        i += 1;
        break;
      case '--profile':
        parsed.profile = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--screenshot-path':
        parsed.screenshotPath = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--browser-profile-dir':
        parsed.browserProfileDir = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--hold-open-ms':
        parsed.holdOpenMs = Number(consumeValue(argv, i, token));
        i += 1;
        break;
      default:
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'parse-args', `Unknown argument: ${token}`);
    }
  }

  if (!Number.isFinite(parsed.holdOpenMs) || parsed.holdOpenMs < 0) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'parse-args', '--hold-open-ms must be a non-negative number.');
  }

  return parsed;
}

export async function parseSubmitArgs(argv = []) {
  const options = parseCommonArgs(argv);

  if (!options.prompt && !options.promptFile) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'parse-args', 'Either --prompt or --prompt-file is required.');
  }

  if (options.prompt && options.promptFile) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'parse-args', 'Use either --prompt or --prompt-file, not both.');
  }

  if (options.promptFile) {
    const resolved = path.resolve(options.promptFile);
    options.prompt = await readFile(resolved, 'utf8');
    options.promptFile = resolved;
  }

  if (options.newChat === undefined) {
    options.newChat = !options.project;
  }

  return options;
}

export async function parseWarmupArgs(argv = []) {
  const options = parseCommonArgs(argv, { holdOpenMs: 30 * 60 * 1000 });
  return options;
}
