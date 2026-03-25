import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadProfile } from './profile-loader.js';
import { validateConfig } from './config-schema.js';
import { parseSubmitArgs } from './args.js';
import { StepError, ERROR_CODES } from './errors.js';
import { createReceipt, createFailureReceipt } from './receipt.js';
import { buildFlowPlan } from './browser-flow.js';
import { defaultLogPath, writeJsonlLog } from './logger.js';

const CHATGPT_URL = 'https://chatgpt.com/';
const SUPPORTED_MODES = new Set(['auto', 'latest', 'instant', 'thinking', 'pro']);

export async function submitChatgpt(argv = []) {
  let screenshotPath = null;
  let currentUrl = CHATGPT_URL;
  let lastStep = 'start';
  let logPath = null;
  const notes = [];

  try {
    const args = await parseSubmitArgs(argv);
    lastStep = 'load-profile';
    const profile = validateConfig(await loadProfile(args.profile));
    const modeResolved = resolveMode(args.mode);
    const projectResolved = args.project || null;
    const flowPlan = buildFlowPlan(profile, { ...args, mode: modeResolved, project: projectResolved });
    screenshotPath = resolveScreenshotPath(args.screenshotPath, args.profile);
    logPath = defaultLogPath(args.profile);

    await writeJsonlLog(logPath, { step: 'init', profile: args.profile, modeResolved, projectResolved, dryRun: args.dryRun, attachmentCount: args.attachments.length });
    notes.push(`profile=${args.profile}`);
    notes.push(`uiTier=${flowPlan.tier}`);
    if (args.browserProfileDir) {
      notes.push(`browserProfileDir=${path.resolve(args.browserProfileDir)}`);
    } else {
      notes.push('browserProfileDir=profile-default');
    }

    if (args.dryRun) {
      lastStep = 'dry-run-plan';
      notes.push('dryRun=true');
      notes.push(`wouldNavigate=${CHATGPT_URL}`);
      notes.push(`projectAction=${flowPlan.project.action}`);
      if (projectResolved) notes.push(`wouldSelectProject=${projectResolved}`);
      notes.push(`newChatAction=${flowPlan.newChat.action}`);
      notes.push(`modeAction=${flowPlan.mode.action}:${modeResolved}`);
      if (args.attachments.length) notes.push(`wouldAttachFiles=${args.attachments.length}`);
      notes.push(`promptLength=${args.prompt.length}`);
      await captureDryRunScreenshot(screenshotPath, flowPlan);
      await writeJsonlLog(logPath, { step: 'dry-run-ready', lastStep, screenshotPath, flowPlanProfile: flowPlan.profileName, flowPlanLocale: flowPlan.locale });
      notes.push(`flowPlanProfile=${flowPlan.profileName}`);
      notes.push(`flowPlanLocale=${flowPlan.locale}`);
      notes.push(`logPath=${logPath}`);
      notes.push(`lastStep=${lastStep}`);
      return createReceipt({
        submitted: false,
        modeResolved,
        projectResolved,
        url: currentUrl,
        screenshotPath,
        notes
      });
    }

    const automation = await createAutomationSession({ profile, args, screenshotPath, notes });

    try {
      lastStep = 'launch-browser';
      await automation.launchPersistentBrowser();
      await writeJsonlLog(logPath, { step: lastStep });
      lastStep = 'navigate-chatgpt';
      await automation.navigateToChatgpt();
      currentUrl = CHATGPT_URL;
      await writeJsonlLog(logPath, { step: lastStep, url: currentUrl });
      lastStep = 'ensure-login';
      await automation.ensureLoggedInOrWait();
      await writeJsonlLog(logPath, { step: lastStep });
      if (projectResolved) {
        lastStep = 'select-project';
        await automation.selectProject(projectResolved);
        await writeJsonlLog(logPath, { step: lastStep, projectResolved });
      }
      if (args.newChat) {
        lastStep = 'start-new-chat';
        await automation.startNewChat();
        await writeJsonlLog(logPath, { step: lastStep });
      }
      lastStep = 'select-mode';
      await automation.selectMode(modeResolved);
      await writeJsonlLog(logPath, { step: lastStep, modeResolved });
      if (args.attachments.length) {
        lastStep = 'attach-files';
        await automation.attachFiles(args.attachments);
        await writeJsonlLog(logPath, { step: lastStep, attachmentCount: args.attachments.length });
      }
      lastStep = 'input-prompt';
      await automation.inputPrompt(args.prompt);
      await writeJsonlLog(logPath, { step: lastStep, promptLength: args.prompt.length });
      lastStep = 'submit-prompt';
      await automation.submitPrompt();
      await writeJsonlLog(logPath, { step: lastStep });
      lastStep = 'capture-screenshot';
      await automation.captureScreenshot();
      await writeJsonlLog(logPath, { step: lastStep, screenshotPath });
    } finally {
      await automation.close();
    }

    notes.push(`logPath=${logPath}`);
    notes.push(`lastStep=${lastStep}`);
    return createReceipt({
      submitted: true,
      modeResolved,
      projectResolved,
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
    const failure = createFailureReceipt({
      error: normalizedError,
      screenshotPath,
      url: currentUrl,
      notes
    });
    return failure;
  }
}

function resolveMode(mode) {
  if (!SUPPORTED_MODES.has(mode)) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'resolve-mode', `Unsupported mode: ${mode}`);
  }
  return mode;
}

function resolveScreenshotPath(explicitPath, profileName) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return path.resolve('artifacts', 'screenshots', `${profileName}-last.png`);
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function captureDryRunScreenshot(screenshotPath, flowPlan) {
  await ensureParentDir(screenshotPath);
  const { writeFile } = await import('node:fs/promises');
  const payload = Buffer.from(`DRY-RUN\n${JSON.stringify(flowPlan, null, 2)}\n`, 'utf8');
  await writeFile(screenshotPath, payload);
}

async function createAutomationSession({ profile, args, screenshotPath, notes }) {
  await ensureParentDir(screenshotPath);
  notes.push(`profileLocale=${profile.browser.locale || 'unknown'}`);

  // TODO: Replace this scaffold with a real Playwright-backed persistent context.
  // Intentionally no response scraping code is included.
  return {
    async launchPersistentBrowser() {
      notes.push('launchPersistentBrowser=TODO');
      if (!args.browserProfileDir) {
        notes.push('usingProfileFromHostBrowser=true');
      }
    },
    async navigateToChatgpt() {
      notes.push('navigateToChatgpt=TODO');
    },
    async ensureLoggedInOrWait() {
      notes.push('ensureLoggedInOrWait=TODO');
      // TODO: detect login state from visible UI only; if not logged in, wait for user manual login.
    },
    async selectProject(projectName) {
      if (!projectName) {
        throw new StepError(ERROR_CODES.PROJECT_SELECTION_FAILED, 'select-project', 'Project name missing.');
      }
      notes.push(`selectProject=${projectName}`);
    },
    async startNewChat() {
      notes.push('startNewChat=TODO');
    },
    async selectMode(modeResolved) {
      notes.push(`selectMode=${modeResolved}`);
    },
    async attachFiles(attachments) {
      notes.push(`attachFiles=${attachments.length}`);
    },
    async inputPrompt(prompt) {
      if (!prompt?.trim()) {
        throw new StepError(ERROR_CODES.PROMPT_INPUT_FAILED, 'input-prompt', 'Prompt is empty after trimming.');
      }
      notes.push(`inputPromptChars=${prompt.length}`);
    },
    async submitPrompt() {
      notes.push('submitPrompt=TODO');
    },
    async captureScreenshot() {
      try {
        const pngStub = Buffer.from('89504E470D0A1A0A', 'hex');
        await ensureParentDir(screenshotPath);
        const { writeFile } = await import('node:fs/promises');
        await writeFile(screenshotPath, pngStub);
        notes.push(`screenshotCaptured=${screenshotPath}`);
      } catch (error) {
        throw new StepError(ERROR_CODES.SCREENSHOT_FAILED, 'capture-screenshot', error.message);
      }
    },
    async close() {
      notes.push('closeBrowser=TODO');
    }
  };
}
