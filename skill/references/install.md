# Install and Packaging

## Portable Bundle

The portable bundle is the `skill/` directory plus its runtime-facing adapter metadata produced by `npm run pack-skill`.

## Package Command

```bash
npm run pack-skill
```

This creates a shareable bundle under `dist/skill-bundle/` and a zip archive under `dist/`.

## Local Install Command

```bash
npm run install-local -- --target <path> --mode symlink
npm run install-local -- --target <path> --mode copy
```

Defaults:
- target: `~/.openclaw/skills/chatgpt-web-submit`
- mode: `symlink`

## Runtime Commands After Install

Primary:
- `submit-chatgpt` → desktop-first transport

Compatibility / experimental:
- `submit-browser-chatgpt`
- `submit-chatgpt --transport=browser`

## Install Lock

`skill.install.lock.json` records:
- bundle version
- source commit SHA
- selected profile
- installed path
- install mode
- installed timestamp

Treat it as an install-state record, not a runtime transcript.
