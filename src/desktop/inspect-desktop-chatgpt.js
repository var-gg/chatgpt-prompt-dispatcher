import { defaultLogPath, writeJsonlLog } from '../logger.js';
import {
  listChromeWindows,
  getForegroundWindow,
  getUrlViaOmnibox,
  getWindowRect,
  uiaGetFocusedElement,
  uiaQueryByNameRole,
  waitForWindow
} from './windows-input.js';
import { getDesktopWorkerClient, shutdownDesktopWorker } from './powershell.js';

export async function inspectDesktopChatgpt(argv = []) {
  const options = parseInspectArgs(argv);
  const logPath = defaultLogPath(`desktop-inspect-${options.calibrationProfile}`);

  try {
    const foreground = await getForegroundWindow().catch((error) => ({ error: { code: error.code, message: error.message } }));
    const chromeWindows = await listChromeWindows();
    const target = pickWindow(chromeWindows, options.windowTitle);
    if (!target) {
      const result = { ok: false, error: { code: 'WINDOW_NOT_FOUND', message: 'No visible Chrome window found.' }, foreground, chromeWindows };
      await writeJsonlLog(logPath, { step: 'inspect-failure', result });
      return result;
    }

    await waitForWindow({ handle: target.handle }, 1000).catch(() => null);
    const url = await getUrlViaOmnibox({ handle: target.handle }).catch((error) => ({ error: { code: error.code, message: error.message } }));
    const rect = await getWindowRect(target.handle).catch((error) => ({ error: { code: error.code, message: error.message } }));
    const focusedElement = await uiaGetFocusedElement().catch((error) => ({ error: { code: error.code, message: error.message } }));
    const promptCandidate = await uiaQueryByNameRole({ handle: target.handle }, { role: 'Edit', timeoutMs: 500 }).catch((error) => ({ error: { code: error.code, message: error.message } }));
    const snapshot = await getDesktopWorkerClient()
      .call('uiaSnapshot', { handle: target.handle, depth: options.depth }, { step: 'desktop-uia-snapshot', timeoutMs: 8000 })
      .catch((error) => ({ error: { code: error.code, message: error.message } }));

    const nearbySnapshot = snapshot?.tree
      ? snapshot
      : {
          synthetic: true,
          reason: snapshot?.error || null,
          tree: {
            focused: focusedElement?.element || null,
            promptCandidate: promptCandidate?.element || null
          }
        };

    const dump = {
      ok: true,
      inspectedAt: new Date().toISOString(),
      foreground,
      targetWindow: target,
      url,
      rect,
      focusedElement,
      promptCandidate,
      uiaSnapshot: nearbySnapshot
    };

    await writeJsonlLog(logPath, { step: 'inspect', dump });
    return dump;
  } finally {
    await shutdownDesktopWorker();
  }
}

function parseInspectArgs(argv = []) {
  const out = { depth: 2, calibrationProfile: 'default', windowTitle: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--depth') out.depth = Number(argv[++i]);
    else if (token === '--calibration-profile') out.calibrationProfile = argv[++i];
    else if (token === '--window-title') out.windowTitle = argv[++i];
  }
  return out;
}

function pickWindow(windows, titleHint) {
  return (
    windows.find((window) => titleHint && String(window.title || '').includes(titleHint)) ||
    windows.find((window) => String(window.title || '').toLowerCase().includes('chatgpt')) ||
    windows[0] ||
    null
  );
}

if (process.argv[1]?.endsWith('inspect-desktop-chatgpt.js')) {
  inspectDesktopChatgpt(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: { code: error.code || 'INSPECT_FAILED', message: error.message } }, null, 2));
      process.exitCode = 1;
    });
}
