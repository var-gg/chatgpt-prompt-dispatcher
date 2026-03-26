import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeJsonlLog(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  await appendFile(filePath, line, 'utf8');
}

export async function writeJsonlLogs(filePaths, event) {
  const targets = [...new Set((filePaths || []).filter(Boolean).map((filePath) => path.resolve(filePath)))];
  for (const filePath of targets) {
    await writeJsonlLog(filePath, event);
  }
}

export async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function defaultLogPath(profileName = 'default') {
  return path.resolve('artifacts', 'logs', `${profileName}.jsonl`);
}
