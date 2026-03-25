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

export async function parseSubmitArgs(argv = []) {
  const options = {
    attachments: [],
    dryRun: false,
    newChat: undefined,
    profile: 'default',
    mode: 'auto'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--prompt':
        options.prompt = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--prompt-file':
        options.promptFile = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--mode':
        options.mode = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--project':
        options.project = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--new-chat':
        options.newChat = true;
        break;
      case '--no-new-chat':
        options.newChat = false;
        break;
      case '--attachment':
        options.attachments.push(consumeValue(argv, i, token));
        i += 1;
        break;
      case '--profile':
        options.profile = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--screenshot-path':
        options.screenshotPath = consumeValue(argv, i, token);
        i += 1;
        break;
      case '--browser-profile-dir':
        options.browserProfileDir = consumeValue(argv, i, token);
        i += 1;
        break;
      default:
        throw new StepError(ERROR_CODES.INVALID_ARGS, 'parse-args', `Unknown argument: ${token}`);
    }
  }

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
