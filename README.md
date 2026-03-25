# Windows desktop prompt dispatcher for ChatGPT

`chatgpt-prompt-dispatcher` is an unofficial, local-only tool for submitting prepared prompts into a locally logged-in ChatGPT web session on Windows.

The repo is **desktop-first**:
- default path = Windows desktop input dispatcher backed by a calibrated visible ChatGPT window
- retained fallback = Playwright browser transport for compatibility / experimental use
- packaged skill id remains `chatgpt-web-submit`

## Prerequisites

- unlocked local Windows desktop session
- same user session for the Node runtime, PowerShell worker, and visible Chrome window
- non-elevated Chrome / Edge and non-elevated dispatcher runtime in the same desktop integrity level
- clipboard save/restore must be allowed
- no response scraping
- screenshots are not part of normal flow; allow only failure-only capture if you add that later

## Purpose

- Focus a visible local ChatGPT window.
- Validate or repair navigation to `https://chatgpt.com/`.
- Paste a prepared prompt through Windows desktop input dispatch.
- Validate prompt input against a credible ChatGPT composer target, while tolerating degraded visible send-state proof.
- Attempt submission immediately once the composer is credibly reached, using Enter-first / send-button fallback as needed.
- Return a submission receipt JSON instead of response content.

## Non-Goals

This project intentionally does **not**:
- read assistant responses
- scrape DOM output or transcript content
- call unofficial APIs or internal endpoints
- automate login
- export cookies, tokens, or browser session material
- back up account/session secrets

## Security Boundary

Allowed:
- Windows desktop input dispatch into a visible locally logged-in ChatGPT window
- manual login by the user, with browser warmup only waiting for completion
- local prompt submission and receipt generation
- retained experimental browser automation for compatibility

Forbidden:
- response collection
- hidden API usage
- login automation
- browser storage extraction
- token/cookie/session export

## Primary transport: desktop

Default command:

```bash
npm run submit -- --prompt "안녕하세요" --dry-run
npm run submit -- --prompt-file .\prompt.txt --calibration-profile default --window-title "ChatGPT"
```

Explicit desktop alias:

```bash
npm run submit-desktop -- --prompt "안녕하세요" --dry-run
```

Fallback order:
- UIA
- keyboard shortcut / omnibox trick
- calibrated coordinates

## Calibration + inspection

Interactive calibration:

```bash
npm run calibrate-desktop -- --calibration-profile default --window-title "ChatGPT"
```

Inspection / diagnostics:

```bash
npm run inspect-desktop -- --depth 1
```

These commands are the intended answer to UI drift in MVP. OCR / vision fallback is intentionally out of scope.

## Experimental browser transport

```bash
npm run submit-browser -- --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
npm run submit -- --transport=browser --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
```

Browser transport status:
- retained for compatibility
- Playwright-backed
- non-primary
- experimental

## Testing Strategy

### Unit tests

```bash
npm test
```

### Live smoke

Live smoke remains opt-in and is scoped to the **experimental browser transport**.

```bash
LIVE_CHATGPT=1 npm run smoke -- A --profile ko-KR.windows.pro --browser-profile-dir .\.tmp\smoke-profile-a
LIVE_CHATGPT=1 npm run smoke -- B --profile ko-KR.windows.pro --project "Example Project" --mode auto --browser-profile-dir .\.tmp\smoke-profile-b
```

Without `LIVE_CHATGPT=1`, smoke exits with a skip message.

## Packaging and Installation

### Build bundle

```bash
npm run pack-skill
```

Outputs:
- `dist/skill-bundle/chatgpt-web-submit/`
- `dist/chatgpt-web-submit-bundle.zip`

Bundle contents include:
- desktop worker
- Node client/runtime
- profiles
- adapters
- skill metadata
- install/register scripts

### Install into OpenClaw

From repo:

```bash
npm run install-local -- --target ~/.openclaw/skills/chatgpt-web-submit --mode copy
npm run register-openclaw
```

From installed bundle only:

```bash
node scripts/install-local.js --target ~/.openclaw/skills/chatgpt-web-submit --mode copy
node scripts/register-openclaw.js
```

## Repo layout

- `src/submit-chatgpt.js` = desktop-first transport router
- `src/desktop/` = Windows desktop dispatcher implementation + persistent PowerShell worker
- `src/submit-browser-chatgpt.js` = experimental browser transport
- `src/playwright-runtime.js` = retained Playwright automation runtime
- `skill/` = portable skill bundle source

## Architecture reference

See `docs/desktop-first-architecture.md`.
