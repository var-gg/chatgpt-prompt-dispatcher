import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('smoke command is gated behind LIVE_CHATGPT=1', () => {
  const result = spawnSync(process.execPath, ['src/index.js', 'smoke'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, LIVE_CHATGPT: '' }
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /LIVE_CHATGPT=1/);
});
