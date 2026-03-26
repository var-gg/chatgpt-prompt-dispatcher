# Install and Forward-testing

## Repo URL Only Quickstart

If another agent only has the repository URL and needs to make the skill usable on the local machine, prefer this exact sequence from the repo root:

```bash
git clone https://github.com/var-gg/chatgpt-prompt-dispatcher.git
cd chatgpt-prompt-dispatcher
npm install
npm run register-openclaw
node ~/.openclaw/skills/chatgpt-web-submit/scripts/submit-pro.js --prompt "desktop install dry-run" --dry-run --window-title "ChatGPT"
```

This is the canonical bootstrap path because `register-openclaw`:
- builds the bundle if it does not exist yet
- copies the materialized skill into `~/.openclaw/skills/chatgpt-web-submit`
- installs runtime dependencies in the installed skill root
- avoids changing OpenClaw core code

Use `install-local` directly only when you need a non-default target path or a symlink install mode.

## Portable Bundle

The portable bundle is the `skill/` directory plus the packaged runtime copied by `npm run pack-skill`.

Bundle contents include:
- `SKILL.md`
- `agents/openai.yaml`
- `references/`
- `scripts/`
- `profiles/`
- `adapters/`
- `runtime/`
- `bundle.manifest.json`
- `skill.install.lock.json`

## Build the Bundle

```bash
npm run pack-skill
```

Outputs:
- `dist/skill-bundle/chatgpt-web-submit/`
- `dist/chatgpt-web-submit-bundle.zip`

## Install Locally

From the repo:

```bash
npm install
npm run install-local -- --target ~/.openclaw/skills/chatgpt-web-submit --mode copy
npm run register-openclaw
```

From a packaged bundle:

```bash
node scripts/install-local.js --target ~/.openclaw/skills/chatgpt-web-submit --mode copy
node scripts/register-openclaw.js
```

Default install target:
- `~/.openclaw/skills/chatgpt-web-submit`

## Runtime Commands

Primary commands:
- `submit-pro-chatgpt`
- `submit-chatgpt`
- `submit-desktop-chatgpt`

Installed wrapper:

```bash
node ~/.openclaw/skills/chatgpt-web-submit/scripts/submit-pro.js --prompt-file <prompt-file>
```

`submit-pro.js` defaults to:
- `--mode pro`
- `--new-chat`
- `--surface new-window`
- `--proof-level strict`

Diagnostics:
- `inspect-desktop-chatgpt`
- `calibrate-desktop-chatgpt`

Compatibility path:
- `submit-browser-chatgpt`
- `submit-chatgpt --transport=browser`

## Self-hosted Forward-testing

Use real tasks while keeping the no-response-reading boundary.

Recommended checks:
1. Materialize the skill into a local skill root.
2. Run a dry-run through the installed wrapper:

```bash
node scripts/submit-pro.js --prompt-file <prompt-file> --dry-run
```

3. Run a real submission once calibration is trusted.
4. Validate that the skill wording naturally supports both:
   - rough request -> final prompt synthesis -> submit
   - explicit prompt -> submit as-is
5. On a successful live Pro run, verify that:
   - the receipt contains `targetWindowHandle`, `conversationUrl`, and `screenshotPath`
   - the saved screenshot matches the dedicated live ChatGPT window
   - the successful window is left open for manual inspection

If the skill feels awkward during real use, fix the skill text or wrapper first, then CLI help, then broader docs.
