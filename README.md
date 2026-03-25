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

## Status

- Repository scaffolded.
- ADR 0001 and ADR 0002 added.
- Portable skill bundle scaffolded under `skill/`.
- Core submit CLI scaffolded with receipt JSON output and step-based failure reporting.
- Visible browser automation implementation is still placeholder/TODO.
