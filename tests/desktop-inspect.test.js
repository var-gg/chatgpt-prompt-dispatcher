import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('inspect-desktop-chatgpt prints JSON', () => {
  const result = spawnSync(process.execPath, ['src/desktop/inspect-desktop-chatgpt.js'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Object.hasOwn(parsed, 'ok'));
  assert.ok(Object.hasOwn(parsed, 'foreground'));
  if (parsed.ok) {
    assert.ok(Object.hasOwn(parsed, 'uiaSnapshot'));
    assert.ok(Object.hasOwn(parsed, 'targetEvidence'));
  } else {
    assert.equal(parsed.error?.code, 'CHATGPT_TARGET_NOT_FOUND');
  }
});
