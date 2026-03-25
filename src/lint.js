import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const requiredFiles = [
  'README.md',
  'package.json',
  'skill/SKILL.md',
  'docs/adr/0001-scope-and-boundary.md',
  'docs/adr/0002-repo-install-runtime-separation.md',
  'docs/adr/0003-core-cli-submission-receipt.md',
  'profiles/ko-KR.windows.pro.json',
  'profiles/ko-KR.windows.plus.json'
];

async function main() {
  for (const rel of requiredFiles) {
    await access(path.join(repoRoot, rel));
  }

  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
  if (!readme.startsWith('# Unofficial local input automation for ChatGPT web')) {
    throw new Error('README heading must declare unofficial local ChatGPT web automation scope.');
  }

  if (!readme.includes('does **not**:\n- read assistant responses')) {
    throw new Error('README must clearly declare response collection as out of scope.');
  }

  console.log('lint OK');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
