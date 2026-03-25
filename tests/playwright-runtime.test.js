import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { submitBrowserChatgpt } from '../src/submit-browser-chatgpt.js';

process.env.SKIP_BROWSER_AUTOMATION = '1';

test('submitBrowserChatgpt can fail gracefully when non-windows live run omits browserProfileDir', async () => {
  if (process.platform === 'win32') {
    assert.ok(true);
    return;
  }
  const receipt = await submitBrowserChatgpt(['--prompt', 'hello']);
  assert.equal(receipt.submitted, false);
});

test('explicit screenshot path is preserved in dry-run browser invocation metadata', async () => {
  const shot = path.join(os.tmpdir(), 'chatgpt-dispatcher-shot.png');
  const receipt = await submitBrowserChatgpt([
    '--prompt', 'hello world',
    '--dry-run',
    '--profile', 'default',
    '--browser-profile-dir', path.join(os.tmpdir(), 'chatgpt-dispatcher-profile'),
    '--screenshot-path', shot
  ]);
  assert.equal(receipt.screenshotPath, path.resolve(shot));
});
