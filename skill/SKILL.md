---
name: chatgpt-web-submit
description: Submit prepared prompts into a locally logged-in ChatGPT web session on Windows through a Windows desktop input dispatcher backed by a visible ChatGPT window. Use when the task is only to submit a prepared prompt and receive a receipt JSON. Use the retained browser transport only when project entry, attachments, or browser-side mode selection are still required. Do not use when the task requires reading replies, scraping responses, calling unofficial APIs, automating login, extracting cookies/tokens/session data, or interacting with hidden/internal endpoints.
---

# chatgpt-web-submit

Use this skill only for **prompt submission** into a local, already logged-in ChatGPT session.

## Core Boundary

This skill **submits** a prepared prompt to ChatGPT and returns a receipt JSON.

It does **not**:
- read the assistant response
- scrape page output
- call unofficial APIs or internal endpoints
- automate login
- export or inspect cookies, tokens, or browser session storage

## Use This Skill When

- You already have a local logged-in ChatGPT session.
- You want desktop-first prompt submission on Windows.
- You need a submission receipt JSON instead of model output.
- You only need the browser transport for compatibility features such as project entry or attachments.

## Do Not Use This Skill When

- You need the model's answer text.
- You need response scraping, DOM extraction, or transcript capture.
- You need API-style ChatGPT access.
- The user is not logged in and expects the agent to log in for them.
- The task depends on cookie reuse, account export, token capture, or hidden browser/session inspection.

## Runtime Model

- Repository root = source of truth
- `skill/` = portable install bundle
- runtime state = separate, outside the portable bundle

## References

Read as needed:
- `references/install.md` for packaging/install/materialization
- `references/profiles.md` for adding locale/platform/tier profiles
- `references/known-limitations.md` for current boundaries and expected drift
- `../docs/desktop-first-architecture.md` in the repo root for transport strategy

## Execution Notes

- Prefer `submit-chatgpt` / `npm run submit -- ...`.
- Treat `submit-browser-chatgpt` / `--transport=browser` as experimental compatibility paths.
- Return the submission receipt JSON only.
- If login is missing for browser warmup/transport, wait for manual login through the visible browser UI.
- Preserve screenshots/logs in runtime artifacts, not in the bundle.
