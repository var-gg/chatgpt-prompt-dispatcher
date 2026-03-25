import { access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { StepError, ERROR_CODES } from './errors.js';
import { candidateSequence, modeCandidates, resolveUiProfile, toolCandidates } from './ui-profile.js';

const CHATGPT_URL = 'https://chatgpt.com/';
const DEFAULT_TIMEOUT_MS = 15000;
const LOGIN_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

export async function createPlaywrightAutomationSession({ profile, args, screenshotPath, notes, flowPlan, ensureParentDir, trace }) {
  const resolvedUi = resolveUiProfile(profile, args);
  const state = {
    browserContext: null,
    page: null,
    userDataDir: await resolveAutomationProfileDir(args, profile, notes),
    firstRun: false,
    launchedChannel: null,
    lastSuccessfulStep: 'init'
  };

  await ensureParentDir(screenshotPath);
  state.firstRun = await isFirstRunProfile(state.userDataDir);

  const markStep = async (step, data = {}) => {
    state.lastSuccessfulStep = step;
    notes.push(`step=${step}`);
    if (trace) await trace({ kind: 'step', step, ...data });
  };

  const recordSelectorHit = async (step, candidate, extra = {}) => {
    const rendered = renderCandidate(candidate);
    notes.push(`selectorHit=${step}:${rendered}`);
    if (trace) {
      await trace({ kind: 'selector-hit', step, candidateKind: candidate.kind, candidate: candidate.value, rendered, ...extra });
    }
  };

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
          await markStep('launch-browser', { channel, userDataDir: state.userDataDir });
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
        await markStep('navigate-chatgpt', { url: state.page.url() });
      } catch (error) {
        throw new StepError(ERROR_CODES.NAVIGATION_FAILED, 'navigate-chatgpt', error.message);
      }
    },

    async ensureLoggedInOrWait() {
      if (await isLoggedIn(state.page)) {
        notes.push('loginState=ready');
        await markStep('ensure-login', { loginState: 'ready' });
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
        await markStep('ensure-login', { loginState: 'completed' });
      } catch {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.LOGIN_REQUIRED, 'ensure-login', 'Manual login was not completed within the wait window.', { lastSuccessfulStep: state.lastSuccessfulStep });
      }
    },

    async selectProject(projectName) {
      if (!projectName) {
        throw new StepError(ERROR_CODES.PROJECT_SELECTION_FAILED, 'select-project', 'Project name missing.');
      }
      try {
        const entry = await clickFromCandidates(state.page, candidateSequence(profile.ui?.project?.entry || {}), 'project-entry', recordSelectorHit);
        const search = await findFromCandidates(state.page, candidateSequence(profile.ui?.project?.search || {}), 'project-search', recordSelectorHit);
        await search.click();
        await fillLocator(search, projectName);
        const listCandidate = await findProjectListCandidate(state.page, profile.ui?.project?.list || {}, projectName, recordSelectorHit);
        await listCandidate.click();
        notes.push(`selectProject=${projectName}`);
        await markStep('select-project', { projectName, entry: renderCandidate(entry) });
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.PROJECT_SELECTION_FAILED, 'select-project', error.message, { lastSuccessfulStep: state.lastSuccessfulStep });
      }
    },

    async startNewChat() {
      try {
        const candidate = await clickFromCandidates(state.page, candidateSequence(profile.ui?.newChat || {}), 'new-chat', recordSelectorHit);
        notes.push('newChatStarted=true');
        await markStep('start-new-chat', { candidate: renderCandidate(candidate) });
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.NEW_CHAT_FAILED, 'start-new-chat', error.message, { lastSuccessfulStep: state.lastSuccessfulStep });
      }
    },

    async selectMode(modeResolved) {
      try {
        const candidates = modeCandidates(resolvedUi, modeResolved);
        if (!candidates.option.length) {
          throw new Error(`Mode "${modeResolved}" is not configured for profile ${profile.profileName}`);
        }
        const entry = await clickFromCandidates(state.page, candidates.entry, 'mode-entry', recordSelectorHit);
        let optionClicked = await maybeClickFromCandidates(state.page, candidates.option, 'mode-option', recordSelectorHit);
        if (!optionClicked && candidates.overflow.length > 0) {
          await maybeClickFromCandidates(state.page, candidates.overflow, 'mode-overflow', recordSelectorHit);
          optionClicked = await maybeClickFromCandidates(state.page, candidates.option, 'mode-option-after-overflow', recordSelectorHit);
        }
        if (!optionClicked) {
          throw new Error(`Could not select mode "${modeResolved}" using profile candidates.`);
        }
        notes.push(`selectMode=${modeResolved}`);
        await markStep('select-mode', { modeResolved, entry: renderCandidate(entry) });
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.MODE_SELECTION_FAILED, 'select-mode', error.message, { lastSuccessfulStep: state.lastSuccessfulStep });
      }
    },

    async attachFiles(attachments) {
      try {
        if (!attachments?.length) return;
        const tools = toolCandidates(resolvedUi, 'upload');
        await clickFromCandidates(state.page, tools.entry, 'tools-entry', recordSelectorHit);
        await maybeClickFromCandidates(state.page, tools.item, 'tools-upload', recordSelectorHit);
        const fileInput = state.page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT_MS });
        await fileInput.setInputFiles(attachments.map((item) => path.resolve(item)));
        notes.push(`attachFiles=${attachments.length}`);
        await markStep('attach-files', { attachmentCount: attachments.length });
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.ATTACHMENT_FAILED, 'attach-files', error.message, { lastSuccessfulStep: state.lastSuccessfulStep });
      }
    },

    async inputPrompt(prompt) {
      if (!prompt?.trim()) {
        throw new StepError(ERROR_CODES.PROMPT_INPUT_FAILED, 'input-prompt', 'Prompt is empty after trimming.');
      }
      try {
        const promptBox = await findFromCandidates(state.page, candidateSequence(profile.ui?.promptBox || {}), 'prompt-box', recordSelectorHit);
        await promptBox.click();
        await fillLocator(promptBox, prompt);
        notes.push(`inputPromptChars=${prompt.length}`);
        await markStep('input-prompt', { promptLength: prompt.length });
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.PROMPT_INPUT_FAILED, 'input-prompt', error.message, { lastSuccessfulStep: state.lastSuccessfulStep });
      }
    },

    async submitPrompt() {
      try {
        const candidates = candidateSequence(profile.ui?.submit || {});
        const buttonCandidates = candidates.filter((candidate) => candidate.kind !== 'selector' || String(candidate.value).includes('button'));
        const clicked = await maybeClickFromCandidates(state.page, buttonCandidates, 'submit-button', recordSelectorHit);
        if (!clicked) {
          throw new Error('Submit button was not found using safe button-first candidates.');
        }
        notes.push('submitPrompt=clicked');
        await markStep('submit-prompt');
      } catch (error) {
        await this.captureScreenshot();
        throw new StepError(ERROR_CODES.SUBMIT_FAILED, 'submit-prompt', error.message, { lastSuccessfulStep: state.lastSuccessfulStep });
      }
    },

    async captureScreenshot() {
      try {
        await ensureParentDir(screenshotPath);
        await state.page.screenshot({ path: screenshotPath, fullPage: true });
        notes.push(`screenshotCaptured=${screenshotPath}`);
        if (trace) await trace({ kind: 'artifact', step: 'capture-screenshot', screenshotPath, lastSuccessfulStep: state.lastSuccessfulStep });
      } catch (error) {
        throw new StepError(ERROR_CODES.SCREENSHOT_FAILED, 'capture-screenshot', error.message, { lastSuccessfulStep: state.lastSuccessfulStep });
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

async function findProjectListCandidate(page, target, projectName, recordSelectorHit) {
  const candidates = candidateSequence(target);
  for (const candidate of candidates) {
    let locator = createLocator(page, candidate);
    if (candidate.kind === 'role') {
      locator = page.getByRole(candidate.value.role, { name: projectName, exact: false });
    } else if (candidate.kind === 'selector') {
      locator = page.locator(candidate.value).filter({ hasText: projectName });
    } else {
      locator = page.getByText(projectName, { exact: false });
    }
    const first = locator.first();
    const visible = await first.isVisible().catch(() => false);
    if (visible) {
      await recordSelectorHit('project-list', candidate, { projectName });
      return first;
    }
  }
  const fallback = page.getByText(projectName, { exact: false }).first();
  await fallback.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  return fallback;
}

async function findFromCandidates(page, candidates, label, recordSelectorHit) {
  for (const candidate of candidates) {
    const locator = createLocator(page, candidate).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      if (recordSelectorHit) await recordSelectorHit(label, candidate);
      return locator;
    }
  }
  throw new Error(`No visible candidate matched for ${label}`);
}

async function clickFromCandidates(page, candidates, label, recordSelectorHit) {
  for (const candidate of candidates) {
    const locator = createLocator(page, candidate).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      if (recordSelectorHit) await recordSelectorHit(label, candidate);
      await locator.click();
      return candidate;
    }
  }
  throw new Error(`No visible candidate matched for ${label}`);
}

async function maybeClickFromCandidates(page, candidates, label, recordSelectorHit) {
  for (const candidate of candidates) {
    const locator = createLocator(page, candidate).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      if (recordSelectorHit) await recordSelectorHit(label, candidate);
      await locator.click();
      return candidate;
    }
  }
  return null;
}

function createLocator(page, candidate) {
  if (candidate.kind === 'role') {
    const role = candidate.value?.role;
    const name = candidate.value?.name;
    return page.getByRole(role, name ? { name, exact: false } : {});
  }
  if (candidate.kind === 'label') {
    return page.getByLabel(candidate.value, { exact: false });
  }
  if (candidate.kind === 'text') {
    return page.getByText(candidate.value, { exact: false });
  }
  if (candidate.kind === 'placeholder') {
    return page.getByPlaceholder(candidate.value, { exact: false });
  }
  return page.locator(candidate.value);
}

async function fillLocator(locator, text) {
  const tagName = await locator.evaluate((node) => node.tagName?.toLowerCase()).catch(() => '');
  if (tagName === 'textarea' || tagName === 'input') {
    await locator.fill(text);
    return;
  }
  const contentEditable = await locator.evaluate((node) => node.getAttribute('contenteditable')).catch(() => null);
  if (contentEditable === 'true' || contentEditable === '') {
    await locator.fill(text).catch(async () => {
      await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
      await locator.press('Backspace').catch(() => {});
      await locator.type(text, { delay: 5 });
    });
    return;
  }
  await locator.fill(text);
}

function renderCandidate(candidate) {
  if (candidate.kind === 'role') {
    return `role:${candidate.value.role}:${candidate.value.name || '*'}`;
  }
  return `${candidate.kind}:${String(candidate.value)}`;
}
