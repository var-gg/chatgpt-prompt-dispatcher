import { access, cp, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  bundleSkillRoot,
  defaultInstallTarget,
  expandHome,
  repoRoot,
  resolveBundleRuntimeEntry,
  isBundleRuntime
} from './bundle-layout.js';

const execFileAsync = promisify(execFile);

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const target = path.resolve(expandHome(options.target || defaultInstallTarget));
  await ensureBundleBuilt();
  await materializeBundle(target, options.mode);
  await installRuntimeDeps(target);

  const packageJson = JSON.parse(await readFile(path.join(bundleSkillRoot, 'runtime', 'package.json'), 'utf8'));
  const existingLock = await readInstallLockSafe();
  const runtimeEntry = resolveBundleRuntimeEntry(target);
  const lock = {
    version: packageJson.version,
    commitSha: existingLock?.commitSha || 'unknown',
    profile: options.profile,
    installedPath: target,
    installMode: options.mode,
    installedAt: new Date().toISOString(),
    runtimeEntry
  };

  if (!isBundleRuntime) {
    await writeFile(path.join(repoRoot, 'skill.install.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  }
  await writeFile(path.join(target, 'skill.install.lock.json'), JSON.stringify(lock, null, 2) + '\n');

  const statInfo = await lstat(target);
  const wrapperEntry = path.join(target, 'scripts', 'submit-pro.js');
  console.log(JSON.stringify({
    installed: true,
    target,
    skillId: 'chatgpt-web-submit',
    mode: options.mode,
    profile: options.profile,
    isSymlink: statInfo.isSymbolicLink(),
    commitSha: lock.commitSha,
    runtimeEntry,
    wrapperEntry,
    sourceBundle: bundleSkillRoot
  }, null, 2));
}

async function materializeBundle(target, mode) {
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });

  if (mode === 'symlink') {
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(bundleSkillRoot, target, type);
    return;
  }
  await cp(bundleSkillRoot, target, { recursive: true });
}

async function ensureBundleBuilt() {
  try {
    await access(bundleSkillRoot);
  } catch {
    if (isBundleRuntime) {
      throw new Error(`Bundle root not found: ${bundleSkillRoot}`);
    }
    await execFileAsync(process.execPath, ['src/pack-skill.js'], { cwd: repoRoot });
  }
}

async function installRuntimeDeps(target) {
  const runtimeDir = path.join(target, 'runtime');
  if (process.platform === 'win32') {
    await execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm install --omit=dev'], { cwd: runtimeDir });
    return;
  }
  await execFileAsync('npm', ['install', '--omit=dev'], { cwd: runtimeDir });
}

async function readInstallLockSafe() {
  try {
    const raw = await readFile(path.join(bundleSkillRoot, 'skill.install.lock.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = { mode: 'copy', target: defaultInstallTarget, profile: 'default' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--target') options.target = argv[++i];
    else if (token === '--mode') options.mode = argv[++i];
    else if (token === '--profile') options.profile = argv[++i];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!['symlink', 'copy'].includes(options.mode)) {
    throw new Error(`Unsupported install mode: ${options.mode}`);
  }
  return options;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
