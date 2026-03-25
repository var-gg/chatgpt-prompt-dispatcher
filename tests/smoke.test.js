import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config-schema.js';

test('validateConfig accepts a minimal valid config', () => {
  const result = validateConfig({
    profileName: 'default',
    browser: { channel: 'chrome-user-session' },
    chatgpt: { mode: 'new-chat' },
  });

  assert.equal(result.profileName, 'default');
});
