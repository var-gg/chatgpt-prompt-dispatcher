# MCP adapter

This adapter describes the same transport boundary for MCP-style use.

## Primary transport

- `submit-chatgpt` → Windows desktop input dispatcher backed by a visible ChatGPT window

## Compatibility transport

- `submit-browser-chatgpt` → retained experimental Playwright path
- `submit-chatgpt --transport=browser` → explicit browser override

## Boundary

- submit prepared prompts only
- return receipt JSON only
- do not read or scrape assistant responses
