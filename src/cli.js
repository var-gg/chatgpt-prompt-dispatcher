import { loadProfile } from './profile-loader.js';
import { validateConfig } from './config-schema.js';
import { submitChatgpt } from './submit-chatgpt.js';
import { runSmoke } from './smoke.js';

/**
 * CLI entrypoint scaffold.
 * TODO: replace placeholder command routing with real automation flows.
 */
export async function runCli(argv = []) {
  const [command = 'help', maybeProfile] = argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'profile:show') {
    const profile = await loadProfile(maybeProfile || 'default');
    validateConfig(profile);
    console.log(JSON.stringify(profile, null, 2));
    return;
  }

  if (command === 'smoke') {
    await runSmoke(argv.slice(1));
    return;
  }

  if (command === 'submit-chatgpt') {
    const receipt = await submitChatgpt(argv.slice(1));
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log([
    'chatgpt-prompt-dispatcher',
    '',
    'Commands:',
    '  help                     Show help',
    '  profile:show <name>      Load and print a sample profile',
    '  smoke                    Run placeholder smoke check',
    '  submit-chatgpt [opts]    Submit a prompt through visible browser automation',
    '',
    'TODO:',
    '  Add visible browser automation dispatch commands.',
  ].join('\n'));
}
