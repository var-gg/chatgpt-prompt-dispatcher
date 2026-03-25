# OpenClaw adapter

This adapter exposes a desktop-backed ChatGPT prompt submission runtime for OpenClaw.

## Primary transport

- `submit-chatgpt` → Windows desktop input dispatcher backed by a visible ChatGPT window and persistent PowerShell worker

## Diagnostics

- `inspect-desktop-chatgpt`
- `calibrate-desktop-chatgpt`

## Compatibility transport

- `submit-browser-chatgpt` → retained experimental Playwright path
- `submit-chatgpt --transport=browser` → explicit browser override

## Boundary

- submit prepared prompts only
- return receipt JSON only
- do not read or scrape assistant responses
- same-user unlocked desktop session required
