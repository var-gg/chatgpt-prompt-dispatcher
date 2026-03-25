# chatgpt-prompt-dispatcher

MVP for local ChatGPT web input automation on a logged-in browser session.

## Scope

- Open a new chat when no project is specified.
- Enter a prompt into the local logged-in ChatGPT browser session and submit it.
- Enter a specified ChatGPT Project first when requested, then submit.
- Support attachment-menu handling as part of the browser flow.
- Prioritize Korean Windows and ChatGPT Pro UI, with Plus fallback considerations.

## Non-goals

- Read or scrape model responses.
- Call unofficial APIs or internal endpoints.
- Automate login.
- Extract, back up, or export cookies/account/session material.

## Architecture

- Repository root = source of truth.
- `skill/` = portable install bundle.
- Runtime state = separate from the repository and portable bundle.
- Host adapters live under `adapters/` as thin wrappers around core logic.

## Layout

- `src/` core implementation and CLI scaffolding
- `profiles/` sample runtime profiles
- `tests/` automated smoke/test scaffolding
- `docs/adr/` architecture decisions
- `adapters/openclaw/` OpenClaw-specific wrapper notes
- `adapters/mcp/` MCP-specific wrapper notes
- `skill/` portable bundle root for installation/materialization

## CLI

Primary command forms:

- `node src/index.js submit-chatgpt --prompt "안녕" --dry-run`
- `npm run submit -- --prompt-file .\\prompt.txt --project "Example Project" --mode thinking --attachment .\\sample.txt`

Submission output is always a JSON receipt. It reports submission metadata only and does **not** include response scraping.

## Test Strategy

- `npm test`
  - unit tests only
  - argument parsing, profile interpretation, flow planning, and receipt generation
  - includes smoke command gating verification without launching a real browser
- `npm run smoke`
  - live smoke entrypoint
  - does nothing by default unless `LIVE_CHATGPT=1` is explicitly set
  - intended for visible local browser checks only

Example:

- `npm test`
- `LIVE_CHATGPT=1 npm run smoke -- --prompt "테스트" --profile ko-KR.windows.pro --dry-run`

## Observability

- Structured execution logs are written as JSONL under `artifacts/logs/`.
- Screenshots and failure artifacts are written under `artifacts/` and are gitignored.
- Receipts include `notes` entries for `logPath` and `lastStep`.

## Packaging and Host Integration

- `npm run pack-skill`
  - builds a shareable bundle under `dist/skill-bundle/`
  - creates `dist/chatgpt-web-submit-bundle.zip`
- `npm run install-local -- --mode symlink`
- `npm run install-local -- --mode copy --target <path>`

Install metadata is tracked in `skill.install.lock.json`.

## Explicit Non-Goal

- Response collection/scraping is intentionally **not implemented**.

## Status

- Repository scaffolded.
- ADR 0001 and ADR 0002 added.
- Portable skill bundle scaffolded under `skill/`.
- Core submit CLI scaffolded with receipt JSON output and step-based failure reporting.
- Visible browser automation implementation is still placeholder/TODO.
