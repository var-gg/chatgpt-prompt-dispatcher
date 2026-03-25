import test from 'node:test';
import assert from 'node:assert/strict';
import { StepError } from '../src/errors.js';
import { __desktopSubmitInternals } from '../src/desktop/submit-desktop-chatgpt.js';

const { isLikelyOmniboxElement, ensurePromptTargetLooksCredible, looksLikeComposerElement, hashText } = __desktopSubmitInternals;

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
