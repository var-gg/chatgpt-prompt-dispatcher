import { StepError } from '../errors.js';
import { delay, focusWindow, getUrlViaOmnibox, listChromeWindows, uiaQuery } from './windows-input.js';

const CHATGPT_HOST = 'chatgpt.com';
const WINDOW_FOCUS_SETTLE_MS = 220;
const WINDOW_EVIDENCE_RETRY_MS = 260;

export function isChatGptUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === CHATGPT_HOST || parsed.hostname.endsWith(`.${CHATGPT_HOST}`);
  } catch {
    return false;
  }
}

export function isChatGptTitle(title, titleHint = '') {
  const normalizedTitle = String(title || '').toLowerCase();
  const normalizedHint = String(titleHint || '').trim().toLowerCase();
  return Boolean(
    (normalizedHint && normalizedTitle.includes(normalizedHint))
    || normalizedTitle.includes('chatgpt')
  );
}

export function scoreWindowTargetEvidence(candidate, titleHint = '') {
  const windowTitle = String(candidate?.window?.title || '');
  const titleMatched = isChatGptTitle(windowTitle, titleHint);
  const urlMatched = isChatGptUrl(candidate?.url);
  const composerMatched = Boolean(candidate?.composerElement);
  const exactChatGptShell = isExactChatGptShellTitle(windowTitle);

  const reasons = [];
  if (titleMatched) reasons.push('title');
  if (urlMatched) reasons.push('url');
  if (composerMatched) reasons.push('composer');
  if (exactChatGptShell) reasons.push('exact-chatgpt-shell');

  let score = 0;
  if (composerMatched) score += 100;
  if (urlMatched) score += 80;
  if (titleMatched) score += 30;
  if (exactChatGptShell) score += 120;

  return {
    ...candidate,
    titleMatched,
    urlMatched,
    composerMatched,
    exactChatGptShell,
    credible: score > 0,
    score,
    reasons
  };
}

export function pickBestCredibleWindowCandidate(candidates, titleHint = '') {
  const scored = candidates
    .map((candidate) => scoreWindowTargetEvidence(candidate, titleHint))
    .filter((candidate) => candidate.credible)
    .sort((left, right) => right.score - left.score || left.window.handle - right.window.handle);

  return {
    winner: scored[0] || null,
    scored
  };
}

async function readWindowUrl(handle) {
  try {
    const result = await getUrlViaOmnibox({ handle });
    const url = String(result?.url || '').trim();
    return isChatGptUrl(url) ? url : '';
  } catch {
    return '';
  }
}

async function readComposerElement(handle) {
  const queries = [
    { automationId: 'prompt-textarea', timeoutMs: 900 },
    { automationId: 'prompt-textarea', className: 'ProseMirror', timeoutMs: 500 },
    { automationId: 'prompt-textarea', className: 'ProseMirror ProseMirror-focused', timeoutMs: 500 }
  ];

  for (const query of queries) {
    try {
      const result = await uiaQuery({ handle }, query);
      if (result?.element) {
        return result.element;
      }
    } catch {
      // try the next prompt-textarea variant
    }
  }

  return null;
}

export async function inspectWindowTargetEvidence(window, options = {}) {
  if (options.focusFirst) {
    await focusWindow(window.handle).catch(() => null);
    await delay(options.focusSettleMs ?? WINDOW_FOCUS_SETTLE_MS);
  }

  const firstPass = await Promise.all([
    readWindowUrl(window.handle),
    readComposerElement(window.handle)
  ]);
  let [url, composerElement] = firstPass;

  if (!url && !composerElement && options.focusFirst) {
    await delay(options.retryDelayMs ?? WINDOW_EVIDENCE_RETRY_MS);
    [url, composerElement] = await Promise.all([
      readWindowUrl(window.handle),
      readComposerElement(window.handle)
    ]);
  }

  return {
    window,
    url,
    composerElement
  };
}

export async function chooseVerifiedChatGptWindow(titleHint = '') {
  const windows = await listChromeWindows();
  if (!windows.length) {
    throw new StepError('WINDOW_NOT_FOUND', 'select-window', 'No visible Chrome/Edge top-level window found.');
  }

  const candidates = [];
  for (const window of windows) {
    candidates.push(await inspectWindowTargetEvidence(window));
  }

  const { winner, scored } = pickBestCredibleWindowCandidate(candidates, titleHint);
  if (winner) {
    return {
      selectedWindow: winner.window,
      evidence: winner,
      candidates: scored
    };
  }

  const focusedCandidates = [];
  for (const window of windows) {
    focusedCandidates.push(await inspectWindowTargetEvidence(window, { focusFirst: true }));
  }

  const focusedPass = pickBestCredibleWindowCandidate(focusedCandidates, titleHint);
  if (focusedPass.winner) {
    return {
      selectedWindow: focusedPass.winner.window,
      evidence: focusedPass.winner,
      candidates: focusedPass.scored
    };
  }

  const fallbackWindow = pickFallbackBrowserWindow(windows, titleHint);
  if (!fallbackWindow) {
    throw new StepError('CHATGPT_TARGET_NOT_FOUND', 'select-window', 'No credible ChatGPT browser window was found. Open an existing ChatGPT tab/window first, then retry.', {
      titleHint,
      windows: windows.map((window) => ({ handle: window.handle, title: window.title })),
      candidates: focusedCandidates.map((candidate) => ({
        handle: candidate.window?.handle,
        title: candidate.window?.title,
        url: candidate.url,
        composerMatched: Boolean(candidate.composerElement)
      }))
    });
  }

  return {
    selectedWindow: fallbackWindow,
    evidence: {
      window: fallbackWindow,
      url: '',
      composerElement: null,
      titleMatched: isChatGptTitle(fallbackWindow.title, titleHint),
      urlMatched: false,
      composerMatched: false,
      credible: false,
      score: 0,
      reasons: ['browser-window-fallback']
    },
    candidates: scored
  };
}

function pickFallbackBrowserWindow(windows, titleHint = '') {
  const normalizedHint = String(titleHint || '').trim().toLowerCase();
  const scored = windows
    .map((window, index) => {
      const title = String(window?.title || '').toLowerCase();
      const safe = isSafeFallbackBrowserWindow(window, titleHint);
      let score = 0;
      if (normalizedHint && title.includes(normalizedHint)) score += 50;
      if (title.includes('chatgpt')) score += 100;
      if (isExactChatGptShellTitle(window?.title)) score += 140;
      if (isBlankBrowserShellTitle(window?.title)) score += 40;
      return { window, score, index, safe };
    })
    .filter((entry) => entry.safe)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0]?.window || null;
}

function isExactChatGptShellTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  return normalized === 'chatgpt - chrome'
    || normalized === 'chatgpt - google chrome'
    || normalized === 'chatgpt - microsoft edge';
}

function isBlankBrowserShellTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  return normalized.includes('new tab')
    || normalized.includes('새 탭')
    || normalized.includes('about:blank');
}

function isSafeFallbackBrowserWindow(window, titleHint = '') {
  const title = String(window?.title || '');
  const safeTitleHint = String(titleHint || '').toLowerCase().includes('chatgpt')
    ? titleHint
    : '';
  return isExactChatGptShellTitle(title)
    || isBlankBrowserShellTitle(title)
    || isChatGptTitle(title, safeTitleHint);
}

export const __windowTargetingInternals = {
  isChatGptUrl,
  isChatGptTitle,
  isExactChatGptShellTitle,
  isBlankBrowserShellTitle,
  isSafeFallbackBrowserWindow,
  scoreWindowTargetEvidence,
  pickBestCredibleWindowCandidate,
  pickFallbackBrowserWindow
};
