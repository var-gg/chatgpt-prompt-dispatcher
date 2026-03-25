import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export async function loadProfile(name) {
  const filePath = path.join(repoRoot, 'profiles', `${name}.json`);
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
