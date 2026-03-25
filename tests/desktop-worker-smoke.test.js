import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('desktop worker smoke command prints JSON', () => {
  const result = spawnSync(process.execPath, ['src/desktop/worker-smoke.js'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  if (process.platform !== 'win32') {
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    return;
  }

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.ok(Object.hasOwn(parsed, 'foreground'));
});
