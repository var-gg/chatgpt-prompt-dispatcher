# Unofficial local input automation for ChatGPT web

`chatgpt-prompt-dispatcher` is an unofficial, local-only tool for submitting prepared prompts into a locally logged-in ChatGPT web session on Windows.

The repo now has **two paths**:
- existing Playwright-based visible browser automation
- new first-pass **desktop-input ChatGPT dispatcher** based on a calibrated Chrome window

## Purpose

- Open ChatGPT Web in a local logged-in browser session.
- Support a desktop-input path that targets a visible calibrated ChatGPT window.
- Optionally enter a specified ChatGPT Project first.
- Optionally start a new chat.
- Optionally attach files through the visible tools/attachment menu.
- Choose a supported mode and submit the prompt.
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
- visible browser automation in a local logged-in session
- manual login by the user, with the tool only waiting for completion
- visible project selection, mode selection, prompt input, and attachment-menu interaction

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
- Local browser session only

## Discoverable vs Runnable

**Discoverable** means OpenClaw can find the skill because a scanned directory contains a top-level `SKILL.md`.

**Runnable** means the installed bundle also contains everything needed to execute:
- `profiles/`
- `adapters/`
- `runtime/`
- `bundle.manifest.json`
- `skill.install.lock.json`

This repo now materializes a self-contained bundle so the installed skill can be both discoverable and runnable.

## browserProfileDir Policy

- Never attach to the user's main Chrome profile.
- Always use a dedicated automation profile.
- On Windows live runs, if `--browser-profile-dir` is omitted, a dedicated automation profile is created automatically under:
  - `%USERPROFILE%\.chatgpt-prompt-dispatcher\automation-profiles\<profileName>`
- Browser channel preference:
  1. `msedge`
  2. `chrome`

## First Login Procedure

A fresh automation profile must be logged in manually once.

1. Run a live or dry-run command with the target profile.
2. The automation browser window opens.
3. Log in to ChatGPT manually in that automation window.
4. Wait until the prompt box is visible.
5. Re-run the command if the first attempt timed out at `LOGIN_REQUIRED`.

The tool waits for manual login, but it does not automate login.

## Desktop Mode (first pass)

New command:

```bash
npm run submit-desktop -- --prompt "안녕하세요" --calibration-profile default --dry-run
npm run submit-desktop -- --prompt-file .\prompt.txt --calibration-profile default --window-title "ChatGPT" --submit-method click
```

Desktop mode currently:
- focuses a visible window by title hint
- resizes it toward a standardized rectangle from the calibration profile
- clicks the calibrated prompt box point
- pastes via clipboard
- optionally submits by click or Enter

See `docs/desktop-dispatcher-plan.md` for the intended evolution and calibration strategy.

## Supported Scenarios

### New Chat
- default when no project is specified
- opens ChatGPT
- ensures login
- starts a new chat
- applies mode
- fills prompt
- submits

### Project
- used when `--project` is specified
- enters the named project first
- skips new-chat by default unless explicitly requested
- applies mode
- fills prompt
- submits

### Attachment
- enters visible tools / `+` menu only
- uses upload menu entry
- uploads through visible UI + file input/file chooser path

### Mode Selection
Supported modes:
- `auto`
- `latest`
- `instant`
- `thinking`
- `pro`

Modes are resolved through profile candidates. If the requested mode is not available in the selected profile/UI, the command returns a receipt error with `MODE_SELECTION_FAILED`.

## Core Commands

```bash
npm install
npm test
npm run pack-skill
npm run register-openclaw
npm run submit -- --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
npm run submit -- --prompt-file .\prompt.txt --project "Example Project" --mode thinking --attachment .\sample.txt --profile ko-KR.windows.pro --dry-run
npm run install-local -- --mode copy --target .\.tmp\local-skill-install --profile ko-KR.windows.pro
```

## Dry-Run vs Live

### Dry-Run
- launches a real browser
- navigates to ChatGPT
- waits for manual login if needed
- runs UI steps until just before actual submission
- captures a real screenshot
- returns a receipt JSON
- does **not** click final submit

### Live
- launches a real browser
- navigates to ChatGPT
- waits for manual login if needed
- executes the full UI path
- clicks submit
- captures a screenshot and receipt afterward

Both modes write JSONL logs and preserve the last screenshot.

## Testing Strategy

### Unit Tests

```bash
npm test
```

Covers:
- argument parsing
- profile interpretation
- flow planning
- receipt generation
- smoke gating
- candidate ordering

### Live Smoke

Live smoke remains opt-in and gated behind `LIVE_CHATGPT=1`.

#### Scenario A — New Chat + Thinking + Prompt Only

```bash
LIVE_CHATGPT=1 npm run smoke -- A --profile ko-KR.windows.pro --browser-profile-dir .\.tmp\smoke-profile-a
```

#### Scenario B — Project + Auto/Pro + One Attachment

```bash
LIVE_CHATGPT=1 npm run smoke -- B --profile ko-KR.windows.pro --project "Example Project" --mode auto --browser-profile-dir .\.tmp\smoke-profile-b
LIVE_CHATGPT=1 npm run smoke -- B --profile ko-KR.windows.pro --project "Example Project" --mode pro --browser-profile-dir .\.tmp\smoke-profile-b
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

### Local Install

```bash
npm run pack-skill
npm run install-local -- --mode copy --target <path> --profile ko-KR.windows.pro
```

Install materializes a runnable bundle root containing:
- `SKILL.md`
- `references/`
- `scripts/`
- `profiles/`
- `adapters/`
- `runtime/`
- `bundle.manifest.json`
- `skill.install.lock.json`

### OpenClaw Registration

```bash
npm run register-openclaw
```

Default registration target:
- `~/.openclaw/skills/chatgpt-web-submit`

The installed OpenClaw adapter executes the installed bundle runtime entry:
- `runtime/src/index.js`

## Logging and Failure Artifacts

Runtime artifacts are written under the active runtime directory:
- `artifacts/logs/*.jsonl`
- `artifacts/screenshots/*`

Receipts include notes for:
- `logPath`
- `lastStep`
- selector hits
- browser profile usage

## Troubleshooting

### `LOGIN_REQUIRED`
- Log in manually in the opened automation browser window.
- Re-run after the prompt box is visible.
- Reuse the same automation profile directory.

### `MODE_SELECTION_FAILED`
- Confirm the selected profile matches the actual UI tier.
- `ko-KR.windows.pro` should be tried first on Pro UI.
- Some modes may be absent in Plus or temporarily hidden by UI drift.

### Project selection fails
- Confirm the project exists and the visible name matches exactly.
- Update role/label/text/placeholder/selector candidates in the chosen profile.

### Attachment flow fails
- Confirm the visible tools or `+` menu exists.
- Update the upload-entry candidates in the profile.
- The tool intentionally does not use hidden upload endpoints.

### Installed bundle runs but repo changes do not apply
- Re-run:
  - `npm run pack-skill`
  - `npm run register-openclaw`
- Installed bundle runtime is separate from repo source.

### CI passes but live UI fails
- Expected when ChatGPT labels/layout drift.
- Reproduce with dry-run first.
- Inspect the receipt, screenshot, and JSONL log.
- Update profile candidates instead of hard-coding one-off selectors.

## Current Status

- Self-contained OpenClaw bundle packaging implemented
- Playwright persistent visible automation implemented
- Profile-driven UI resolution implemented
- Structured logging and failure receipts implemented
- OpenClaw installed-bundle adapter execution verified
- Response collection intentionally not implemented
