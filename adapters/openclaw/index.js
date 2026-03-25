import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.resolve(__dirname, '..', '..');
const runtimeEntry = path.join(bundleRoot, 'runtime', 'src', 'index.js');
const runtimeCwd = path.join(bundleRoot, 'runtime');

export async function invokeOpenClawSubmit(options = {}) {
  const args = [runtimeEntry, 'submit-chatgpt'];

  pushOption(args, '--prompt', options.prompt);
  pushOption(args, '--prompt-file', options.promptFile);
  pushOption(args, '--mode', options.mode);
  pushOption(args, '--project', options.project);
  pushBoolean(args, '--new-chat', options.newChat === true);
  pushBoolean(args, '--no-new-chat', options.newChat === false);
  pushRepeatable(args, '--attachment', options.attachments || []);
  pushOption(args, '--profile', options.profile);
  pushBoolean(args, '--dry-run', options.dryRun === true);
  pushOption(args, '--screenshot-path', options.screenshotPath);
  pushOption(args, '--browser-profile-dir', options.browserProfileDir);

  return runNode(args);
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: runtimeCwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `OpenClaw adapter failed with code ${code}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

function pushOption(args, flag, value) {
  if (value !== undefined && value !== null && value !== '') {
    args.push(flag, String(value));
  }
}

function pushBoolean(args, flag, enabled) {
  if (enabled) args.push(flag);
}

function pushRepeatable(args, flag, values) {
  for (const value of values) {
    args.push(flag, String(value));
  }
}
