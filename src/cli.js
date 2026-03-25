import { loadProfile } from './profile-loader.js';
import { validateConfig } from './config-schema.js';
import { submitChatgpt } from './submit-chatgpt.js';
import { warmupChatgpt } from './warmup-chatgpt.js';
import { runSmoke } from './smoke.js';
import { submitDesktopChatgpt } from './desktop/submit-desktop-chatgpt.js';

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

  if (command === 'warmup-chatgpt') {
    const receipt = await warmupChatgpt(argv.slice(1));
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  if (command === 'submit-desktop-chatgpt') {
    const receipt = await submitDesktopChatgpt(argv.slice(1));
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
    '  submit-chatgpt [opts]           Submit a prompt through visible browser automation',
    '  warmup-chatgpt [opts]           Open ChatGPT and hold the browser for manual login/captcha',
    '  submit-desktop-chatgpt [opts]   Submit a prompt through Windows desktop input using calibration',
    '',
    'Desktop mode notes:',
    '  - Uses a ChatGPT-specific calibration profile under profiles/desktop/',
    '  - Focuses/resizes a visible Chrome window and pastes the prompt locally',
  ].join('\n'));
}
