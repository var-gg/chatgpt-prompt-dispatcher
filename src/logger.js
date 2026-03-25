import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function writeJsonlLog(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  await appendFile(filePath, line, 'utf8');
}

export function defaultLogPath(profileName = 'default') {
  return path.resolve('artifacts', 'logs', `${profileName}.jsonl`);
}
