import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.resolve(__dirname, '..');
const runtimeEntry = path.join(bundleRoot, 'runtime', 'src', 'index.js');

async function main(argv = process.argv.slice(2)) {
  const normalized = await normalizePromptArgs(argv);
  const child = spawn(process.execPath, [runtimeEntry, 'submit-pro-chatgpt', ...normalized.argv], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  child.on('error', async (error) => {
    await cleanupTempPath(normalized.tempPath);
    console.error(error?.message || error);
    process.exitCode = 1;
  });

  child.on('close', async (code) => {
    await cleanupTempPath(normalized.tempPath);
    process.exitCode = code ?? 1;
  });
}

async function normalizePromptArgs(argv) {
  const output = [];
  let prompt = null;
  let promptFile = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--prompt') {
      if (prompt !== null || promptFile !== null) {
        throw new Error('Use either --prompt or --prompt-file, not both.');
      }
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --prompt.');
      }
      prompt = value;
      i += 1;
      continue;
    }
    if (token.startsWith('--prompt=')) {
      if (prompt !== null || promptFile !== null) {
        throw new Error('Use either --prompt or --prompt-file, not both.');
      }
      prompt = token.slice('--prompt='.length);
      continue;
    }
    if (token === '--prompt-file') {
      if (prompt !== null || promptFile !== null) {
        throw new Error('Use either --prompt or --prompt-file, not both.');
      }
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --prompt-file.');
      }
      promptFile = value;
      output.push(token, promptFile);
      i += 1;
      continue;
    }
    if (token.startsWith('--prompt-file=')) {
      if (prompt !== null || promptFile !== null) {
        throw new Error('Use either --prompt or --prompt-file, not both.');
      }
      promptFile = token.slice('--prompt-file='.length);
      output.push(token);
      continue;
    }
    output.push(token);
  }

  if (prompt === null) {
    return { argv: output, tempPath: null };
  }

  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'chatgpt-pro-handoff-'));
  const tempPath = path.join(baseDir, 'prompt.txt');
  await writeFile(tempPath, prompt, 'utf8');
  output.push('--prompt-file', tempPath);
  return { argv: output, tempPath: baseDir };
}

async function cleanupTempPath(tempPath) {
  if (!tempPath) return;
  await rm(tempPath, { recursive: true, force: true }).catch(() => {});
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
