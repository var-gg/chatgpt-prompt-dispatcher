# ADR 0003: Core CLI Submission Contract

- Status: Accepted
- Date: 2026-03-25

## Context

The MVP needs a local command that can drive visible ChatGPT web submission flows without reading responses. The command must accept prompt input, project selection hints, mode selection hints, attachment paths, and browser profile hints while returning a machine-readable receipt rather than scraped content.

## Decision

Define a core CLI command named `submit-chatgpt`.

Supported parameters in the early contract:

- `--prompt`
- `--prompt-file`
- `--mode` (`auto|latest|instant|thinking|pro`)
- `--project`
- `--new-chat` / `--no-new-chat`
- `--attachment` (repeatable)
- `--profile`
- `--dry-run`
- `--screenshot-path`
- `--browser-profile-dir`

The command returns a submission receipt JSON with:

- `submitted`
- `timestamp`
- `modeResolved`
- `projectResolved`
- `url`
- `screenshotPath`
- `notes`

Failures return a failure receipt with step-level error metadata. The implementation must not scrape responses and must only capture enough state to prove submission flow progress and failure location.

## Consequences

- Response content is intentionally out of scope for the CLI.
- The contract is safe for OpenClaw/MCP wrappers because it returns metadata only.
- Later browser automation work can evolve behind the same CLI boundary.
