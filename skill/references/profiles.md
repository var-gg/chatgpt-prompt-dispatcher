# Profiles and Calibration

Profiles under `profiles/*.json` define the reusable UI candidate sets.

## Recommended Naming

Use:
- `<locale>.<platform>.<tier>.json`

Examples:
- `ko-KR.windows.pro.json`
- `ko-KR.windows.plus.json`

## What UI Profiles Must Define

Each profile should include:
- browser metadata
- ChatGPT tier metadata
- new chat candidates
- prompt box candidates
- submit button candidates
- mode menu entry candidates
- mode option candidates

Keep candidate order stable:
1. role candidates
2. labels
3. visible text
4. placeholders
5. selectors

Desktop runtime reuses the same profile data for `new chat` and `Pro` mode selection where possible.
The strict Pro path additionally depends on a stable composer candidate so it can prove that the dedicated fresh window is on ChatGPT home before submit.

## Desktop Calibration

Calibration profiles live under `profiles/desktop/*.chatgpt.json`.

For Pro handoff, these anchors matter:
- `promptInput`
- `submitButton`
- `newChatButton`
- `modeButton`

Notes:
- `promptInput` and `modeButton` are the most important anchors for the strict default Pro path.
- `newChatButton` still matters for same-window flows and fallback recovery, but a healthy dedicated fresh window can already satisfy the strict Pro fresh-surface contract before submit.
- If strict receipts fail to capture proof, inspect whether the target window still reaches ChatGPT home and whether the final conversation URL changes to `/c/<id>`.

Refresh calibration with:

```bash
npm run calibrate-desktop -- --calibration-profile default --window-title "ChatGPT"
```

If `newChatButton` or `modeButton` drifts, recalibrate before editing fallback logic.
