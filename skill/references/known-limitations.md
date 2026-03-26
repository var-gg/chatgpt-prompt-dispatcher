# Known Limitations

- The skill submits prompts only. It does not read, scrape, or summarize ChatGPT responses.
- Login is manual-only.
- The desktop-native path currently supports only `auto` and `pro` mode selection.
- The desktop-native path does not support project entry or attachments.
- `submit-pro-chatgpt` always opens a fresh chat and always targets Pro.
- The strict Pro path requires at least one visible, already logged-in ChatGPT browser window as the seed session before it can open a dedicated fresh window with `Ctrl+N`.
- The strict Pro path is intentionally slower than the legacy optimistic path because it waits for a new conversation proof and captures a target-window screenshot before returning `submitted: true`.
- If no verified ChatGPT tab/window is visible, the desktop path now fails fast instead of hijacking an arbitrary Chrome/Edge window.
- ChatGPT UI labels drift over time; profile updates and calibration refreshes are expected.
- If prompt insertion falls back to coordinates and later fails validation, treat it as desktop drift first: inspect or recalibrate `promptInput` before changing transports.
- Strict proof first tries the omnibox path and then falls back to OCR on the captured target-window screenshot. If neither path can prove a fresh `https://chatgpt.com/c/<id>` URL, the run fails even if submit UI evidence appeared.
- Live smoke and forward-testing are local/operator-driven. They are not a license to relax the no-scraping boundary.
