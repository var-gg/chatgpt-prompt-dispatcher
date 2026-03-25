import test from 'node:test';
import assert from 'node:assert/strict';
import { getDesktopWorkerClient, shutdownDesktopWorkerClient } from '../src/desktop/worker-client.js';

const enabled = process.platform === 'win32' && process.env.WINDOWS_DESKTOP_WORKER_SMOKE === '1';

test('desktop worker smoke test is gated behind WINDOWS_DESKTOP_WORKER_SMOKE=1 on Windows', async () => {
  if (!enabled) {
    assert.ok(true);
    return;
  }

  const client = await getDesktopWorkerClient();
  const fg = await client.invoke('getForegroundWindow', {}, { step: 'worker-smoke-get-foreground' });
  assert.ok(fg);
  assert.ok(typeof fg.hwnd === 'string');

  const clipboardBefore = await client.invoke('getClipboard', {}, { step: 'worker-smoke-get-clipboard-before' });
  await client.invoke('setClipboard', { text: 'desktop-worker-smoke' }, { step: 'worker-smoke-set-clipboard' });
  const clipboardAfter = await client.invoke('getClipboard', {}, { step: 'worker-smoke-get-clipboard-after' });
  assert.equal(clipboardAfter.text, 'desktop-worker-smoke');

  await client.invoke('setClipboard', { text: clipboardBefore.text || '' }, { step: 'worker-smoke-restore-clipboard' });
  await shutdownDesktopWorkerClient();
});
