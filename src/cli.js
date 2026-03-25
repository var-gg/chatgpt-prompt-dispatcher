import { loadProfile } from './profile-loader.js';
import { validateConfig } from './config-schema.js';

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
    console.log('Smoke scaffold OK');
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
    '',
    'TODO:',
    '  Add visible browser automation dispatch commands.',
  ].join('\n'));
}
