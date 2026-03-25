import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultTarget = path.join(os.homedir(), '.openclaw', 'skills', 'chatgpt-web-submit');

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const target = path.resolve(expandHome(options.target || defaultTarget));
  const source = path.join(repoRoot, 'skill');
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });

  if (options.mode === 'symlink') {
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(source, target, type);
  } else {
    await cp(source, target, { recursive: true });
  }

  const commitSha = await getCommitSha();
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const lock = {
    version: packageJson.version,
    commitSha,
    profile: options.profile,
    installedPath: target,
    installMode: options.mode,
    installedAt: new Date().toISOString()
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
    commitSha
  }, null, 2));
}

function parseArgs(argv) {
  const options = { mode: 'symlink', target: defaultTarget, profile: 'default' };
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

function expandHome(value) {
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function getCommitSha() {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
  return stdout.trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
