import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSuccessReceiptInvariant, createReceipt, createFailureReceipt } from '../src/receipt.js';

test('createReceipt returns submission metadata only', () => {
  const receipt = createReceipt({
    submitted: true,
    modeResolved: 'auto',
    projectResolved: null,
    url: 'https://chatgpt.com/',
    runId: 'run-123',
    artifactDir: 'artifacts/runs/run-123',
    surface: 'new-window',
    proofLevel: 'strict',
    targetWindowHandle: '12345',
    conversationUrl: 'https://chatgpt.com/c/abc',
    screenshotPath: 'shot.png',
    submitAttempted: true,
    submitAttemptMethod: 'enter',
    failureClass: null,
    failureReason: null,
    attemptCount: 2,
    finalAction: 'submitted-confirmed',
    debugArtifacts: { validationLevel: 'visual' },
    notes: ['ok']
  });

  assert.equal(receipt.submitted, true);
  assert.equal(receipt.modeResolved, 'auto');
  assert.ok(receipt.timestamp);
  assert.equal(receipt.url, 'https://chatgpt.com/');
  assert.equal(receipt.runId, 'run-123');
  assert.equal(receipt.artifactDir, 'artifacts/runs/run-123');
  assert.equal(receipt.surface, 'new-window');
  assert.equal(receipt.proofLevel, 'strict');
  assert.equal(receipt.targetWindowHandle, '12345');
  assert.equal(receipt.conversationUrl, 'https://chatgpt.com/c/abc');
  assert.equal(receipt.screenshotPath, 'shot.png');
  assert.equal(receipt.submitAttempted, true);
  assert.equal(receipt.submitAttemptMethod, 'enter');
  assert.equal(receipt.attemptCount, 2);
  assert.equal(receipt.finalAction, 'submitted-confirmed');
  assert.deepEqual(receipt.debugArtifacts, { validationLevel: 'visual' });
});

test('createFailureReceipt includes error metadata', () => {
  const receipt = createFailureReceipt({
    error: { code: 'INVALID_ARGS', step: 'parse-args', message: 'bad' },
    screenshotPath: 'last.png',
    url: 'https://chatgpt.com/',
    runId: 'run-999',
    artifactDir: 'artifacts/runs/run-999',
    surface: 'same-window',
    proofLevel: 'fast',
    targetWindowHandle: '999',
    conversationUrl: null,
    submitAttempted: false,
    submitAttemptMethod: null,
    failureClass: 'prompt-validation-failed',
    failureReason: 'bad',
    attemptCount: 1,
    finalAction: 'submit-withheld',
    debugArtifacts: {
      composerScreenshotPath: 'composer.png',
      validationProof: 'composerVisualStillPlaceholder'
    }
  });

  assert.equal(receipt.submitted, false);
  assert.equal(receipt.error.code, 'INVALID_ARGS');
  assert.equal(receipt.error.step, 'parse-args');
  assert.equal(receipt.runId, 'run-999');
  assert.equal(receipt.artifactDir, 'artifacts/runs/run-999');
  assert.equal(receipt.surface, 'same-window');
  assert.equal(receipt.proofLevel, 'fast');
  assert.equal(receipt.targetWindowHandle, '999');
  assert.equal(receipt.failureClass, 'prompt-validation-failed');
  assert.equal(receipt.failureReason, 'bad');
  assert.equal(receipt.finalAction, 'submit-withheld');
  assert.equal(receipt.debugArtifacts.validationProof, 'composerVisualStillPlaceholder');
});

test('strict success receipts enforce invariants', () => {
  assert.throws(() => createReceipt({
    submitted: true,
    modeResolved: 'pro',
    projectResolved: null,
    url: 'https://chatgpt.com/',
    proofLevel: 'strict',
    finalAction: 'submitted-confirmed',
    screenshotPath: null,
    conversationUrl: null,
    submitAttempted: false,
    notes: []
  }), /Strict success receipts must include conversationUrl/);

  assert.doesNotThrow(() => assertSuccessReceiptInvariant({
    submitted: true,
    proofLevel: 'strict',
    finalAction: 'submitted-confirmed',
    conversationUrl: 'https://chatgpt.com/c/abc',
    screenshotPath: 'shot.png',
    submitAttempted: true,
    failureClass: null,
    failureReason: null
  }));
});
