import test from 'node:test';
import assert from 'node:assert/strict';
import { StepError } from '../src/errors.js';
import { __desktopSubmitInternals } from '../src/desktop/submit-desktop-chatgpt.js';

const { isLikelyOmniboxElement, ensurePromptTargetLooksCredible, hashText } = __desktopSubmitInternals;

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

test('ensurePromptTargetLooksCredible accepts chatgpt URL with non-omnibox elements', () => {
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
      name: 'ChatGPT',
      role: 'ControlType.Document',
      automationId: 'RootWebArea'
    },
    currentUrlAfterValidation: 'https://chatgpt.com/c/abc',
    prompt: '안녕',
    actualHash: hashText('안녕')
  }));
});
