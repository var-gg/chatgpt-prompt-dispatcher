import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseSubmitArgs } from '../src/args.js';

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
