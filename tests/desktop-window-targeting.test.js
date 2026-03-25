import test from 'node:test';
import assert from 'node:assert/strict';
import { __windowTargetingInternals } from '../src/desktop/window-targeting.js';

const {
  isChatGptUrl,
  isChatGptTitle,
  scoreWindowTargetEvidence,
  pickBestCredibleWindowCandidate
} = __windowTargetingInternals;

test('isChatGptUrl only accepts real chatgpt hosts', () => {
  assert.equal(isChatGptUrl('https://chatgpt.com/'), true);
  assert.equal(isChatGptUrl('https://chatgpt.com/c/abc'), true);
  assert.equal(isChatGptUrl('https://foo.chatgpt.com/'), true);
  assert.equal(isChatGptUrl('안녕'), false);
  assert.equal(isChatGptUrl('https://google.com/'), false);
});

test('isChatGptTitle recognizes explicit title hints and chatgpt titles', () => {
  assert.equal(isChatGptTitle('ChatGPT - Google Chrome', 'ChatGPT'), true);
  assert.equal(isChatGptTitle('New chat - ChatGPT', ''), true);
  assert.equal(isChatGptTitle('Docs - Google Chrome', 'ChatGPT'), false);
});

test('scoreWindowTargetEvidence does not treat omnibox echo as credible url evidence', () => {
  const candidate = scoreWindowTargetEvidence({
    window: { handle: 10, title: 'auto-trader-bot - Google Chrome' },
    url: '안녕',
    composerElement: null
  }, 'ChatGPT');

  assert.equal(candidate.credible, false);
  assert.equal(candidate.urlMatched, false);
  assert.deepEqual(candidate.reasons, []);
});

test('pickBestCredibleWindowCandidate prefers composer/url evidence over title-only candidates', () => {
  const { winner, scored } = pickBestCredibleWindowCandidate([
    {
      window: { handle: 1, title: 'ChatGPT - Google Chrome' },
      url: '',
      composerElement: null
    },
    {
      window: { handle: 2, title: 'Projects - Google Chrome' },
      url: 'https://chatgpt.com/c/abc',
      composerElement: { automationId: 'prompt-textarea', className: 'ProseMirror' }
    }
  ], 'ChatGPT');

  assert.equal(scored.length, 2);
  assert.equal(winner.window.handle, 2);
  assert.deepEqual(winner.reasons, ['url', 'composer']);
});

test('pickBestCredibleWindowCandidate rejects generic chrome windows when no credible evidence exists', () => {
  const { winner, scored } = pickBestCredibleWindowCandidate([
    {
      window: { handle: 1, title: 'Docs - Google Chrome' },
      url: '',
      composerElement: null
    },
    {
      window: { handle: 2, title: 'TradingView - Google Chrome' },
      url: 'not a url',
      composerElement: null
    }
  ], 'ChatGPT');

  assert.equal(winner, null);
  assert.deepEqual(scored, []);
});
