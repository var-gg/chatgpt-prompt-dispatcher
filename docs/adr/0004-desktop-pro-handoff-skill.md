# ADR 0004: Desktop-native Pro Handoff Skill and Self-hosted Forward-testing

- Status: Accepted
- Date: 2026-03-26

## Context

The repository already provided a desktop-first prompt submitter, but the main operator workflow is narrower and more opinionated:

- use a visible local ChatGPT session on Windows
- open a fresh chat
- switch to `Pro`
- submit a stronger final prompt without reading the reply

The skill must also stay portable so another agent can install the repo, register the skill, and reuse the same behavior without OpenClaw core changes.

## Decision

Adopt a dedicated **desktop Pro handoff** path.

1. Add `submit-pro-chatgpt` as a first-class CLI command.
2. Keep `submit-chatgpt` as the generic desktop-first entrypoint.
3. Make the Pro handoff path always:
   - use the desktop transport
   - start a fresh chat
   - target `Pro`
   - submit immediately unless explicitly told not to
4. Reuse browser UI profile candidates plus desktop calibration anchors for `new chat` and `Pro` mode selection.
5. Keep OpenClaw integration repo-local and model-invoked instead of introducing a new OpenClaw core dispatch hook.
6. Treat self-hosted forward-testing as part of the product:
   - validate the skill on rough natural-language requests
   - validate the skill on explicit prompt handoff requests
   - feed usability issues back into SKILL text, wrappers, and docs

## Consequences

- The skill now optimizes for a specific high-reasoning handoff workflow instead of being only a generic prompt submitter.
- The desktop path still does not expand into response scraping, login automation, project handling, or attachment support.
- `modeResolved` now represents the actual requested mode (`auto` or `pro`) instead of a transport label.
- Skill packaging must preserve `agents/openai.yaml` and the dedicated `submit-pro` wrapper.
