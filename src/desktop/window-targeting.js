import { StepError } from '../errors.js';
import { getUrlViaOmnibox, listChromeWindows, uiaQuery } from './windows-input.js';

const CHATGPT_HOST = 'chatgpt.com';

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
  const titleMatched = isChatGptTitle(candidate?.window?.title, titleHint);
  const urlMatched = isChatGptUrl(candidate?.url);
  const composerMatched = Boolean(candidate?.composerElement);

  const reasons = [];
  if (titleMatched) reasons.push('title');
  if (urlMatched) reasons.push('url');
  if (composerMatched) reasons.push('composer');

  let score = 0;
  if (composerMatched) score += 100;
  if (urlMatched) score += 80;
  if (titleMatched) score += 30;

  return {
    ...candidate,
    titleMatched,
    urlMatched,
    composerMatched,
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
  try {
    const result = await uiaQuery({ handle }, {
      automationId: 'prompt-textarea',
      className: 'ProseMirror',
      timeoutMs: 700
    });
    return result?.element || null;
  } catch {
    return null;
  }
}

export async function inspectWindowTargetEvidence(window) {
  const [url, composerElement] = await Promise.all([
    readWindowUrl(window.handle),
    readComposerElement(window.handle)
  ]);

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
  if (!winner) {
    throw new StepError('CHATGPT_TARGET_NOT_FOUND', 'select-window', 'No credible ChatGPT browser window was found. Open an existing ChatGPT tab/window first, then retry.', {
      titleHint,
      windows: windows.map((window) => ({ handle: window.handle, title: window.title })),
      candidates: candidates.map((candidate) => ({
        handle: candidate.window.handle,
        title: candidate.window.title,
        url: candidate.url,
        composerMatched: Boolean(candidate.composerElement)
      }))
    });
  }

  return {
    selectedWindow: winner.window,
    evidence: winner,
    candidates: scored
  };
}

export const __windowTargetingInternals = {
  isChatGptUrl,
  isChatGptTitle,
  scoreWindowTargetEvidence,
  pickBestCredibleWindowCandidate
};
