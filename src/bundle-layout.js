import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..');
export const distRoot = path.join(repoRoot, 'dist');
export const bundleRoot = path.join(distRoot, 'skill-bundle');
export const bundleSkillRoot = path.join(bundleRoot, 'chatgpt-web-submit');
export const defaultInstallTarget = path.join(os.homedir(), '.openclaw', 'skills', 'chatgpt-web-submit');

export function expandHome(value) {
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function resolveBundleRuntimeEntry(rootDir) {
  return path.join(rootDir, 'runtime', 'src', 'index.js');
}
