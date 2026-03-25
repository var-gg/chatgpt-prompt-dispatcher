import { access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { StepError, ERROR_CODES } from './errors.js';
import { candidateSequence, modeCandidates, resolveUiProfile, toolCandidates } from './ui-profile.js';

const CHATGPT_URL = 'https://chatgpt.com/';
const DEFAULT_TIMEOUT_MS = 15000;
const LOGIN_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

export async function createPlaywrightAutomationSession({ profile, args, screenshotPath, notes, flowPlan, ensureParentDir }) {
  const resolvedUi = resolveUiProfile(profile, args);
  const state = {
    browserContext: null,
    page: null,
    userDataDir: await resolveAutomationProfileDir(args, profile, notes),
    firstRun: false,
    launchedChannel: null
  };

  await ensureParentDir(screenshotPath);
  state.firstRun = await isFirstRunProfile(state.userDataDir);

  return {
    async launchPersistentBrowser() {
      const channels = ['msedge', 'chrome'];
      let lastError = null;
      for (const channel of channels) {
        try {
          state.browserContext = await chromium.launchPersistentContext(state.userDataDir, {
            headless: false,
            channel,
            viewport: { width: 1440, height: 1024 },
            locale: profile.browser?.locale || 'ko-KR',
            acceptDownloads: false
          });
          state.launchedChannel = channel;
          notes.push(`browserChannel=${channel}`);
          break;
        } catch (error) {
          lastError = error;
          notes.push(`browserChannelFailed=${channel}:${error.message}`);
        }
      }
      if (!state.browserContext) {
        throw new StepError(ERROR_CODES.PROFILE_LOAD_FAILED, 'launch-browser', lastError?.message || 'Failed to launch persistent browser context.');
      }
      state.page = state.browserContext.pages()[0] || await state.browserContext.newPage();
      state.page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    },

    async navigateToChatgpt() {
      try {
        await state.page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
        await state.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        notes.push(`navigatedUrl=${state.page.url()}`);
      } catch (error) {
        throw new StepError(ERROR_CODES.NAVIGATION_FAILED, 'navigate-chatgpt', error.message);
      }
    },

    async ensureLoggedInOrWait() {
      if (await isLoggedIn(state.page)) {
        notes.push('loginState=ready');
        return;
      }
      notes.push('loginState=manual-required');
      if (state.firstRun) {
        notes.push('automationProfileFirstRun=true');
      }
      notes.push('manualLoginInstruction=Please complete login in the opened automation browser window.');
      try {
        await state.page.bringToFront().catch(() => {});
        await state.page.waitForFunction(() => {
          const text = document.body?.innerText || '';
          const hasPrompt = !!document.querySelector('textarea, div[contenteditable="true"], [role="textbox"]');
          const loginWords = ['Log in', '로그인', 'Sign up', '회원가입'];
          const looksLoggedOut = loginWords.some((word) => text.includes(word));
          return hasPrompt && !looksLoggedOut;
        }, { timeout: LOGIN_WAIT_TIMEOUT_MS });
        notes.push('loginState=completed');
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.LOGIN_REQUIRED, 'ensure-login', 'Manual login was not completed within the wait window.');
      }
    },

    async selectProject(projectName) {
      if (!projectName) {
        throw new StepError(ERROR_CODES.PROJECT_SELECTION_FAILED, 'select-project', 'Project name missing.');
      }
      try {
        await clickFromCandidates(state.page, candidateSequence(profile.ui?.project?.entry || {}), 'project-entry');
        const search = await findFromCandidates(state.page, candidateSequence(profile.ui?.project?.search || {}), 'project-search');
        await search.click();
        await search.fill(projectName);
        const option = state.page.getByText(projectName, { exact: true }).first();
        await option.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
        await option.click();
        notes.push(`selectProject=${projectName}`);
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.PROJECT_SELECTION_FAILED, 'select-project', error.message);
      }
    },

    async startNewChat() {
      try {
        await clickFromCandidates(state.page, candidateSequence(profile.ui?.newChat || {}), 'new-chat');
        notes.push('newChatStarted=true');
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.NEW_CHAT_FAILED, 'start-new-chat', error.message);
      }
    },

    async selectMode(modeResolved) {
      try {
        const candidates = modeCandidates(resolvedUi, modeResolved);
        await clickFromCandidates(state.page, candidates.entry, 'mode-entry');
        const optionClicked = await maybeClickFromCandidates(state.page, candidates.option, 'mode-option');
        if (!optionClicked && candidates.overflow.length > 0) {
          await maybeClickFromCandidates(state.page, candidates.overflow, 'mode-overflow');
          await clickFromCandidates(state.page, candidates.option, 'mode-option-after-overflow');
        }
        notes.push(`selectMode=${modeResolved}`);
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.MODE_SELECTION_FAILED, 'select-mode', error.message);
      }
    },

    async attachFiles(attachments) {
      try {
        if (!attachments?.length) return;
        const tools = toolCandidates(resolvedUi, 'upload');
        await clickFromCandidates(state.page, tools.entry, 'tools-entry');
        await maybeClickFromCandidates(state.page, tools.item, 'tools-upload');
        const fileInput = state.page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(attachments.map((item) => path.resolve(item)));
        notes.push(`attachFiles=${attachments.length}`);
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.ATTACHMENT_FAILED, 'attach-files', error.message);
      }
    },

    async inputPrompt(prompt) {
      if (!prompt?.trim()) {
        throw new StepError(ERROR_CODES.PROMPT_INPUT_FAILED, 'input-prompt', 'Prompt is empty after trimming.');
      }
      try {
        const promptBox = await findFromCandidates(state.page, candidateSequence(profile.ui?.promptBox || {}), 'prompt-box');
        await promptBox.click();
        await promptBox.fill(prompt);
        notes.push(`inputPromptChars=${prompt.length}`);
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.PROMPT_INPUT_FAILED, 'input-prompt', error.message);
      }
    },

    async submitPrompt() {
      try {
        await clickFromCandidates(state.page, candidateSequence(profile.ui?.submit || {}), 'submit-button');
        notes.push('submitPrompt=clicked');
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.SUBMIT_FAILED, 'submit-prompt', error.message);
      }
    },

    async captureScreenshot() {
      try {
        await ensureParentDir(screenshotPath);
        await state.page.screenshot({ path: screenshotPath, fullPage: true });
        notes.push(`screenshotCaptured=${screenshotPath}`);
      } catch (error) {
        throw new StepError(ERROR_CODES.SCREENSHOT_FAILED, 'capture-screenshot', error.message);
      }
    },

    async close() {
      if (state.browserContext) {
        await state.browserContext.close();
      }
    }
  };
}

async function resolveAutomationProfileDir(args, profile, notes) {
  if (args.browserProfileDir) {
    const explicit = path.resolve(args.browserProfileDir);
    await mkdir(explicit, { recursive: true });
    return explicit;
  }
  if (process.platform !== 'win32') {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'resolve-browser-profile', 'browserProfileDir is required on non-Windows hosts.');
  }
  const dir = path.join(os.homedir(), '.chatgpt-prompt-dispatcher', 'automation-profiles', profile.profileName);
  await mkdir(dir, { recursive: true });
  notes.push(`browserProfileDirCreated=${dir}`);
  return dir;
}

async function isFirstRunProfile(dir) {
  const marker = path.join(dir, '.initialized');
  try {
    await access(marker);
    return false;
  } catch {
    await writeFile(marker, new Date().toISOString(), 'utf8');
    return true;
  }
}

async function isLoggedIn(page) {
  const promptBox = page.locator('textarea, div[contenteditable="true"], [role="textbox"]').first();
  if (await promptBox.count()) {
    const visible = await promptBox.isVisible().catch(() => false);
    if (visible) return true;
  }
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const loggedOutWords = ['Log in', '로그인', 'Sign up', '회원가입'];
  return !loggedOutWords.some((word) => bodyText.includes(word)) && (bodyText.includes('ChatGPT') || bodyText.includes('무엇을 도와드릴까요?'));
}

async function findFromCandidates(page, candidates, label) {
  for (const candidate of candidates) {
    const locator = createLocator(page, candidate);
    const visible = await locator.first().isVisible().catch(() => false);
    if (visible) {
      return locator.first();
    }
  }
  throw new Error(`No visible candidate matched for ${label}`);
}

async function clickFromCandidates(page, candidates, label) {
  const locator = await findFromCandidates(page, candidates, label);
  await locator.click();
}

async function maybeClickFromCandidates(page, candidates, label) {
  for (const candidate of candidates) {
    const locator = createLocator(page, candidate).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      await locator.click();
      return true;
    }
  }
  return false;
}

function createLocator(page, candidate) {
  if (candidate.kind === 'label') {
    return page.getByLabel(candidate.value, { exact: false });
  }
  if (candidate.kind === 'text') {
    return page.getByText(candidate.value, { exact: false });
  }
  return page.locator(candidate.value);
}
