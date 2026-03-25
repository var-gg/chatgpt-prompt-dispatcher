# Adding Profiles

Profiles live under `profiles/` in the repository source of truth.

## Recommended Naming

Use:

- `<locale>.<platform>.<tier>.json`

Examples:
- `ko-KR.windows.pro.json`
- `ko-KR.windows.plus.json`

## What to Define

Each profile should include:
- browser metadata
- ChatGPT tier metadata
- project navigation candidates
- new chat candidates
- prompt box candidates
- submit button candidates
- mode menu and mode option candidates
- tools/attachment menu candidates

## Resolution Strategy

Keep candidate order stable:
1. accessibility labels
2. visible text
3. fallback selectors

Add new labels/selectors as additional ordered candidates instead of replacing older ones immediately when possible.
