import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bundleRoot, bundleSkillRoot, distRoot, repoRoot, resolveBundleRuntimeEntry } from './bundle-layout.js';

const execFileAsync = promisify(execFile);

async function main() {
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(bundleSkillRoot, { recursive: true });

  await copyFile(path.join(repoRoot, 'skill', 'SKILL.md'), path.join(bundleSkillRoot, 'SKILL.md'));
  await copyDir(path.join(repoRoot, 'skill', 'agents'), path.join(bundleSkillRoot, 'agents'));
  await copyDir(path.join(repoRoot, 'skill', 'references'), path.join(bundleSkillRoot, 'references'));
  await copyDir(path.join(repoRoot, 'skill', 'scripts'), path.join(bundleSkillRoot, 'scripts'));
  await copyDir(path.join(repoRoot, 'profiles'), path.join(bundleSkillRoot, 'profiles'));
  await copyDir(path.join(repoRoot, 'adapters'), path.join(bundleSkillRoot, 'adapters'));
  await copyRuntime(path.join(bundleSkillRoot, 'runtime'));

  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const commitSha = await getCommitSha();
  const lock = {
    version: packageJson.version,
    commitSha,
    profile: 'default',
    installedPath: null,
    installMode: null,
    installedAt: null,
    runtimeEntry: 'runtime/src/index.js'
  };

  await writeFile(path.join(bundleSkillRoot, 'skill.install.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  await writeFile(path.join(bundleSkillRoot, 'bundle.manifest.json'), JSON.stringify({
    name: 'chatgpt-web-submit',
    version: packageJson.version,
    commitSha,
    runtime: {
      entry: 'runtime/src/index.js',
      packageJson: 'runtime/package.json'
    },
    openclaw: {
      discoverableBy: 'SKILL.md-at-bundle-root',
      registerCommand: 'npm run register-openclaw'
    },
    contents: ['SKILL.md', 'agents/', 'references/', 'scripts/', 'profiles/', 'adapters/', 'runtime/', 'skill.install.lock.json']
  }, null, 2) + '\n');

  const zipBase = path.join(distRoot, 'chatgpt-web-submit-bundle');
  await rm(`${zipBase}.zip`, { force: true });
  await execFileAsync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${bundleSkillRoot}\*' -DestinationPath '${zipBase}.zip' -Force`], { cwd: repoRoot });

  console.log(JSON.stringify({
    bundleRoot,
    bundleSkillRoot,
    archivePath: `${zipBase}.zip`,
    runtimeEntry: resolveBundleRuntimeEntry(bundleSkillRoot),
    version: packageJson.version,
    commitSha
  }, null, 2));
}

async function copyRuntime(targetRuntimeDir) {
  await mkdir(targetRuntimeDir, { recursive: true });
  await copyDir(path.join(repoRoot, 'src'), path.join(targetRuntimeDir, 'src'));
  await copyFile(path.join(repoRoot, 'package.json'), path.join(targetRuntimeDir, 'package.json'));
  await copyFile(path.join(repoRoot, 'package-lock.json'), path.join(targetRuntimeDir, 'package-lock.json'));
}

async function copyDir(from, to) {
  await stat(from);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

async function copyFile(from, to) {
  await stat(from);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: false });
}

async function getCommitSha() {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
  return stdout.trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
