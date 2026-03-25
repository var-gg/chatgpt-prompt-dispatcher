---
name: chatgpt-web-submit
description: Dispatch a prompt into a logged-in ChatGPT web session through visible browser automation on Windows. Use when the task is to open a new chat or enter a specified ChatGPT Project and submit a prompt, optionally handling attachment-menu interaction, without reading responses or using unofficial APIs.
---

# chatgpt-web-submit

Use this skill to dispatch prompts into the ChatGPT web UI through visible browser automation only.

## Rules

- Stay inside visible browser interaction boundaries.
- Do not read or scrape responses.
- Do not automate login.
- Do not call unofficial APIs or internal endpoints.
- Do not extract cookies, tokens, or browser session material.

## Repository Model

- The repository root is the source of truth.
- This `skill/` directory is the portable install bundle.
- Runtime state must live outside the portable bundle.

## References

- Read `references/architecture.md` for package layout and separation principles.
- Read `references/boundaries.md` for allowed vs forbidden behavior.

## Scripts

- Use `scripts/install-local.ps1` as the placeholder local materialization entrypoint.
