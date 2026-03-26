import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceipt, createFailureReceipt } from '../src/receipt.js';

test('createReceipt returns submission metadata only', () => {
  const receipt = createReceipt({
    submitted: true,
    modeResolved: 'auto',
    projectResolved: null,
    url: 'https://chatgpt.com/',
    surface: 'new-window',
    proofLevel: 'strict',
    targetWindowHandle: '12345',
    conversationUrl: 'https://chatgpt.com/c/abc',
    screenshotPath: 'shot.png',
    notes: ['ok']
  });

  assert.equal(receipt.submitted, true);
  assert.equal(receipt.modeResolved, 'auto');
  assert.ok(receipt.timestamp);
  assert.equal(receipt.url, 'https://chatgpt.com/');
  assert.equal(receipt.surface, 'new-window');
  assert.equal(receipt.proofLevel, 'strict');
  assert.equal(receipt.targetWindowHandle, '12345');
  assert.equal(receipt.conversationUrl, 'https://chatgpt.com/c/abc');
  assert.equal(receipt.screenshotPath, 'shot.png');
});

test('createFailureReceipt includes error metadata', () => {
  const receipt = createFailureReceipt({
    error: { code: 'INVALID_ARGS', step: 'parse-args', message: 'bad' },
    screenshotPath: 'last.png',
    url: 'https://chatgpt.com/',
    surface: 'same-window',
    proofLevel: 'fast',
    targetWindowHandle: '999',
    conversationUrl: null
  });

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.error.code, 'INVALID_ARGS');
  assert.equal(receipt.error.step, 'parse-args');
  assert.equal(receipt.surface, 'same-window');
  assert.equal(receipt.proofLevel, 'fast');
  assert.equal(receipt.targetWindowHandle, '999');
});
