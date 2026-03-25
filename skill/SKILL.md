---
name: chatgpt-web-submit
description: Submit prepared prompts into a locally logged-in ChatGPT web session on Windows through a desktop-backed runtime with a persistent PowerShell worker and calibrated/UIA-guided controls. Use when the task is only to submit a prepared prompt and receive a receipt JSON. Use the retained browser transport only when project entry, attachments, or browser-side mode selection are still required. Do not use when the task requires reading replies, scraping responses, calling unofficial APIs, automating login, extracting cookies/tokens/session data, or interacting with hidden/internal endpoints.
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

## Prerequisites

- unlocked local Windows desktop session
- same user session for runtime + Chrome/Edge window
- non-elevated browser + non-elevated dispatcher runtime
- clipboard save/restore available
- no response scraping
- screenshot only on failure if explicitly added by a caller workflow

## Use This Skill When

- You already have a local logged-in ChatGPT session.
- You want desktop-first prompt submission on Windows.
- You need a submission receipt JSON instead of model output.
- You can recalibrate or inspect the desktop flow when UI drift happens.

## Runtime Model

- repository root = source of truth during development
- packaged bundle = self-contained installable runtime
- runtime state = separate, outside the portable bundle

## References

Read as needed:
- `references/install.md` for packaging/install/materialization
- `references/profiles.md` for adding locale/platform/tier profiles
- `references/known-limitations.md` for current boundaries and expected drift

## Execution Notes

- Prefer `submit-chatgpt` / `npm run submit -- ...`.
- Treat `submit-browser-chatgpt` / `--transport=browser` as experimental compatibility paths.
- Desktop submit is optimized for practical prompt paste+submit attempts: once a credible ChatGPT composer target is reached, it proceeds even if visible send-state proof is degraded, while still rejecting obviously wrong/omnibox targets.
- Use `inspect-desktop-chatgpt` and `calibrate-desktop-chatgpt` before reaching for browser fallback when the desktop UI drifts.
- Return the submission receipt JSON only.
