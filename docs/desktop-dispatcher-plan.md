# Desktop ChatGPT dispatcher plan

## Goal

Pivot this repo toward a **Windows desktop-input dispatcher for ChatGPT Web** while keeping scope intentionally narrow:

- ChatGPT-specific only
- local visible desktop interaction only
- no response scraping
- no login automation
- no generic RPA ambitions

This first pass adds a practical skeleton for a desktop mode without deleting the existing Playwright path yet.

## Why pivot

Playwright is useful when the DOM is stable, but ChatGPT UI drift and browser-session constraints make a desktop-input path attractive for local operator workflows. A desktop dispatcher can work against the already-visible ChatGPT window and keep the boundary simple: focus the window, place the pointer relative to a calibrated Chrome window, paste a prompt, and optionally submit.

## First-pass architecture

### 1. CLI layer

New command:

- `submit-desktop-chatgpt`

Responsibilities:
- parse prompt input and desktop-specific flags
- load a calibration profile
- compute absolute screen coordinates from normalized coordinates
- execute a Windows input plan
- return a receipt JSON

### 2. Calibration profile storage

JSON-backed profile store for deterministic data:
- target window width/height
- optional window title hint
- normalized anchor coordinates for ChatGPT controls
  - prompt editor
  - new chat button
  - submit button
  - project picker anchor (reserved)

Default repo path for bootstrap/testing:
- `profiles/desktop/*.json`

Longer-term likely user path:
- `%USERPROFILE%\.chatgpt-prompt-dispatcher\desktop-profiles\`

### 3. Geometry helpers

Deterministic functions for:
- normalized coordinate validation
- normalized -> absolute conversion
- absolute -> normalized conversion
- standardized Chrome window rectangle planning

These are easy to unit test and keep desktop behavior auditable.

### 4. Windows desktop driver

Node-first wrapper that shells out to PowerShell for small focused actions:
- activate/focus window by title hint
- move/resize a window toward a standard rectangle
- mouse click
- type text
- paste clipboard text
- key press / key chord

This layer is intentionally thin. It is an execution adapter, not a policy engine.

### 5. ChatGPT desktop plan runner

A ChatGPT-specific flow runner using calibration anchors:
1. focus target Chrome window
2. resize/move toward standard bounds
3. click prompt editor anchor
4. paste prompt from clipboard
5. optionally click submit anchor

## Calibration strategy

### Standardized window

Assume the operator keeps ChatGPT in a normal Chrome window resized to a known baseline, for example:
- width: 1440
- height: 900

Coordinates are stored as normalized values in `[0, 1]` relative to that content/window rectangle.

Example:
- prompt editor center: `{ x: 0.50, y: 0.92 }`
- submit button center: `{ x: 0.965, y: 0.92 }`

At runtime, those normalized points are transformed into absolute screen coordinates using the actual window rectangle.

### Why normalized coordinates

Benefits:
- resilient to monitor resolution changes
- deterministic and testable
- easy to hand-edit in JSON
- easy to recalibrate incrementally

### Lightweight fallback ideas

Documented for later, not fully implemented yet:
- keyboard-first fallback when pointer anchors drift (`Ctrl+L`, navigate, `Tab` stepping, `Ctrl+V`, `Enter`)
- multiple anchor variants per UI tier (Pro/Plus)
- profile-specific offsets for Chrome zoom / Windows scaling
- optional visible overlay helper for guided calibration capture

## Current limitations

- no OCR or visual detection yet
- no DOM awareness in desktop mode
- no attachment flow yet in desktop mode
- project/mode selection is reserved but not automated yet
- PowerShell-based window/input calls are best-effort placeholders and may require environment-specific hardening

## Next steps after this first pass

1. Add a calibration capture helper command
2. Strengthen PowerShell window enumeration and coordinate reporting
3. Add keyboard-only fallback path
4. Add optional screenshot/verification hooks
5. Decide whether Playwright remains as fallback or is retired after desktop mode proves stable
