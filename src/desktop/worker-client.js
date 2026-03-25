import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StepError } from '../errors.js';
import { writeJsonlLog } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerScriptPath = path.join(__dirname, 'desktop-worker.ps1');
const workerLogPath = path.resolve('artifacts', 'logs', 'desktop-worker.jsonl');

let singleton = null;

export async function getDesktopWorkerClient() {
  if (!singleton) {
    singleton = new DesktopWorkerClient({ scriptPath: workerScriptPath, logPath: workerLogPath });
    await singleton.start();
  }
  return singleton;
}

export async function shutdownDesktopWorkerClient() {
  if (!singleton) return;
  await singleton.stop();
  singleton = null;
}

export class DesktopWorkerClient {
  constructor({ scriptPath, logPath }) {
    this.scriptPath = scriptPath;
    this.logPath = logPath;
    this.child = null;
    this.pending = new Map();
    this.buffer = '';
    this.nextId = 1;
    this.stopped = false;
  }

  async start() {
    if (this.child) return;
    this.child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Sta',
      '-File', this.scriptPath
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');

    this.child.stdout.on('data', (chunk) => this.#handleStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      writeJsonlLog(this.logPath, { kind: 'worker-stderr', chunk }).catch(() => {});
    });
    this.child.on('error', (error) => {
      this.#failAll(new StepError('WINDOWS_AUTOMATION_FAILED', 'desktop-worker-start', error.message));
    });
    this.child.on('close', (code, signal) => {
      const reason = `Desktop worker exited${code !== null ? ` with code ${code}` : ''}${signal ? ` signal ${signal}` : ''}`;
      this.#failAll(new StepError('WINDOWS_AUTOMATION_FAILED', 'desktop-worker-exit', reason));
      this.child = null;
    });

    await writeJsonlLog(this.logPath, { kind: 'worker-start', scriptPath: this.scriptPath });
  }

  async stop() {
    if (!this.child) return;
    this.stopped = true;
    this.child.stdin.end();
    this.child.kill();
    this.child = null;
    await writeJsonlLog(this.logPath, { kind: 'worker-stop' });
  }

  async invoke(method, params = {}, { step = method } = {}) {
    await this.start();
    const id = String(this.nextId++);
    const payload = { jsonrpc: '2.0', id, method, params };
    await writeJsonlLog(this.logPath, { kind: 'request', id, method, params, step });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, step, method });
      this.child.stdin.write(JSON.stringify(payload) + '\n', 'utf8');
    });
  }

  #handleStdout(chunk) {
    this.buffer += chunk;
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      this.#handleLine(line);
    }
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.#failAll(new StepError('WINDOWS_AUTOMATION_FAILED', 'desktop-worker-parse', `Failed to parse worker JSON: ${error.message}`));
      return;
    }

    const id = message.id == null ? null : String(message.id);
    if (!id || !this.pending.has(id)) {
      writeJsonlLog(this.logPath, { kind: 'orphan-response', message }).catch(() => {});
      return;
    }

    const pending = this.pending.get(id);
    this.pending.delete(id);
    writeJsonlLog(this.logPath, { kind: 'response', id, method: pending.method, message }).catch(() => {});

    if (message.error) {
      pending.reject(new StepError(message.error.code || 'WINDOWS_AUTOMATION_FAILED', pending.step, message.error.message || 'Desktop worker call failed.', message.error.data || {}));
      return;
    }

    pending.resolve(message.result);
  }

  #failAll(error) {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.stopped) {
      writeJsonlLog(this.logPath, { kind: 'worker-fail-all', code: error.code, step: error.step, message: error.message }).catch(() => {});
    }
  }
}
