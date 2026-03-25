import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(__dirname, '..');
const bundleCandidate = path.resolve(runtimeRoot, '..');
const repoCandidate = runtimeRoot;
const runningFromBundle = existsSync(path.join(bundleCandidate, 'SKILL.md')) && existsSync(path.join(bundleCandidate, 'runtime'));

export const repoRoot = runningFromBundle ? bundleCandidate : repoCandidate;
export const distRoot = path.join(repoRoot, 'dist');
export const bundleRoot = runningFromBundle ? repoRoot : path.join(distRoot, 'skill-bundle');
export const bundleSkillRoot = runningFromBundle ? repoRoot : path.join(bundleRoot, 'chatgpt-web-submit');
export const defaultInstallTarget = path.join(os.homedir(), '.openclaw', 'skills', 'chatgpt-web-submit');
export const isBundleRuntime = runningFromBundle;

export function expandHome(value) {
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function resolveBundleRuntimeEntry(rootDir) {
  return path.join(rootDir, 'runtime', 'src', 'index.js');
}
