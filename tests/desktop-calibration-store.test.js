import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { getCalibrationProfilePath, loadCalibrationProfile, saveCalibrationProfile } from '../src/desktop/calibration-store.js';

const sampleProfile = {
  version: 1,
  window: { targetBounds: { x: 100, y: 80, width: 1440, height: 900 } },
  anchors: {
    promptInput: { x: 0.5, y: 0.92 },
    submitButton: { x: 0.965, y: 0.92 }
  }
};

test('getCalibrationProfilePath resolves a profile file path', () => {
  const filePath = getCalibrationProfilePath('default', 'C:/tmp/desktop-profiles');
  assert.equal(filePath, path.resolve('C:/tmp/desktop-profiles', 'default.chatgpt.json'));
});

test('saveCalibrationProfile and loadCalibrationProfile round-trip JSON', async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'chatgpt-desktop-profiles-'));
  const savedPath = await saveCalibrationProfile('sample', sampleProfile, { baseDir });
  const loaded = await loadCalibrationProfile('sample', { baseDir });

  assert.equal(savedPath, path.join(baseDir, 'sample.chatgpt.json'));
  assert.deepEqual(loaded.anchors, sampleProfile.anchors);
  assert.deepEqual(loaded.window.targetBounds, sampleProfile.window.targetBounds);
});
