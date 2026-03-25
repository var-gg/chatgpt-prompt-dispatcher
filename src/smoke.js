import path from 'node:path';
import { submitBrowserChatgpt } from './submit-browser-chatgpt.js';

export async function runSmoke(argv = []) {
  if (process.env.LIVE_CHATGPT !== '1') {
    console.log(JSON.stringify({
      skipped: true,
      reason: 'Set LIVE_CHATGPT=1 to enable live experimental browser smoke tests.'
    }, null, 2));
    return;
  }

  const [scenario = 'A', ...rest] = argv;
  const receipt = await runScenario(scenario, rest);
  console.log(JSON.stringify({
    scenario,
    submitted: receipt.submitted,
    receipt,
    failureArtifacts: {
      screenshotPath: receipt.screenshotPath ?? null,
      logPath: extractNote(receipt.notes, 'logPath=') ?? null,
      lastStep: extractNote(receipt.notes, 'lastStep=') ?? receipt.error?.step ?? null
    }
  }, null, 2));
}

async function runScenario(scenario, argv) {
  const attachmentPath = path.resolve('README.md');
  const profiles = parseSmokeArgs(argv);
  if (scenario === 'A') {
    return submitBrowserChatgpt([
      '--prompt', 'live smoke A new chat thinking prompt only',
      '--mode', 'thinking',
      '--profile', profiles.profile || 'ko-KR.windows.pro',
      '--browser-profile-dir', profiles.browserProfileDir || '.\\.tmp\\smoke-profile-a'
    ]);
  }
  if (scenario === 'B') {
    return submitBrowserChatgpt([
      '--prompt', 'live smoke B project attachment',
      '--project', profiles.project || 'Example Project',
      '--mode', profiles.mode || 'auto',
      '--attachment', attachmentPath,
      '--profile', profiles.profile || 'ko-KR.windows.pro',
      '--browser-profile-dir', profiles.browserProfileDir || '.\\.tmp\\smoke-profile-b'
    ]);
  }
  throw new Error(`Unknown smoke scenario: ${scenario}`);
}

function parseSmokeArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--profile') out.profile = argv[++i];
    else if (token === '--browser-profile-dir') out.browserProfileDir = argv[++i];
    else if (token === '--project') out.project = argv[++i];
    else if (token === '--mode') out.mode = argv[++i];
  }
  return out;
}

function extractNote(notes = [], prefix) {
  const match = notes.find((note) => typeof note === 'string' && note.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}
