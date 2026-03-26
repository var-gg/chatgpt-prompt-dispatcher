import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseDesktopSubmitArgs, parseSubmitArgs } from '../src/args.js';

test('parseSubmitArgs accepts prompt and attachments', async () => {
  const result = await parseSubmitArgs([
    '--prompt', 'hello',
    '--attachment', 'a.txt',
    '--attachment', 'b.txt',
    '--mode', 'thinking'
  ]);

  assert.equal(result.prompt, 'hello');
  assert.equal(result.mode, 'thinking');
  assert.deepEqual(result.attachments, ['a.txt', 'b.txt']);
  assert.equal(result.newChat, true);
});

test('parseSubmitArgs loads prompt file', async () => {
  const tmp = path.join(os.tmpdir(), 'chatgpt-prompt-dispatcher-prompt.txt');
  await writeFile(tmp, 'file prompt', 'utf8');
  const result = await parseSubmitArgs(['--prompt-file', tmp]);
  assert.equal(result.prompt, 'file prompt');
  assert.equal(result.promptFile, path.resolve(tmp));
});

test('parseDesktopSubmitArgs accepts desktop-specific flags', async () => {
  const result = await parseDesktopSubmitArgs([
    '--prompt', 'desktop hello',
    '--mode', 'pro',
    '--new-chat',
    '--surface', 'new-window',
    '--proof-level', 'strict',
    '--calibration-profile', 'default',
    '--window-title', 'ChatGPT',
    '--step-delay-ms', '250',
    '--submit-method', 'enter',
    '--no-submit'
  ]);

  assert.equal(result.prompt, 'desktop hello');
  assert.equal(result.mode, 'pro');
  assert.equal(result.newChat, true);
  assert.equal(result.surface, 'new-window');
  assert.equal(result.proofLevel, 'strict');
  assert.equal(result.calibrationProfile, 'default');
  assert.equal(result.windowTitle, 'ChatGPT');
  assert.equal(result.stepDelayMs, 250);
  assert.equal(result.submitMethod, 'enter');
  assert.equal(result.submit, false);
});
