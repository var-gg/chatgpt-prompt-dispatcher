import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StepError, ERROR_CODES } from '../errors.js';
import { repoRoot } from '../bundle-layout.js';
import { assertNormalizedPoint, getStandardWindowBounds } from './geometry.js';

const DEFAULT_DIR = path.join(repoRoot, 'profiles', 'desktop');

export function getCalibrationProfilePath(profileName = 'default', baseDir = DEFAULT_DIR) {
  if (!profileName || /[\\/]/.test(profileName)) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-calibration', 'Calibration profile name must not contain path separators.');
  }
  return path.join(path.resolve(baseDir), `${profileName}.chatgpt.json`);
}

export async function loadCalibrationProfile(profileName = 'default', options = {}) {
  const filePath = getCalibrationProfilePath(profileName, options.baseDir);
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    validateCalibrationProfile(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof StepError) {
      throw error;
    }
    throw new StepError(ERROR_CODES.PROFILE_LOAD_FAILED, 'desktop-calibration', `Failed to load calibration profile: ${filePath}`, { cause: error?.message || String(error) });
  }
}

export async function saveCalibrationProfile(profileName, profile, options = {}) {
  validateCalibrationProfile(profile);
  const filePath = getCalibrationProfilePath(profileName, options.baseDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  return filePath;
}

export function validateCalibrationProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-calibration', 'Calibration profile must be an object.');
  }
  getStandardWindowBounds(profile);
  const requiredAnchorNames = ['promptInput', 'submitButton'];
  for (const anchorName of requiredAnchorNames) {
    assertNormalizedPoint(profile?.anchors?.[anchorName], `anchors.${anchorName}`);
  }
  const optionalAnchorNames = ['newChatButton', 'modeButton', 'projectButton', 'toolsButton', 'attachButton'];
  for (const anchorName of optionalAnchorNames) {
    if (profile?.anchors?.[anchorName]) {
      assertNormalizedPoint(profile.anchors[anchorName], `anchors.${anchorName}`);
    }
  }
  return profile;
}
