import test from 'node:test';
import assert from 'node:assert/strict';
import { submitChatgpt } from '../src/submit-chatgpt.js';

test('submitChatgpt returns a dry-run receipt', async () => {
  const receipt = await submitChatgpt([
    '--prompt',
    'hello world',
    '--dry-run',
    '--profile',
    'default'
  ]);

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.modeResolved, 'auto');
  assert.equal(receipt.projectResolved, null);
  assert.ok(Array.isArray(receipt.notes));
});

test('submitChatgpt rejects unsupported modes through failure receipt', async () => {
  const receipt = await submitChatgpt([
    '--prompt',
    'hello world',
    '--mode',
    'turbo',
    '--dry-run'
  ]);

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.error.code, 'INVALID_ARGS');
  assert.equal(receipt.error.step, 'resolve-mode');
});
