import test from 'node:test';
import assert from 'node:assert/strict';
import { __desktopWorkerInternals } from '../src/desktop/powershell.js';

const {
  describeSensitiveText,
  sanitizeWorkerError,
  sanitizeWorkerValue,
  normalizeAutomationContext
} = __desktopWorkerInternals;

test('describeSensitiveText hashes clipboard-like payloads instead of logging raw prompt text', () => {
  const described = describeSensitiveText('LONG PROMPT BODY');

  assert.equal(typeof described.textHash, 'string');
  assert.equal(described.textLength, 16);
});

test('sanitizeWorkerValue removes raw text and automation context from worker logs', () => {
  const sanitized = sanitizeWorkerValue({
    text: 'secret prompt',
    imagePath: 'shot.png',
    automationContext: {
      runId: 'abc'
    }
  });

  assert.deepEqual(sanitized, {
    text: {
      textHash: describedHashFor('secret prompt'),
      textLength: 13
    },
    imagePath: 'shot.png'
  });
});

test('sanitizeWorkerError redacts text-like fields in error data', () => {
  const sanitized = sanitizeWorkerError({
    code: 'UIA_SET_VALUE_FAILED',
    message: 'bad',
    data: {
      value: 'secret prompt'
    }
  });

  assert.equal(sanitized.code, 'UIA_SET_VALUE_FAILED');
  assert.equal(sanitized.data.value.textLength, 13);
});

test('normalizeAutomationContext removes empty fields and stringifies structured values', () => {
  assert.deepEqual(normalizeAutomationContext({
    runId: 'run-1',
    phase: 'submit-attempt',
    empty: '',
    structured: { ok: true }
  }), {
    runId: 'run-1',
    phase: 'submit-attempt',
    structured: '{"ok":true}'
  });
});

function describedHashFor(value) {
  return describeSensitiveText(value).textHash;
}
