export function createReceipt({
  submitted,
  modeResolved,
  projectResolved,
  url,
  surface = null,
  proofLevel = null,
  targetWindowHandle = null,
  conversationUrl = null,
  screenshotPath = null,
  notes = []
}) {
  return {
    submitted,
    timestamp: new Date().toISOString(),
    modeResolved,
    projectResolved,
    url,
    surface,
    proofLevel,
    targetWindowHandle,
    conversationUrl,
    screenshotPath,
    notes
  };
}

export function createFailureReceipt({
  error,
  screenshotPath = null,
  url = null,
  surface = null,
  proofLevel = null,
  targetWindowHandle = null,
  conversationUrl = null,
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
    surface,
    proofLevel,
    targetWindowHandle,
    conversationUrl,
    screenshotPath,
    notes
  };
}
