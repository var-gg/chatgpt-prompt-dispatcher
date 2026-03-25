export function createReceipt({
  submitted,
  modeResolved,
  projectResolved,
  url,
  screenshotPath = null,
  notes = []
}) {
  return {
    submitted,
    timestamp: new Date().toISOString(),
    modeResolved,
    projectResolved,
    url,
    screenshotPath,
    notes
  };
}

export function createFailureReceipt({
  error,
  screenshotPath = null,
  url = null,
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
    screenshotPath,
    notes
  };
}
