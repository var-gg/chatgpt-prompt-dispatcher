# OpenClaw adapter

This adapter exposes the repo as a desktop-first ChatGPT prompt submission runtime for OpenClaw.

## Primary transport

- `submit-chatgpt` → Windows desktop input dispatcher backed by a visible ChatGPT window

## Compatibility transport

- `submit-browser-chatgpt` → retained experimental Playwright path
- `submit-chatgpt --transport=browser` → explicit browser override

## Boundary

- submit prepared prompts only
- return receipt JSON only
- do not read or scrape assistant responses
