# Windows desktop ChatGPT Pro handoff skill

`chatgpt-prompt-dispatcher` is a local Windows skill/runtime for sending prompts into a visible, already logged-in ChatGPT web session without scraping replies.

The repo is **desktop-first**:
- primary path = calibrated Windows desktop dispatch into ChatGPT
- Pro handoff path = fresh chat + Pro mode + prompt submit
- retained fallback = experimental Playwright browser transport for compatibility only
- packaged skill id = `chatgpt-web-submit`

## What it does

- Borrow session state from a visible local ChatGPT window.
- For `submit-pro-chatgpt`, open a dedicated fresh Chrome/Edge window and bind automation to that new top-level handle only.
- Normalize navigation to `https://chatgpt.com/`.
- Optionally switch the visible UI to `Pro`.
- Paste and validate a prepared prompt.
- Submit immediately and return a receipt JSON with strict proof metadata when requested.

Receipt semantics:
- `submitted: true` on the strict Pro path means the prompt hash was validated, the submit attempt ran in the dedicated target window, the run proved a `https://chatgpt.com/c/<id>` conversation URL from the visible window, and a screenshot of that exact window was saved.
- It does not imply response scraping, reply retrieval, or transcript reading.

## What it does not do

- read assistant responses
- scrape transcript content
- automate login
- call unofficial APIs or hidden endpoints
- extract cookies, tokens, or browser session data

## Prerequisites

- unlocked local Windows desktop session
- same user session for Node, the PowerShell worker, and the visible Chrome/Edge window
- non-elevated browser and non-elevated dispatcher runtime
- clipboard access allowed
- existing manual ChatGPT login
- keep a visible ChatGPT tab/window, or a blank/new browser shell that can be safely navigated to ChatGPT

## Repo URL Quickstart

If another AI agent only receives this repository URL, this is the shortest correct setup path:

```bash
git clone https://github.com/var-gg/chatgpt-prompt-dispatcher.git
cd chatgpt-prompt-dispatcher
npm install
npm run register-openclaw
node ~/.openclaw/skills/chatgpt-web-submit/scripts/submit-pro.js --prompt "desktop install dry-run" --dry-run --window-title "ChatGPT"
```

What that does:
- builds the portable bundle if needed
- materializes the skill into `~/.openclaw/skills/chatgpt-web-submit`
- installs runtime dependencies under the materialized skill
- leaves OpenClaw core untouched

If the dry-run receipt succeeds, the installed skill is ready for agent-driven use.

## Agent Handoff Contract

When handing only this repo to another agent, the agent should:
- treat `npm install` then `npm run register-openclaw` as the canonical bootstrap path
- prefer the installed wrapper at `~/.openclaw/skills/chatgpt-web-submit/scripts/submit-pro.js`
- assume the target machine is a local Windows desktop with a visible, already logged-in ChatGPT browser window
- use `npm run inspect-desktop` or `npm run calibrate-desktop` before weakening the desktop boundary

The agent should not:
- try to read ChatGPT replies from the browser
- automate login
- inspect cookies, tokens, session storage, or hidden APIs
- silently switch the workflow to response scraping

## Primary commands

General desktop submit:

```bash
npm run submit -- --prompt "안녕하세요" --dry-run
npm run submit -- --prompt-file .\prompt.txt --calibration-profile default
```

Dedicated Pro handoff:

```bash
npm run submit-pro -- --prompt-file .\prompt.txt
npm run submit-pro -- --prompt "이 요구사항을 구현하는 최선의 접근을 제안해줘" --dry-run
```

Defaults for `submit-pro-chatgpt`:
- `--mode pro`
- `--new-chat`
- `--surface new-window`
- `--proof-level strict`

Explicit desktop alias:

```bash
npm run submit-desktop -- --prompt "안녕하세요" --mode pro --new-chat
```

Desktop fallback order:
- UIA
- focus + Enter
- calibrated coordinates

## Calibration and diagnostics

Interactive calibration:

```bash
npm run calibrate-desktop -- --calibration-profile default --window-title "ChatGPT"
```

Inspection:

```bash
npm run inspect-desktop -- --calibration-profile default
```

For Pro handoff, keep these anchors healthy:
- `promptInput`
- `submitButton`
- `newChatButton`
- `modeButton`

Strict Pro receipts also save:
- `targetWindowHandle`
- `conversationUrl`
- `screenshotPath`

## Experimental browser transport

```bash
npm run submit-browser -- --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
npm run submit -- --transport=browser --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
```

Browser transport remains:
- experimental
- compatibility-only
- useful for project entry or attachment flows that the desktop path still rejects

## Testing

Node's default test isolation spawns subprocesses in this environment, so use:

```bash
node --test --experimental-test-isolation=none tests/*.test.js
```

Live smoke remains opt-in and browser-scoped:

```bash
LIVE_CHATGPT=1 npm run smoke -- A --profile ko-KR.windows.pro --browser-profile-dir .\.tmp\smoke-profile-a
LIVE_CHATGPT=1 npm run smoke -- B --profile ko-KR.windows.pro --project "Example Project" --mode auto --browser-profile-dir .\.tmp\smoke-profile-b
```

## Packaging and install

Build the bundle:

```bash
npm run pack-skill
```

Outputs:
- `dist/skill-bundle/chatgpt-web-submit/`
- `dist/chatgpt-web-submit-bundle.zip`

Install into an OpenClaw skill root:

```bash
npm install
npm run install-local -- --target ~/.openclaw/skills/chatgpt-web-submit --mode copy
npm run register-openclaw
```

Fastest repo-root bootstrap:

```bash
npm install
npm run register-openclaw
```

Installed wrapper for skill-driven execution:

```bash
node ~/.openclaw/skills/chatgpt-web-submit/scripts/submit-pro.js --prompt-file <prompt-file>
```

## Forward-testing

Use the installed or bundled skill on real requests:
- rough request -> synthesize a stronger Pro prompt -> submit
- explicit prompt -> submit as-is

Keep the validation boundary strict:
- verify trigger quality
- verify wrapper/CLI ergonomics
- verify calibration recovery instructions
- do not read responses

## Repo layout

- `src/submit-pro-chatgpt.js` = dedicated Pro handoff command
- `src/submit-chatgpt.js` = transport router
- `src/desktop/` = Windows desktop dispatcher and helpers
- `src/submit-browser-chatgpt.js` = experimental browser transport
- `skill/` = portable skill bundle source

## Architecture reference

See `docs/desktop-first-architecture.md`.
