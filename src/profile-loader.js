import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadProfile(name) {
  const candidates = [
    path.resolve(__dirname, '..', 'profiles', `${name}.json`),
    path.resolve(__dirname, '..', '..', 'profiles', `${name}.json`)
  ];

  for (const filePath of candidates) {
    try {
      await access(filePath);
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // try next
    }
  }

  throw new Error(`ENOENT: no such file or directory, open '${candidates[candidates.length - 1]}'`);
}
