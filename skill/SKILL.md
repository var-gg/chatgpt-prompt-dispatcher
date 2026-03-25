---
name: chatgpt-web-submit
description: Submit prepared prompts into a locally logged-in ChatGPT web session through visible browser automation on Windows. Use when the task is only to open ChatGPT Web, optionally enter a specific Project, optionally attach files through the visible menu, choose a supported mode, and submit the prompt. Do not use when the task requires reading replies, scraping responses, calling unofficial APIs, automating login, extracting cookies/tokens/session data, or interacting with hidden/internal endpoints.
---

# chatgpt-web-submit

Use this skill only for **prompt submission** in a local, already logged-in browser session.

## Core Boundary

This skill **submits** a prepared prompt to ChatGPT Web in a local logged-in browser.

It does **not**:
- read the assistant response
- scrape page output
- call unofficial APIs or internal endpoints
- automate login
- export or inspect cookies, tokens, or browser session storage

## Use This Skill When

- You already have a local logged-in browser session.
- You want to submit a prompt into ChatGPT Web.
- You may need to enter a specific ChatGPT Project first.
- You may need to attach files through the visible attachment/tools menu.
- You need a submission receipt JSON instead of model output.

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
- `references/known-limitations.md` for current boundaries and expected UI drift

## Execution Notes

- Prefer `submit-chatgpt` / `npm run submit -- ...` through the host adapter.
- Return the submission receipt JSON only.
- If login is missing, wait for manual login through the visible browser UI.
- Preserve screenshots/logs in runtime artifacts, not in the bundle.
