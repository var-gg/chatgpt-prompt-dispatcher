import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist');
const bundleRoot = path.join(distRoot, 'skill-bundle');
const bundleSkillRoot = path.join(bundleRoot, 'chatgpt-web-submit');

async function main() {
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(bundleSkillRoot, { recursive: true });

  await copyDir(path.join(repoRoot, 'skill'), path.join(bundleSkillRoot, 'skill'));
  await copyDir(path.join(repoRoot, 'adapters', 'openclaw'), path.join(bundleSkillRoot, 'adapters', 'openclaw'));
  await copyDir(path.join(repoRoot, 'adapters', 'mcp'), path.join(bundleSkillRoot, 'adapters', 'mcp'));
  await copyDir(path.join(repoRoot, 'profiles'), path.join(bundleSkillRoot, 'profiles'));

  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const commitSha = await getCommitSha();
  const lock = {
    version: packageJson.version,
    commitSha,
    profile: 'default',
    installedPath: null,
    installMode: null,
    installedAt: null
  };

  await writeFile(path.join(bundleSkillRoot, 'skill.install.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  await writeFile(path.join(bundleSkillRoot, 'bundle.manifest.json'), JSON.stringify({
    name: 'chatgpt-web-submit',
    version: packageJson.version,
    commitSha,
    contents: ['skill/', 'profiles/', 'adapters/openclaw/', 'adapters/mcp/', 'skill.install.lock.json']
  }, null, 2) + '\n');

  const zipBase = path.join(distRoot, 'chatgpt-web-submit-bundle');
  await rm(`${zipBase}.zip`, { force: true });
  await execFileAsync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${bundleSkillRoot}\*' -DestinationPath '${zipBase}.zip' -Force`], { cwd: repoRoot });

  console.log(JSON.stringify({
    bundleRoot,
    bundleSkillRoot,
    archivePath: `${zipBase}.zip`,
    version: packageJson.version,
    commitSha
  }, null, 2));
}

async function copyDir(from, to) {
  await stat(from);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

async function getCommitSha() {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
  return stdout.trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
