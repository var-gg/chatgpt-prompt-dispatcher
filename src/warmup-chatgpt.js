import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadProfile } from './profile-loader.js';
import { validateConfig } from './config-schema.js';
import { parseWarmupArgs } from './args.js';
import { StepError } from './errors.js';
import { createReceipt, createFailureReceipt } from './receipt.js';
import { buildFlowPlan } from './browser-flow.js';
import { defaultLogPath, writeJsonlLog } from './logger.js';
import { createPlaywrightAutomationSession } from './playwright-runtime.js';

const CHATGPT_URL = 'https://chatgpt.com/';

export async function warmupChatgpt(argv = []) {
  let screenshotPath = null;
  let currentUrl = CHATGPT_URL;
  let lastStep = 'start';
  let logPath = null;
  const notes = [];

  try {
    const args = await parseWarmupArgs(argv);
    lastStep = 'load-profile';
    const profile = validateConfig(await loadProfile(args.profile));
    const flowPlan = buildFlowPlan(profile, { ...args, project: null, mode: args.mode || 'auto' });
    screenshotPath = resolveScreenshotPath(args.screenshotPath, args.profile);
    logPath = defaultLogPath(`${args.profile}-warmup`);

    await writeJsonlLog(logPath, {
      step: 'init',
      profile: args.profile,
      holdOpenMs: args.holdOpenMs,
      browserProfileDir: args.browserProfileDir ? path.resolve(args.browserProfileDir) : null
    });

    const automation = await createAutomationSession({ profile, args, screenshotPath, notes, flowPlan, logPath });

    try {
      lastStep = 'launch-browser';
      await automation.launchPersistentBrowser();
      await writeJsonlLog(logPath, { step: lastStep });

      lastStep = 'navigate-chatgpt';
      await automation.navigateToChatgpt();
      await writeJsonlLog(logPath, { step: lastStep, url: currentUrl });

      lastStep = 'ensure-login';
      await automation.ensureLoggedInOrWait();
      await writeJsonlLog(logPath, { step: lastStep });

      lastStep = 'capture-screenshot';
      await automation.captureScreenshot();
      await writeJsonlLog(logPath, { step: lastStep, screenshotPath });

      lastStep = 'hold-open';
      await writeJsonlLog(logPath, { step: lastStep, holdOpenMs: args.holdOpenMs, message: 'Browser will stay open for manual verification.' });
      await automation.holdOpen(args.holdOpenMs);
    } finally {
      await automation.close();
    }

    notes.push(`logPath=${logPath}`);
    notes.push(`lastStep=${lastStep}`);
    notes.push(`holdOpenMs=${args.holdOpenMs}`);
    return createReceipt({
      submitted: false,
      modeResolved: 'warmup',
      projectResolved: null,
      url: currentUrl,
      screenshotPath,
      notes
    });
  } catch (error) {
    const normalizedError = error instanceof StepError
      ? error
      : new StepError(error?.code || 'UNEXPECTED_ERROR', error?.step || lastStep || 'unknown', error?.message || String(error));
    if (logPath) {
      await writeJsonlLog(logPath, { step: 'failure', lastStep, code: normalizedError.code, message: normalizedError.message, screenshotPath });
    }
    notes.push(`lastStep=${lastStep}`);
    if (logPath) {
      notes.push(`logPath=${logPath}`);
    }
    return createFailureReceipt({
      error: normalizedError,
      screenshotPath,
      url: currentUrl,
      notes
    });
  }
}

function resolveScreenshotPath(explicitPath, profileName) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return path.resolve('artifacts', 'screenshots', `${profileName}-warmup-last.png`);
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function createAutomationSession({ profile, args, screenshotPath, notes, flowPlan, logPath }) {
  await ensureParentDir(screenshotPath);
  notes.push(`profileLocale=${profile.browser.locale || 'unknown'}`);
  const trace = async (event) => {
    if (logPath) {
      await writeJsonlLog(logPath, event);
    }
  };
  return createPlaywrightAutomationSession({ profile, args, screenshotPath, notes, flowPlan, ensureParentDir, trace });
}
