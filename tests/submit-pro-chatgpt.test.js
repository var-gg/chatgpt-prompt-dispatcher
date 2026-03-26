import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubmitProArgs, submitProChatgpt } from '../src/submit-pro-chatgpt.js';

process.env.SKIP_BROWSER_AUTOMATION = '1';

test('normalizeSubmitProArgs injects pro mode and new chat defaults', () => {
  assert.deepEqual(normalizeSubmitProArgs(['--prompt', 'hello']), [
    '--prompt', 'hello',
    '--mode', 'pro',
    '--new-chat'
  ]);
});

test('normalizeSubmitProArgs rejects conflicting no-new-chat flag', () => {
  assert.throws(() => normalizeSubmitProArgs([
    '--prompt', 'hello',
    '--no-new-chat'
  ]), /always starts a new chat/i);
});

test('submitProChatgpt returns a Pro dry-run receipt through desktop transport', async () => {
  const receipt = await submitProChatgpt([
    '--prompt',
    'hello world',
    '--dry-run'
  ]);

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.modeResolved, 'pro');
  assert.ok(receipt.notes.includes('transport=desktop'));
  assert.ok(receipt.notes.includes('newChat=true'));
});
