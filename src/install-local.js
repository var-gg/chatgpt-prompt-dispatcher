import { access, cp, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { bundleSkillRoot, defaultInstallTarget, expandHome, repoRoot, resolveBundleRuntimeEntry } from './bundle-layout.js';

const execFileAsync = promisify(execFile);

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const target = path.resolve(expandHome(options.target || defaultInstallTarget));
  await ensureBundleBuilt();
  await materializeBundle(target, options.mode);
  await installRuntimeDeps(target);

  const commitSha = await getCommitSha();
  const runtimeEntry = resolveBundleRuntimeEntry(target);
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const lock = {
    version: packageJson.version,
    commitSha,
    profile: options.profile,
    installedPath: target,
    installMode: options.mode,
    installedAt: new Date().toISOString(),
    runtimeEntry
  };

  await writeFile(path.join(repoRoot, 'skill.install.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  await writeFile(path.join(target, 'skill.install.lock.json'), JSON.stringify(lock, null, 2) + '\n');

  const statInfo = await lstat(target);
  console.log(JSON.stringify({
    installed: true,
    target,
    mode: options.mode,
    profile: options.profile,
    isSymlink: statInfo.isSymbolicLink(),
    commitSha,
    runtimeEntry
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

async function getCommitSha() {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
  return stdout.trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
