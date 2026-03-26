import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

test('bundle install script runs from packaged bundle', async () => {
  const pack = spawnSync(process.execPath, ['src/pack-skill.js'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);

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
  assert.equal(parsed.skillId, 'chatgpt-web-submit');
  assert.equal(parsed.wrapperEntry, path.join(target, 'scripts', 'submit-pro.js'));
  await access(path.join(target, 'agents', 'openai.yaml'));
  await access(path.join(target, 'scripts', 'submit-pro.js'));
});

test('repo install-local rebuilds stale bundle metadata before install', async () => {
  const pack = spawnSync(process.execPath, ['src/pack-skill.js'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);

  const lockPath = path.resolve('dist', 'skill-bundle', 'chatgpt-web-submit', 'skill.install.lock.json');
  const repoLockPath = path.resolve('skill.install.lock.json');
  const originalBundleLock = await readFile(lockPath, 'utf8');
  const originalRepoLock = await readFile(repoLockPath, 'utf8');

  try {
    const staleLock = { ...JSON.parse(originalBundleLock), commitSha: 'stale-sha' };
    await writeFile(lockPath, JSON.stringify(staleLock, null, 2) + '\n');

    const target = await mkdtemp(path.join(os.tmpdir(), 'chatgpt-repo-install-'));
    const result = spawnSync(process.execPath, ['src/install-local.js', '--target', target, '--mode', 'copy'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    const expectedCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    assert.equal(expectedCommit.status, 0, expectedCommit.stderr || expectedCommit.stdout);
    assert.equal(parsed.commitSha, expectedCommit.stdout.trim());
    assert.notEqual(parsed.commitSha, 'stale-sha');
  } finally {
    await writeFile(lockPath, originalBundleLock);
    await writeFile(repoLockPath, originalRepoLock);
  }
});
