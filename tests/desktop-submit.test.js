import test from 'node:test';
import assert from 'node:assert/strict';
import { StepError } from '../src/errors.js';
import { __desktopSubmitInternals } from '../src/desktop/submit-desktop-chatgpt.js';

const {
  isLikelyOmniboxElement,
  ensurePromptTargetLooksCredible,
  looksLikeComposerElement,
  looksLikePromptEcho,
  deriveSubmitProof,
  hasVisibleSendStateTransition,
  buildSubmitAttemptOrder,
  looksLikeStopButton,
  hashText,
  normalizeAddressValue,
  isRectClose
} = __desktopSubmitInternals;

test('isLikelyOmniboxElement rejects Chrome address bar candidates', () => {
  assert.equal(isLikelyOmniboxElement({
    name: '주소창 및 검색창',
    role: 'ControlType.Edit',
    automationId: 'view_1012',
    className: 'OmniboxViewViews'
  }), true);

  assert.equal(isLikelyOmniboxElement({
    name: 'Message ChatGPT',
    role: 'ControlType.Document',
    automationId: 'prompt-textarea',
    className: 'ProseMirror'
  }), false);
});

test('ensurePromptTargetLooksCredible fails when validation drifted into omnibox', () => {
  assert.throws(() => ensurePromptTargetLooksCredible({
    promptFocus: {
      element: {
        name: '주소창 및 검색창',
        role: 'ControlType.Edit',
        automationId: 'view_1012',
        className: 'OmniboxViewViews'
      }
    },
    focusedElement: {
      name: 'auto-trader-bot - Chrome',
      role: 'ControlType.Document',
      automationId: 'RootWebArea'
    },
    currentUrlAfterValidation: '안녕',
    prompt: '안녕',
    actualHash: hashText('안녕')
  }), (error) => {
    assert.equal(error instanceof StepError, true);
    assert.equal(error.code, 'PROMPT_TARGET_INVALID');
    return true;
  });
});

test('looksLikeComposerElement detects the ChatGPT composer', () => {
  assert.equal(looksLikeComposerElement({
    name: 'Message ChatGPT',
    role: 'ControlType.Document',
    automationId: 'prompt-textarea',
    className: 'ProseMirror'
  }), true);

  assert.equal(looksLikeComposerElement({
    name: 'ChatGPT',
    role: 'ControlType.Document',
    automationId: 'RootWebArea'
  }), false);
});

test('ensurePromptTargetLooksCredible accepts chatgpt URL with composer focus', () => {
  assert.doesNotThrow(() => ensurePromptTargetLooksCredible({
    promptFocus: {
      element: {
        name: 'Message ChatGPT',
        role: 'ControlType.Document',
        automationId: 'prompt-textarea',
        className: 'ProseMirror'
      }
    },
    focusedElement: {
      name: 'Message ChatGPT',
      role: 'ControlType.Document',
      automationId: 'prompt-textarea',
      className: 'ProseMirror-focused'
    },
    currentUrlAfterValidation: 'https://chatgpt.com/c/abc',
    prompt: '안녕',
    actualHash: hashText('안녕')
  }));
});

test('ensurePromptTargetLooksCredible tolerates stale omnibox prompt echo when composer focus is valid', () => {
  assert.doesNotThrow(() => ensurePromptTargetLooksCredible({
    promptFocus: {
      element: {
        name: '무엇이든 물어보세요 프롬프트',
        role: 'ControlType.Edit',
        automationId: 'prompt-textarea',
        className: 'ProseMirror'
      }
    },
    focusedElement: {
      name: '무엇이든 물어보세요 프롬프트',
      role: 'ControlType.Edit',
      automationId: 'prompt-textarea',
      className: 'ProseMirror ProseMirror-focused'
    },
    currentUrlAfterValidation: 'desktop live proof 2026-03-25 19:25',
    prompt: 'desktop live proof 2026-03-25 19:25',
    actualHash: hashText('desktop live proof 2026-03-25 19:25')
  }));
});

test('looksLikePromptEcho detects non-url omnibox echoes of the prompt', () => {
  assert.equal(looksLikePromptEcho('desktop live proof 2026-03-25 19:25', 'desktop live proof 2026-03-25 19:25'), true);
  assert.equal(looksLikePromptEcho('https://chatgpt.com/', 'desktop live proof 2026-03-25 19:25'), false);
});

test('hasVisibleSendStateTransition requires a real idle-to-send UI change', () => {
  assert.equal(hasVisibleSendStateTransition(
    { sendable: false, stopVisible: false, submitSignature: '' },
    { sendable: true, stopVisible: false, submitSignature: '{"name":"Send"}' }
  ), true);

  assert.equal(hasVisibleSendStateTransition(
    { sendable: true, stopVisible: false, submitSignature: '{"name":"Send"}' },
    { sendable: true, stopVisible: false, submitSignature: '{"name":"Send"}' }
  ), false);
});

test('buildSubmitAttemptOrder prefers practical enter fallback when send button is not proven', () => {
  assert.deepEqual(buildSubmitAttemptOrder('click', null), ['enter', 'click']);
  assert.deepEqual(buildSubmitAttemptOrder('click', { name: 'Send', isEnabled: true }), ['click', 'enter']);
  assert.deepEqual(buildSubmitAttemptOrder('enter', { name: 'Send', isEnabled: true }), ['enter', 'click']);
});

test('deriveSubmitProof prefers strong post-submit UI signals', () => {
  assert.equal(deriveSubmitProof(
    { composerText: 'hello', submitButton: { name: 'Send' }, stopButton: null },
    { composerText: 'hello', submitButton: { name: 'Stop' }, stopButton: { name: 'Stop' } },
    'hello'
  ), 'stopButtonAppeared');

  assert.equal(deriveSubmitProof(
    { composerText: 'hello', submitButton: { name: 'Send' }, stopButton: null },
    { composerText: '', submitButton: { name: 'Send' }, stopButton: null },
    'hello'
  ), 'composerClearedOrPromptGoneAfterSubmit');

  assert.equal(deriveSubmitProof(
    { composerText: 'hello', submitButton: { name: 'Send', isEnabled: true }, stopButton: null },
    { composerText: 'hello', submitButton: { name: 'Send', isEnabled: false }, stopButton: null },
    'hello'
  ), 'submitButtonStateChanged');
});

test('looksLikeStopButton distinguishes streaming stop state from send state', () => {
  assert.equal(looksLikeStopButton({
    name: '응답 중지',
    automationId: 'composer-submit-button',
    className: 'composer-submit-btn'
  }), true);

  assert.equal(looksLikeStopButton({
    name: '프롬프트 보내기',
    automationId: 'composer-submit-button',
    className: 'composer-submit-btn'
  }), false);
});

test('normalizeAddressValue canonicalizes chatgpt URLs for omnibox verification', () => {
  assert.equal(normalizeAddressValue('https://chatgpt.com'), normalizeAddressValue('https://chatgpt.com'));
  assert.equal(normalizeAddressValue('HTTPS://CHATGPT.COM///'), normalizeAddressValue('https://chatgpt.com/'));
  assert.equal(normalizeAddressValue(' https://chatgpt.com/c/abc/ '), normalizeAddressValue('https://chatgpt.com/c/abc/'));
});

test('isRectClose tolerates small window settling drift only', () => {
  assert.equal(isRectClose(
    { x: 101, y: 99, width: 1202, height: 797 },
    { x: 100, y: 100, width: 1200, height: 800 },
    3
  ), true);

  assert.equal(isRectClose(
    { x: 110, y: 100, width: 1200, height: 800 },
    { x: 100, y: 100, width: 1200, height: 800 },
    3
  ), false);
});
