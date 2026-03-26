---
name: chatgpt-web-submit
description: Desktop-native ChatGPT Pro handoff on Windows for sending a strong final prompt into a visible, already logged-in ChatGPT session. Use when the user asks to send something to ChatGPT Pro, asks for a stronger high-reasoning prompt and wants it executed, or says things like "이거 Pro로 보내", "고급추론용 프롬프트 탄탄하게 만들어서 실행", or "이 프롬프트를 ChatGPT Pro로 전달해줘". Do not use when the task requires reading replies, scraping responses, automating login, extracting cookies/session data, or calling unofficial APIs.
user-invocable: true
metadata: {"openclaw":{"os":["win32"],"requires":{"bins":["node"]}}}
---

# chatgpt-web-submit

Use this skill only for **submitting** a prompt into a local Windows ChatGPT desktop session.

## Boundary

Do:
- build a stronger final prompt when the user gives rough intent
- preserve the user's explicit prompt verbatim when they already wrote it
- send the prompt into a fresh ChatGPT Pro chat
- return the submission receipt JSON

Do not:
- read or summarize ChatGPT's reply
- scrape transcript content
- automate login
- inspect or export browser storage, cookies, or tokens
- switch to hidden APIs or internal endpoints

## Default Behavior

- Assume the target is **ChatGPT Pro**
- Assume the flow should **always open a fresh chat**
- Assume the flow should **submit immediately**
- Use the desktop-backed runtime, not the experimental browser transport, unless you are diagnosing a desktop-only failure

## Execution Workflow

1. Decide whether the user gave:
   - a rough request that needs a stronger final prompt
   - an explicit prompt that should be sent as-is
2. Produce the final prompt text.
3. Write the final prompt to a UTF-8 temp file instead of stuffing long text into the command line.
4. Run:

```bash
node {baseDir}/scripts/submit-pro.js --prompt-file <temp-file>
```

5. Pass through optional runtime flags when needed:
   - `--calibration-profile <name>`
   - `--window-title "ChatGPT"`
   - `--dry-run`
   - `--no-submit`
6. Return only the receipt JSON unless the user explicitly asks to also show the prompt that was sent.

## Prompt Construction

- Keep the user's actual goal, constraints, and desired deliverable intact.
- Remove chatty filler from the user's rough request.
- Make the final prompt concrete and execution-oriented.
- Include context the remote ChatGPT Pro run needs, but do not include local machine details unless they matter to the task itself.
- If the user already gave a final prompt, prefer preserving it over rewriting aggressively.

## Failure Recovery

When the desktop flow fails, inspect or recalibrate before changing transports:

```bash
node {baseDir}/runtime/src/index.js inspect-desktop-chatgpt --calibration-profile default
node {baseDir}/runtime/src/index.js calibrate-desktop-chatgpt --calibration-profile default --window-title "ChatGPT"
```

If the issue is clearly desktop drift, update calibration first. If the issue is a missing Pro/new-chat candidate, update the repo profile or desktop helper rather than weakening the boundary.

## References

Read as needed:
- `references/install.md` for install, bundle, and forward-testing steps
- `references/profiles.md` for UI profile and calibration expectations
- `references/known-limitations.md` for current scope and non-goals
