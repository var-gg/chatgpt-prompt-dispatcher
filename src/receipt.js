export function createReceipt({
  submitted,
  modeResolved,
  projectResolved,
  url,
  runId = null,
  artifactDir = null,
  surface = null,
  proofLevel = null,
  targetWindowHandle = null,
  conversationUrl = null,
  screenshotPath = null,
  submitAttempted = false,
  submitAttemptMethod = null,
  failureClass = null,
  failureReason = null,
  attemptCount = 1,
  finalAction = null,
  debugArtifacts = null,
  notes = []
}) {
  const receipt = {
    submitted,
    timestamp: new Date().toISOString(),
    modeResolved,
    projectResolved,
    url,
    runId,
    artifactDir,
    surface,
    proofLevel,
    targetWindowHandle,
    conversationUrl,
    screenshotPath,
    submitAttempted,
    submitAttemptMethod,
    failureClass,
    failureReason,
    attemptCount,
    finalAction,
    debugArtifacts,
    notes
  };
  assertSuccessReceiptInvariant(receipt);
  return receipt;
}

export function createFailureReceipt({
  error,
  screenshotPath = null,
  url = null,
  runId = null,
  artifactDir = null,
  surface = null,
  proofLevel = null,
  targetWindowHandle = null,
  conversationUrl = null,
  submitAttempted = false,
  submitAttemptMethod = null,
  failureClass = null,
  failureReason = null,
  attemptCount = 1,
  finalAction = null,
  debugArtifacts = null,
  notes = []
}) {
  return {
    submitted: false,
    timestamp: new Date().toISOString(),
    error: {
      code: error.code || 'UNEXPECTED_ERROR',
      step: error.step || 'unknown',
      message: error.message
    },
    url,
    runId,
    artifactDir,
    surface,
    proofLevel,
    targetWindowHandle,
    conversationUrl,
    screenshotPath,
    submitAttempted,
    submitAttemptMethod,
    failureClass,
    failureReason,
    attemptCount,
    finalAction,
    debugArtifacts,
    notes
  };
}

export function assertSuccessReceiptInvariant(receipt = {}) {
  if (receipt?.submitted !== true) {
    return receipt;
  }

  if (receipt?.proofLevel !== 'strict') {
    return receipt;
  }

  if (receipt?.finalAction !== 'submitted-confirmed') {
    throw new Error('Strict success receipts must use finalAction="submitted-confirmed".');
  }
  if (!String(receipt?.conversationUrl || '').trim()) {
    throw new Error('Strict success receipts must include conversationUrl.');
  }
  if (!String(receipt?.screenshotPath || '').trim()) {
    throw new Error('Strict success receipts must include screenshotPath.');
  }
  if (receipt?.submitAttempted !== true) {
    throw new Error('Strict success receipts must record submitAttempted=true.');
  }
  if (receipt?.failureClass || receipt?.failureReason || receipt?.error) {
    throw new Error('Strict success receipts cannot include failure metadata.');
  }

  return receipt;
}
