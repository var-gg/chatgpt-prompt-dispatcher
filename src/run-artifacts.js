import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { defaultLogPath, writeJsonFile } from './logger.js';

function toArtifactStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createRunId() {
  return crypto.randomBytes(4).toString('hex');
}

export function createDesktopRunArtifacts({
  calibrationProfile = 'default',
  startedAt = new Date(),
  runId = createRunId()
} = {}) {
  const stamp = toArtifactStamp(startedAt);
  const artifactDir = path.resolve('artifacts', 'runs', `${stamp}-${runId}`);
  const screenshotsDir = path.join(artifactDir, 'screenshots');
  return {
    runId,
    stamp,
    startedAt: startedAt.toISOString(),
    artifactDir,
    screenshotsDir,
    receiptPath: path.join(artifactDir, 'receipt.json'),
    summaryPath: path.join(artifactDir, 'summary.json'),
    submitLogPath: path.join(artifactDir, 'submit.jsonl'),
    workerClientLogPath: path.join(artifactDir, 'worker-client.jsonl'),
    workerLogPath: path.join(artifactDir, 'worker.jsonl'),
    promptArtifactPath: path.join(artifactDir, 'failed-prompt.txt'),
    aggregateSubmitLogPath: defaultLogPath(`desktop-submit-${calibrationProfile}`),
    aggregateWorkerClientLogPath: defaultLogPath('desktop-worker-client'),
    aggregateWorkerLogPath: path.resolve('artifacts', 'logs', 'desktop-worker.jsonl')
  };
}

export async function ensureDesktopRunArtifacts(runArtifacts) {
  await mkdir(runArtifacts.artifactDir, { recursive: true });
  await mkdir(runArtifacts.screenshotsDir, { recursive: true });
}

export async function writeRunReceiptArtifacts(runArtifacts, receipt, summary) {
  await writeJsonFile(runArtifacts.receiptPath, receipt);
  await writeJsonFile(runArtifacts.summaryPath, summary);
}

export async function writeFailedPromptArtifact(runArtifacts, prompt) {
  if (!prompt) return null;
  await mkdir(runArtifacts.artifactDir, { recursive: true });
  await writeFile(runArtifacts.promptArtifactPath, String(prompt), 'utf8');
  return runArtifacts.promptArtifactPath;
}

export function buildDesktopRunSummary({
  receipt,
  runId,
  artifactDir,
  finalAction,
  attemptCount,
  submitAttempted,
  submitAttemptMethod,
  failureClass,
  failureReason,
  debugArtifacts = null,
  logPaths = {},
  targetWindowHandle = null,
  conversationUrl = null
}) {
  return {
    runId,
    artifactDir,
    submitted: receipt?.submitted === true,
    finalAction,
    attemptCount,
    submitAttempted,
    submitAttemptMethod,
    failureClass,
    failureReason,
    proofLevel: receipt?.proofLevel || null,
    surface: receipt?.surface || null,
    targetWindowHandle: targetWindowHandle || receipt?.targetWindowHandle || null,
    conversationUrl: conversationUrl || receipt?.conversationUrl || null,
    screenshotPath: receipt?.screenshotPath || null,
    debugArtifacts,
    logPaths
  };
}
