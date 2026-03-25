import { loadProfile } from './profile-loader.js';
import { validateConfig } from './config-schema.js';
import { submitChatgpt } from './submit-chatgpt.js';
import { submitBrowserChatgpt } from './submit-browser-chatgpt.js';
import { warmupChatgpt } from './warmup-chatgpt.js';
import { runSmoke } from './smoke.js';
import { submitDesktopChatgpt } from './desktop/submit-desktop-chatgpt.js';
import { calibrateDesktopChatgpt } from './desktop/calibrate-desktop-chatgpt.js';
import { inspectDesktopChatgpt } from './desktop/inspect-desktop-chatgpt.js';

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

  if (command === 'submit-browser-chatgpt') {
    const receipt = await submitBrowserChatgpt(argv.slice(1));
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

  if (command === 'calibrate-desktop-chatgpt') {
    const result = await calibrateDesktopChatgpt(argv.slice(1));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'inspect-desktop-chatgpt') {
    const result = await inspectDesktopChatgpt(argv.slice(1));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log([
    'chatgpt-prompt-dispatcher',
    '',
    'Commands:',
    '  help                              Show help',
    '  profile:show <name>               Load and print a sample profile',
    '  smoke                             Run placeholder smoke check',
    '  submit-chatgpt [opts]             Submit a prompt through the default Windows desktop transport',
    '  submit-browser-chatgpt [opts]     Submit through the experimental browser transport (Playwright)',
    '  warmup-chatgpt [opts]             Open ChatGPT and hold the browser for manual login/captcha',
    '  submit-desktop-chatgpt [opts]     Explicit alias for the default Windows desktop transport',
    '  calibrate-desktop-chatgpt [opts]  Interactively capture desktop anchors and save a calibration profile',
    '  inspect-desktop-chatgpt [opts]    Dump URL, window rect, focus element, and UIA snapshot as JSON',
    '',
    'Transport notes:',
    '  - submit-chatgpt defaults to the Windows desktop input dispatcher',
    '  - pass --transport=browser or use submit-browser-chatgpt for the experimental browser path',
    '  - no command in this repo reads or scrapes assistant responses',
  ].join('\n'));
}
