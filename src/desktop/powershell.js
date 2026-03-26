import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StepError } from '../errors.js';
import { defaultLogPath, writeJsonlLog } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(__dirname, 'desktop-worker.ps1');
const DEFAULT_WORKER_LOG_PATH = path.resolve('artifacts', 'logs', 'desktop-worker.jsonl');

let singleton = null;
let defaultOptions = {
  logPath: defaultLogPath('desktop-worker-client'),
  workerLogPath: DEFAULT_WORKER_LOG_PATH,
  automationContext: null
};

export function getDesktopWorkerClient(options = {}) {
  const resolved = mergeWorkerOptions(defaultOptions, options);
  if (!singleton) {
    singleton = new DesktopWorkerClient(resolved);
  } else {
    singleton.setRuntimeOptions(resolved);
  }
  return singleton;
}

export async function configureDesktopWorker(options = {}) {
  const resolved = mergeWorkerOptions(defaultOptions, options);
  defaultOptions = resolved;
  if (!singleton) {
    return;
  }
  const needsRestart = singleton.requiresRestart(resolved);
  singleton.setRuntimeOptions(resolved);
  if (needsRestart) {
    await singleton.shutdown();
  }
}

export async function shutdownDesktopWorker() {
  if (singleton) {
    await singleton.shutdown();
    singleton = null;
  }
}

class DesktopWorkerClient {
  constructor({ logPath, workerLogPath, automationContext } = {}) {
    this.logPath = logPath || defaultLogPath('desktop-worker-client');
    this.workerLogPath = workerLogPath || DEFAULT_WORKER_LOG_PATH;
    this.automationContext = normalizeAutomationContext(automationContext);
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.startPromise = null;
  }

  setRuntimeOptions({ logPath, workerLogPath, automationContext } = {}) {
    if (logPath) {
      this.logPath = path.resolve(logPath);
    }
    if (workerLogPath) {
      this.workerLogPath = path.resolve(workerLogPath);
    }
    if (automationContext !== undefined) {
      this.automationContext = normalizeAutomationContext(automationContext);
    }
  }

  requiresRestart({ workerLogPath } = {}) {
    if (!this.child || !workerLogPath) {
      return false;
    }
    return path.resolve(workerLogPath) !== path.resolve(this.workerLogPath);
  }

  async ensureStarted() {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start();
    await this.startPromise;
    this.startPromise = null;
  }

  async call(method, params = {}, { step = method, timeoutMs = 5000, automationContext = null } = {}) {
    await this.ensureStarted();
    const id = this.nextId++;
    const context = normalizeAutomationContext({
      ...(this.automationContext || {}),
      ...(automationContext || {}),
      step
    });
    const payloadParams = context
      ? { ...params, automationContext: context }
      : { ...params };
    const payload = { jsonrpc: '2.0', id, method, params: payloadParams };
    const startedAt = Date.now();

    await writeJsonlLog(this.logPath, {
      kind: 'desktop-worker-call',
      id,
      method,
      step,
      automationContext: context,
      params: sanitizeWorkerValue(payloadParams),
      resultClass: classifyWorkerResult(method, null)
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        this.pending.delete(id);
        await writeJsonlLog(this.logPath, {
          kind: 'desktop-worker-timeout',
          id,
          method,
          step,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          automationContext: context,
          resultClass: 'timeout'
        });
        reject(new StepError('WORKER_TIMEOUT', step, `Desktop worker timed out waiting for ${method}.`, { method, timeoutMs }));
      }, timeoutMs);

      this.pending.set(id, {
        step,
        method,
        context,
        startedAt,
        resolve: async (result) => {
          clearTimeout(timer);
          await writeJsonlLog(this.logPath, {
            kind: 'desktop-worker-result',
            id,
            method,
            step,
            durationMs: Date.now() - startedAt,
            automationContext: context,
            resultClass: classifyWorkerResult(method, result),
            result: sanitizeWorkerValue(result)
          });
          resolve(result);
        },
        reject: async (error) => {
          clearTimeout(timer);
          await writeJsonlLog(this.logPath, {
            kind: 'desktop-worker-error',
            id,
            method,
            step,
            durationMs: Date.now() - startedAt,
            automationContext: context,
            resultClass: 'error',
            error: sanitizeWorkerError(error)
          });
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
    await writeJsonlLog(this.logPath, {
      kind: 'desktop-worker-stop',
      automationContext: this.automationContext,
      resultClass: 'lifecycle'
    });
  }

  async #start() {
    this.child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', workerScript,
      '-LogPath', this.workerLogPath
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
      void writeJsonlLog(this.logPath, {
        kind: 'desktop-worker-stderr',
        automationContext: this.automationContext,
        resultClass: 'stderr',
        chunkHash: hashText(chunk),
        chunkLength: String(chunk || '').length
      });
    });

    this.child.on('error', async (error) => {
      await writeJsonlLog(this.logPath, {
        kind: 'desktop-worker-process-error',
        automationContext: this.automationContext,
        resultClass: 'lifecycle-error',
        message: error.message
      });
      this.#rejectAll({ code: 'WORKER_SPAWN_FAILED', message: error.message });
      this.child = null;
    });

    this.child.on('close', async (code, signal) => {
      await writeJsonlLog(this.logPath, {
        kind: 'desktop-worker-close',
        automationContext: this.automationContext,
        resultClass: 'lifecycle',
        code,
        signal
      });
      this.#rejectAll({ code: 'WORKER_EXITED', message: `Desktop worker exited (${code ?? 'null'}/${signal ?? 'null'}).` });
      this.child = null;
    });

    await writeJsonlLog(this.logPath, {
      kind: 'desktop-worker-start',
      workerScript,
      workerLogPath: this.workerLogPath,
      automationContext: this.automationContext,
      resultClass: 'lifecycle'
    });
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
        await writeJsonlLog(this.logPath, {
          kind: 'desktop-worker-parse-error',
          automationContext: this.automationContext,
          resultClass: 'parse-error',
          lineHash: hashText(line),
          lineLength: line.length,
          message: error.message
        });
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

function mergeWorkerOptions(base, extra) {
  return {
    logPath: path.resolve(extra?.logPath || base?.logPath || defaultLogPath('desktop-worker-client')),
    workerLogPath: path.resolve(extra?.workerLogPath || base?.workerLogPath || DEFAULT_WORKER_LOG_PATH),
    automationContext: normalizeAutomationContext({
      ...(base?.automationContext || {}),
      ...(extra?.automationContext || {})
    })
  };
}

function normalizeAutomationContext(context = null) {
  if (!context) return null;
  const normalized = Object.fromEntries(
    Object.entries(context)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value])
  );
  return Object.keys(normalized).length ? normalized : null;
}

function sanitizeWorkerValue(value, keyName = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeWorkerValue(entry));
  }
  if (!value || typeof value !== 'object') {
    if (isSensitiveTextKey(keyName)) {
      return describeSensitiveText(value);
    }
    return value;
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'automationContext') {
      continue;
    }
    if (isSensitiveTextKey(key)) {
      output[key] = describeSensitiveText(entry);
      continue;
    }
    output[key] = sanitizeWorkerValue(entry, key);
  }
  return output;
}

function isSensitiveTextKey(keyName = '') {
  const key = String(keyName || '').toLowerCase();
  return key === 'text'
    || key === 'value'
    || key === 'chunk'
    || key === 'ocrtext'
    || key === 'composertext'
    || key === 'composerocrtextsample';
}

function describeSensitiveText(value) {
  const text = String(value || '');
  return {
    textHash: hashText(text),
    textLength: text.length
  };
}

function sanitizeWorkerError(error) {
  return {
    code: error?.code || 'WINDOWS_AUTOMATION_FAILED',
    message: error?.message || 'Desktop worker call failed.',
    data: sanitizeWorkerValue(error?.data || {})
  };
}

function classifyWorkerResult(method, result) {
  if (!result) {
    return method === 'setClipboard' || method === 'sendKeys' || method === 'click'
      ? 'input'
      : 'call';
  }
  if (result?.windows) return 'window-list';
  if (result?.window) return 'window';
  if (result?.element) return 'uia-element';
  if (result?.rect && result?.imagePath) return 'image-crop';
  if (result?.screenshotPath) return 'screenshot';
  if (result?.text !== undefined) return 'text';
  if (result?.point) return 'cursor';
  if (result?.ok !== undefined) return result.ok ? 'ack' : 'nack';
  return 'result';
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export const __desktopWorkerInternals = {
  describeSensitiveText,
  sanitizeWorkerError,
  sanitizeWorkerValue,
  normalizeAutomationContext
};
