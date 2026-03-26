import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeSubmitProArgs, submitProChatgpt } from '../src/submit-pro-chatgpt.js';

process.env.SKIP_BROWSER_AUTOMATION = '1';

test('normalizeSubmitProArgs injects Pro, fresh window, and strict proof defaults', () => {
  assert.deepEqual(normalizeSubmitProArgs(['--prompt', 'hello']), [
    '--prompt', 'hello',
    '--mode', 'pro',
    '--new-chat',
    '--surface', 'new-window',
    '--proof-level', 'strict',
    '--submit-method', 'enter'
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
  assert.equal(receipt.surface, 'new-window');
  assert.equal(receipt.proofLevel, 'strict');
  assert.equal(receipt.screenshotPath, null);
  assert.equal(receipt.submitAttempted, false);
  assert.equal(receipt.submitAttemptMethod, null);
  assert.equal(receipt.finalAction, 'submit-withheld');
  assert.ok(receipt.runId);
  assert.ok(receipt.artifactDir);
  assert.ok(receipt.notes.includes('transport=desktop'));
  assert.ok(receipt.notes.includes('newChat=true'));
  assert.ok(receipt.notes.includes('surface=new-window'));
  assert.ok(receipt.notes.includes('proofLevel=strict'));
  await access(path.join(receipt.artifactDir, 'receipt.json'));
  await access(path.join(receipt.artifactDir, 'summary.json'));
  const summary = JSON.parse(await readFile(path.join(receipt.artifactDir, 'summary.json'), 'utf8'));
  assert.equal(summary.finalAction, 'submit-withheld');
  assert.equal(summary.submitAttempted, false);
});
