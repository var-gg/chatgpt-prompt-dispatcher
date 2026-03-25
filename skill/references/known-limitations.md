# Known Limitations

- This skill submits prompts only; it does not read responses.
- ChatGPT UI labels may drift over time; profile updates are expected.
- Login is manual-only. The agent may wait, but must not automate authentication.
- Supported attachment handling is limited to visible menu-based flows.
- Live smoke tests are opt-in via `LIVE_CHATGPT=1`.
- Host wrappers should remain thin and must not reintroduce response scraping or hidden API behavior.
