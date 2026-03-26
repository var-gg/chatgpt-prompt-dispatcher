# Desktop-first transport architecture

## Goal

Make the repository desktop-first without changing the external receipt contract.

Primary rule set:
1. `submit-chatgpt` uses the Windows desktop dispatcher by default.
2. The Playwright path remains available, but only as `submit-browser-chatgpt` or `--transport=browser`.
3. Receipt JSON remains the only result contract.
4. Response reading, scraping, transcript capture, and assistant-output extraction remain out of scope.

## Transport model

### Default transport: desktop

Default command:
- `submit-chatgpt`

Explicit alias:
- `submit-desktop-chatgpt`

Dedicated Pro shortcut:
- `submit-pro-chatgpt`

Implementation:
- `src/submit-chatgpt.js` routes to desktop unless `--transport=browser` is present.
- `src/desktop/submit-desktop-chatgpt.js` performs the Windows input dispatch.
- `src/desktop/worker-client.js` keeps a persistent PowerShell desktop worker alive over stdio.

Current desktop scope:
- focus a visible ChatGPT window
- resize toward calibrated bounds
- optionally open a fresh chat
- optionally switch to `Pro`
- click calibrated prompt anchor
- paste prepared prompt
- optionally submit via click or Enter
- return receipt JSON only

Current desktop non-goals:
- project entry
- attachment upload
- desktop `thinking` / deep-research style mode selection beyond `Pro`
- response scraping or reading

If a caller requests unsupported browser-only features, desktop returns an argument failure and points the caller to the experimental browser transport.

### Experimental transport: browser

Explicit command:
- `submit-browser-chatgpt`

Explicit override:
- `submit-chatgpt --transport=browser`

Implementation:
- `src/submit-browser-chatgpt.js`
- `src/playwright-runtime.js`

Status:
- retained for compatibility and feature coverage
- documented as experimental / non-primary
- not removed yet

## Why this split

The repository is no longer centered on visible browser automation as the primary abstraction.
It is centered on a **Windows desktop input dispatcher** for a visible local ChatGPT session.

Playwright remains only because:
- it still covers project entry / attachments / browser-side mode selection
- it helps preserve compatibility during the transition
- it remains useful as a fallback while the desktop dispatcher matures

## Contract boundary

All transports must continue to:
- accept a prepared prompt input
- submit or dry-run locally
- emit receipt JSON
- avoid reading assistant output
- avoid hidden APIs and session extraction

Transport implementations may differ internally, but they must not expand the boundary into response collection.

## Documentation policy

Repository documentation should describe the project as:
- Windows desktop input dispatcher backed
- local-only
- ChatGPT submission only
- receipt-returning
- no response reading

Browser transport references should be marked as:
- experimental
- compatibility path
- non-primary
