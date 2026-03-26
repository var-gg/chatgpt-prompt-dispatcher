import test from 'node:test';
import assert from 'node:assert/strict';
import { submitChatgpt } from '../src/submit-chatgpt.js';
import { submitBrowserChatgpt } from '../src/submit-browser-chatgpt.js';

process.env.SKIP_BROWSER_AUTOMATION = '1';

test('submitChatgpt defaults to desktop transport and returns a dry-run receipt', async () => {
  const receipt = await submitChatgpt([
    '--prompt',
    'hello world',
    '--dry-run'
  ]);

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.modeResolved, 'auto');
  assert.equal(receipt.projectResolved, null);
  assert.ok(Array.isArray(receipt.notes));
  assert.ok(receipt.notes.includes('transport=desktop'));
});

test('submitChatgpt routes to browser transport when explicitly requested', async () => {
  const receipt = await submitChatgpt([
    '--transport=browser',
    '--prompt',
    'hello world',
    '--dry-run',
    '--profile',
    'default'
  ]);

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.modeResolved, 'auto');
  assert.ok(receipt.notes.includes('transport=browser'));
});

test('submitBrowserChatgpt rejects unsupported modes through failure receipt', async () => {
  const receipt = await submitBrowserChatgpt([
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
