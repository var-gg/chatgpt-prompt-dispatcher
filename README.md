# Windows desktop prompt dispatcher for ChatGPT

`chatgpt-prompt-dispatcher` is an unofficial, local-only tool for submitting prepared prompts into a locally logged-in ChatGPT web session on Windows.

The repo is now **desktop-first**:
- default path = Windows desktop input dispatcher backed by a calibrated visible ChatGPT window
- retained fallback = Playwright browser transport for compatibility / experimental use

## Purpose

- Focus a visible local ChatGPT window.
- Paste a prepared prompt through Windows desktop input dispatch.
- Optionally submit through click or Enter.
- Return a submission receipt JSON instead of response content.
- Keep the browser transport available behind an explicit experimental command.

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

## Supported Environment

- Korean Windows first (`ko-KR.windows.*` profiles)
- ChatGPT Pro UI first
- ChatGPT Plus fallback supported through a separate profile
- local browser session only

## Discoverable vs Runnable

**Discoverable** means OpenClaw can find the skill because a scanned directory contains a top-level `SKILL.md`.

**Runnable** means the installed bundle also contains everything needed to execute:
- `profiles/`
- `adapters/`
- `runtime/`
- `bundle.manifest.json`
- `skill.install.lock.json`

This repo materializes a self-contained bundle so the installed skill can be both discoverable and runnable.

## Primary transport: desktop

Default command:

```bash
npm run submit -- --prompt "안녕하세요" --dry-run
npm run submit -- --prompt-file .\prompt.txt --calibration-profile default --window-title "ChatGPT" --submit-method click
```

Explicit desktop alias:

```bash
npm run submit-desktop -- --prompt "안녕하세요" --dry-run
```

Desktop transport currently:
- focuses a visible window by title hint
- resizes it toward a standardized rectangle from the calibration profile
- clicks the calibrated prompt box point
- pastes via clipboard
- optionally submits by click or Enter
- returns receipt JSON only

Current desktop limitations:
- no project navigation yet
- no attachment upload yet
- no browser-side mode selection beyond the default path
- no response reading or scraping

If you need project entry, attachments, or browser-side mode selection, use the experimental browser path.

## Experimental browser transport

Explicit command:

```bash
npm run submit-browser -- --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
npm run submit-browser -- --prompt-file .\prompt.txt --project "Example Project" --mode thinking --attachment .\sample.txt --profile ko-KR.windows.pro --dry-run
npm run submit -- --transport=browser --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
```

Browser transport status:
- retained for compatibility
- Playwright-backed
- non-primary
- experimental

## Warmup command

```bash
npm run warmup -- --profile ko-KR.windows.pro --browser-profile-dir .\.tmp\warmup-profile
```

Use warmup when you need to open ChatGPT in a visible browser and complete manual login/captcha before using the experimental browser transport.

## Core commands

```bash
npm install
npm test
npm run pack-skill
npm run register-openclaw
npm run submit -- --prompt "안녕하세요" --dry-run
npm run submit-browser -- --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
npm run install-local -- --mode copy --target .\.tmp\local-skill-install --profile ko-KR.windows.pro
```

## Dry-Run vs Live

### Dry-Run
- runs the selected transport up to the pre-submit point
- returns a receipt JSON
- does **not** execute final submission

### Live
- runs the selected transport end-to-end
- performs prompt submission
- returns a receipt JSON afterward

Both modes keep the contract limited to prompt submission receipts.

## Testing Strategy

### Unit Tests

```bash
npm test
```

Covers:
- argument parsing
- transport routing
- profile interpretation
- receipt generation
- smoke gating
- candidate ordering

### Live Smoke

Live smoke remains opt-in and is scoped to the **experimental browser transport**.

```bash
LIVE_CHATGPT=1 npm run smoke -- A --profile ko-KR.windows.pro --browser-profile-dir .\.tmp\smoke-profile-a
LIVE_CHATGPT=1 npm run smoke -- B --profile ko-KR.windows.pro --project "Example Project" --mode auto --browser-profile-dir .\.tmp\smoke-profile-b
```

If a live smoke fails, stdout includes:
- full receipt JSON
- `screenshotPath`
- `failureArtifacts.logPath`
- `failureArtifacts.lastStep`

Without `LIVE_CHATGPT=1`, smoke exits with a skip message.

## Packaging and Installation

### Build Shareable Skill Bundle

```bash
npm run pack-skill
```

Outputs:
- `dist/skill-bundle/`
- `dist/chatgpt-web-submit-bundle.zip`

### Install Into OpenClaw Skill Path

```bash
npm run install-local -- --target ~/.openclaw/skills/chatgpt-web-submit --mode copy
npm run register-openclaw
```

## Repo layout

- `src/submit-chatgpt.js` = desktop-first transport router
- `src/desktop/` = Windows desktop dispatcher implementation
- `src/submit-browser-chatgpt.js` = experimental browser transport
- `src/playwright-runtime.js` = retained Playwright automation runtime
- `skill/` = portable skill bundle source

## Architecture reference

See `docs/desktop-first-architecture.md`.
