# Desktop worker architecture

## Goal

Replace per-action PowerShell process spawning with a persistent Windows desktop worker.

## Model

- Node remains the orchestration layer.
- PowerShell becomes a long-lived worker process.
- Communication uses JSON-RPC-like messages over stdio.
- Each request/response pair is logged to JSONL.

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

## Implementation constraints

- The worker uses `Add-Type` with `user32.dll` interop for window and pointer actions.
- UI Automation uses .NET `System.Windows.Automation` / `UIAutomationClient`.
- The worker is spawned once and reused.
- Per-action PowerShell process creation is removed from the desktop input path.
- Errors are returned with explicit codes such as `FG_LOCKED`, `UIPI_BLOCKED`, `WINDOW_NOT_FOUND`, and `UIA_EMPTY`.

## Boundary

- Screenshots are not part of the worker's normal command surface.
- Failure screenshots remain opt-in and should be limited to a single capture in higher layers when added.
- The worker does not read assistant responses.
