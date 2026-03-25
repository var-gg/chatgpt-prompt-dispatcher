import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

test('bundle install script runs from packaged bundle', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'chatgpt-bundle-install-'));
  const bundleScript = path.resolve('dist', 'skill-bundle', 'chatgpt-web-submit', 'scripts', 'install-local.js');
  const result = spawnSync(process.execPath, [bundleScript, '--target', target, '--mode', 'copy'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.installed, true);
  assert.equal(parsed.target, target);
});
