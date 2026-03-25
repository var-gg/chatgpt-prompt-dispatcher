import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultLogPath, writeJsonlLog } from '../logger.js';
import { normalizePoint } from './geometry.js';
import { getCalibrationProfilePath, loadCalibrationProfile, saveCalibrationProfile } from './calibration-store.js';
import { getForegroundWindow, getWindowRect, getCursorPos, uiaElementFromPoint, focusWindow, resizeWindow } from './windows-input.js';
import { shutdownDesktopWorker } from './powershell.js';

const ANCHORS = [
  'promptInput',
  'submitButton',
  'newChatButton',
  'modeButton',
  'projectButton',
  'toolsButton',
  'attachButton'
];

export async function calibrateDesktopChatgpt(argv = []) {
  const options = parseArgs(argv);
  const logPath = defaultLogPath(`desktop-calibrate-${options.profile}`);
  const rl = readline.createInterface({ input, output });

  try {
    const existing = await loadCalibrationProfile(options.profile, { baseDir: options.baseDir }).catch(() => null);
    const foreground = await getForegroundWindow();
    const handle = foreground.window.handle;
    const rectResult = await getWindowRect(handle);
    const currentRect = rectResult.window.rect;

    await writeJsonlLog(logPath, { step: 'start', profile: options.profile, handle, currentRect });
    output.write(`Calibrating profile: ${options.profile}\n`);
    output.write(`Target window: ${foreground.window.title}\n`);
    await rl.question('Press Enter to normalize the current foreground Chrome window to its standard bounds...');

    const targetBounds = existing?.window?.targetBounds || currentRect;
    await focusWindow(handle);
    await resizeWindow(targetBounds, handle);
    const normalizedWindow = (await getWindowRect(handle)).window;

    const profile = {
      version: 2,
      profileName: options.profile,
      app: 'chatgpt-desktop-dispatcher',
      window: {
        titleHint: options.windowTitle || existing?.window?.titleHint || 'ChatGPT',
        targetBounds: normalizedWindow.rect,
        capturedRect: currentRect
      },
      anchors: {},
      notes: [
        'Interactive desktop calibration profile.',
        'Anchors include normalized coordinates and optional UIA metadata.'
      ]
    };

    for (const anchorName of ANCHORS) {
      output.write(`\nAnchor: ${anchorName}\n`);
      output.write('Move the mouse cursor over the target UI element, then press Enter.\n');
      const answer = await rl.question('Press Enter to capture, or type skip to leave it empty: ');
      if (answer.trim().toLowerCase() === 'skip') continue;
      const pointResult = await getCursorPos();
      const point = pointResult.point;
      const normalized = normalizePoint(point, normalizedWindow.rect);
      const uia = await uiaElementFromPoint(point.x, point.y).catch(() => null);
      profile.anchors[anchorName] = {
        x: normalized.x,
        y: normalized.y,
        capturedPoint: point,
        accessible: uia?.element ? {
          name: uia.element.name,
          role: uia.element.role,
          controlType: uia.element.controlType,
          automationId: uia.element.automationId,
          className: uia.element.className
        } : null
      };
      await writeJsonlLog(logPath, { step: 'capture-anchor', anchorName, anchor: profile.anchors[anchorName] });
    }

    const savedPath = await saveCalibrationProfile(options.profile, profile, { baseDir: options.baseDir });
    await writeJsonlLog(logPath, { step: 'saved', savedPath });
    return { ok: true, savedPath, profilePath: getCalibrationProfilePath(options.profile, options.baseDir), profile };
  } finally {
    rl.close();
    await shutdownDesktopWorker();
  }
}

function parseArgs(argv = []) {
  const out = { profile: 'default', baseDir: undefined, windowTitle: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--profile' || token === '--calibration-profile') out.profile = argv[++i];
    else if (token === '--calibration-dir') out.baseDir = argv[++i];
    else if (token === '--window-title') out.windowTitle = argv[++i];
  }
  return out;
}

if (process.argv[1]?.endsWith('calibrate-desktop-chatgpt.js')) {
  calibrateDesktopChatgpt(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: { code: error.code || 'CALIBRATION_FAILED', message: error.message } }, null, 2));
      process.exitCode = 1;
    });
}
