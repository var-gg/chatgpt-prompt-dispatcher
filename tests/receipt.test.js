import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceipt, createFailureReceipt } from '../src/receipt.js';

test('createReceipt returns submission metadata only', () => {
  const receipt = createReceipt({
    submitted: true,
    modeResolved: 'auto',
    projectResolved: null,
    url: 'https://chatgpt.com/',
    screenshotPath: 'shot.png',
    notes: ['ok']
  });

  assert.equal(receipt.submitted, true);
  assert.equal(receipt.modeResolved, 'auto');
  assert.ok(receipt.timestamp);
  assert.equal(receipt.url, 'https://chatgpt.com/');
  assert.equal(receipt.screenshotPath, 'shot.png');
});

test('createFailureReceipt includes error metadata', () => {
  const receipt = createFailureReceipt({
    error: { code: 'INVALID_ARGS', step: 'parse-args', message: 'bad' },
    screenshotPath: 'last.png',
    url: 'https://chatgpt.com/'
  });

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.error.code, 'INVALID_ARGS');
  assert.equal(receipt.error.step, 'parse-args');
});
