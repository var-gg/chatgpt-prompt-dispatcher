# Desktop ChatGPT dispatcher plan

## Goal

Pivot this repo toward a **Windows desktop-input dispatcher for ChatGPT Web** while keeping scope intentionally narrow:

- ChatGPT-specific only
- local visible desktop interaction only
- no response scraping
- no login automation
- no generic RPA ambitions

This desktop path is now the **primary transport**. The retained Playwright path remains available only as an experimental compatibility transport.

## Why pivot

Playwright is useful when the DOM is stable, but ChatGPT UI drift and browser-session constraints make a desktop-input path attractive for local operator workflows. A desktop dispatcher can work against the already-visible ChatGPT window and keep the boundary simple: focus the window, place the pointer relative to a calibrated Chrome window, paste a prompt, and optionally submit.

## First-pass architecture

### 1. CLI layer

Primary command:
- `submit-chatgpt`

Explicit desktop alias:
- `submit-desktop-chatgpt`

Experimental compatibility command:
- `submit-browser-chatgpt`

Responsibilities:
- keep one receipt contract across transports
- route default submission to the desktop dispatcher
- retain the browser transport only behind explicit selection
- execute a Windows input plan or the browser compatibility plan
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

## Current limitations

Desktop-primary does **not** yet add:
- response reading
- OCR or transcript extraction
- attachment flow in desktop mode
- project entry in desktop mode
- browser-style mode selection in desktop mode

Those gaps do not justify changing the boundary. They only justify keeping the browser path as an explicit experimental fallback until the desktop dispatcher matures.

## Next steps after this first pass

1. Add a calibration capture helper command
2. Strengthen PowerShell window enumeration and coordinate reporting
3. Add keyboard-only fallback path
4. Add optional screenshot/verification hooks
5. Gradually shrink the experimental browser path as desktop coverage improves
