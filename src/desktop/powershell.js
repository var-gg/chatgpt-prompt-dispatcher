import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StepError } from '../errors.js';
import { defaultLogPath, writeJsonlLog } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(__dirname, 'desktop-worker.ps1');
let singleton = null;

export function getDesktopWorkerClient(options = {}) {
  if (!singleton) {
    singleton = new DesktopWorkerClient(options);
  }
  return singleton;
}

export async function shutdownDesktopWorker() {
  if (singleton) {
    await singleton.shutdown();
    singleton = null;
  }
}

class DesktopWorkerClient {
  constructor({ logPath } = {}) {
    this.logPath = logPath || defaultLogPath('desktop-worker-client');
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.startPromise = null;
  }

  async ensureStarted() {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start();
    await this.startPromise;
    this.startPromise = null;
  }

  async call(method, params = {}, { step = method, timeoutMs = 5000 } = {}) {
    await this.ensureStarted();
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    await writeJsonlLog(this.logPath, { kind: 'desktop-worker-call', id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        this.pending.delete(id);
        await writeJsonlLog(this.logPath, { kind: 'desktop-worker-timeout', id, method, timeoutMs });
        reject(new StepError('WORKER_TIMEOUT', step, `Desktop worker timed out waiting for ${method}.`, { method, timeoutMs }));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: async (result) => {
          clearTimeout(timer);
          await writeJsonlLog(this.logPath, { kind: 'desktop-worker-result', id, method, result });
          resolve(result);
        },
        reject: async (error) => {
          clearTimeout(timer);
          await writeJsonlLog(this.logPath, { kind: 'desktop-worker-error', id, method, error });
          reject(new StepError(error?.code || 'WINDOWS_AUTOMATION_FAILED', step, error?.message || `Desktop worker call failed: ${method}`, error?.data || { method }));
        }
      });

      this.child.stdin.write(JSON.stringify(payload) + '\n', 'utf8');
    });
  }

  async shutdown() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    child.stdin.end();
    child.kill();
    await writeJsonlLog(this.logPath, { kind: 'desktop-worker-stop' });
  }

  async #start() {
    this.child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', workerScript,
      '-LogPath', path.resolve('artifacts', 'logs', 'desktop-worker.jsonl')
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');

    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      void this.#drainBuffer();
    });

    this.child.stderr.on('data', (chunk) => {
      void writeJsonlLog(this.logPath, { kind: 'desktop-worker-stderr', chunk });
    });

    this.child.on('error', async (error) => {
      await writeJsonlLog(this.logPath, { kind: 'desktop-worker-process-error', message: error.message });
      this.#rejectAll({ code: 'WORKER_SPAWN_FAILED', message: error.message });
      this.child = null;
    });

    this.child.on('close', async (code, signal) => {
      await writeJsonlLog(this.logPath, { kind: 'desktop-worker-close', code, signal });
      this.#rejectAll({ code: 'WORKER_EXITED', message: `Desktop worker exited (${code ?? 'null'}/${signal ?? 'null'}).` });
      this.child = null;
    });

    await writeJsonlLog(this.logPath, { kind: 'desktop-worker-start', workerScript });
  }

  async #drainBuffer() {
    while (true) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) break;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        await writeJsonlLog(this.logPath, { kind: 'desktop-worker-parse-error', line, message: error.message });
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) {
        await pending.reject(message.error);
      } else {
        await pending.resolve(message.result);
      }
    }
  }

  #rejectAll(error) {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      void pending.reject(error);
    }
  }
}
