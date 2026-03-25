# Unofficial local input automation for ChatGPT web

`chatgpt-prompt-dispatcher` is an unofficial, local-only tool for submitting prepared prompts into a locally logged-in ChatGPT web session through visible browser automation.

## Purpose

- Open ChatGPT Web in a local logged-in browser session.
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

## Core Commands

```bash
npm install
npm test
npm run pack-skill
npm run submit -- --prompt "안녕하세요" --profile ko-KR.windows.pro --dry-run
npm run submit -- --prompt-file .\prompt.txt --project "Example Project" --mode thinking --attachment .\sample.txt --profile ko-KR.windows.pro --dry-run
npm run install-local -- --mode symlink
npm run install-local -- --mode copy --target .\.tmp\local-skill-install --profile ko-KR.windows.pro
```

## Flow Summary

### New Chat Flow

Used when no project is specified.

1. Launch persistent local browser profile.
2. Open `https://chatgpt.com/`.
3. Wait for manual login if needed.
4. Start a new chat.
5. Select mode if requested.
6. Attach files if requested.
7. Input prompt.
8. Submit.

### Project Flow

Used when `--project` is specified.

1. Launch persistent local browser profile.
2. Open `https://chatgpt.com/`.
3. Wait for manual login if needed.
4. Enter the specified project.
5. Select mode if requested.
6. Attach files if requested.
7. Input prompt.
8. Submit.

### Attachment Flow

Attachments are limited to visible UI interaction only:
- open tools/attachment menu
- choose upload entry
- submit selected local files

No hidden upload endpoints or session extraction are used.

## Dry Run

Use `--dry-run` to stop before actual submission.

Dry run returns:
- submission receipt JSON
- resolved mode/project notes
- flow interpretation notes
- screenshot/artifact path
- structured log path

Example:

```bash
npm run submit -- --prompt "테스트" --project "Example Project" --mode thinking --attachment .\README.md --profile ko-KR.windows.pro --dry-run
```

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
- smoke command gating

### Live Smoke

```bash
LIVE_CHATGPT=1 npm run smoke -- --prompt "live smoke" --profile ko-KR.windows.pro --dry-run
```

Live smoke is opt-in only. Without `LIVE_CHATGPT=1`, it exits with a skip message.

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
npm run install-local -- --mode symlink
npm run install-local -- --mode copy --target <path> --profile ko-KR.windows.pro
```

Install state is tracked in `skill.install.lock.json`.

## Logging and Failure Artifacts

Runtime artifacts are written outside source control:
- `artifacts/logs/*.jsonl`
- `artifacts/screenshots/*`

Receipts include notes for:
- `logPath`
- `lastStep`

## Troubleshooting

### The tool says login is required
- Log in manually in the local browser session.
- Re-run or continue only after ChatGPT Web is visibly ready.

### A mode option is not found
- Check whether the selected profile matches the active UI tier.
- Try `ko-KR.windows.pro` first for Pro UI.
- Update profile candidates if ChatGPT labels drift.

### Project navigation fails
- Verify the project name exactly.
- Confirm the visible Projects entry exists in the current UI.
- Add candidate labels/text/selectors to the relevant profile if needed.

### Attachment menu differs
- Update the tools-menu candidate list in the selected profile.
- Keep changes in profile data rather than hard-coding selectors.

### CI passes but live UI still fails
- This is expected when UI labels drift.
- Reproduce with `--dry-run`, inspect logs, update profile candidates, and re-test.

## Current Status

- Core CLI scaffold implemented
- Profile-driven UI resolution implemented
- Structured logging and failure receipts implemented
- Portable skill packaging implemented
- OpenClaw and MCP adapter scaffolds implemented
- Response collection intentionally not implemented
