import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { cropImage } from '../src/desktop/windows-input.js';
import { shutdownDesktopWorker } from '../src/desktop/powershell.js';

function escapeForPowerShellSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function readPngDimensions(buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

test('desktop worker cropImage returns deterministic dimensions for the requested rect', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'chatgpt-dispatcher-crop-'));
  const imagePath = path.join(tempDir, 'source.png');
  const cropPath = path.join(tempDir, 'crop.png');

  try {
    const script = [
      'Add-Type -AssemblyName System.Drawing',
      `$bmp = New-Object System.Drawing.Bitmap 40, 30`,
      '$gfx = [System.Drawing.Graphics]::FromImage($bmp)',
      '$gfx.Clear([System.Drawing.Color]::White)',
      '$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Red)',
      '$gfx.FillRectangle($brush, 10, 5, 20, 10)',
      `$bmp.Save('${escapeForPowerShellSingleQuote(imagePath)}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$brush.Dispose()',
      '$gfx.Dispose()',
      '$bmp.Dispose()'
    ].join('; ');
    const generated = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const result = await cropImage(imagePath, { x: 10, y: 5, width: 20, height: 10 }, cropPath);
    const buffer = await readFile(cropPath);
    const dimensions = readPngDimensions(buffer);

    assert.deepEqual(result.rect, { x: 10, y: 5, width: 20, height: 10 });
    assert.deepEqual(dimensions, { width: 20, height: 10 });
  } finally {
    await shutdownDesktopWorker().catch(() => {});
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('desktop worker cropImage rejects invalid crop rects', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'chatgpt-dispatcher-crop-'));
  const imagePath = path.join(tempDir, 'source.png');
  const cropPath = path.join(tempDir, 'invalid-crop.png');

  try {
    const script = [
      'Add-Type -AssemblyName System.Drawing',
      `$bmp = New-Object System.Drawing.Bitmap 16, 16`,
      '$gfx = [System.Drawing.Graphics]::FromImage($bmp)',
      '$gfx.Clear([System.Drawing.Color]::White)',
      `$bmp.Save('${escapeForPowerShellSingleQuote(imagePath)}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$gfx.Dispose()',
      '$bmp.Dispose()'
    ].join('; ');
    const generated = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    await assert.rejects(
      () => cropImage(imagePath, { x: 99, y: 99, width: 5, height: 5 }, cropPath),
      /IMAGE_CROP_INVALID|Crop rect is invalid/i
    );
  } finally {
    await shutdownDesktopWorker().catch(() => {});
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
