# Desktop worker architecture

## Goal

Replace per-action PowerShell process spawning with a persistent Windows desktop worker.

## Model

- Node remains the orchestration layer.
- PowerShell becomes a long-lived worker process.
- Communication uses JSON-RPC-like messages over stdio.
- Each request/response pair is logged to JSONL.
- Worker calls inherit an `automationContext` with `runId`, `attemptIndex`, `phase`, `step`, and `targetWindowHandle`.
- Canonical diagnostics live under `artifacts/runs/<timestamp>-<runId>/`, not only in shared aggregate logs.

## Worker responsibilities

The worker provides these minimum commands:
- `listChromeWindows`
- `focusWindow`
- `moveResizeWindow`
- `getWindowRect`
- `getForegroundWindow`
- `setClipboard`
- `getClipboard`
- `sendKeys`
- `click`
- `doubleClick`
- `rightClick`
- `getUrlViaOmnibox`
- `uiaQueryByNameRole`
- `uiaGetFocusedElement`
- `waitForWindow`
- `waitForElement`
- `captureWindowScreenshot`
- `cropImage`
- `ocrImageText`

## Implementation constraints

- The worker uses `Add-Type` with `user32.dll` interop for window and pointer actions.
- UI Automation uses .NET `System.Windows.Automation` / `UIAutomationClient`.
- The worker is spawned once and reused.
- Per-action PowerShell process creation is removed from the desktop input path.
- Errors are returned with explicit codes such as `FG_LOCKED`, `UIPI_BLOCKED`, `WINDOW_NOT_FOUND`, and `UIA_EMPTY`.
- Worker/client logs must not persist raw clipboard or prompt text. They record hashes, lengths, timing, result class, and automation context instead.

## Boundary

- Screenshots, crops, and OCR are allowed only as visible-surface proof for submit gating and strict post-submit confirmation.
- Failure diagnostics may persist a failure-only prompt artifact for replay, but receipts must not inline the full prompt.
- The worker does not read assistant responses.
