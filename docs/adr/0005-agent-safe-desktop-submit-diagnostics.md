# ADR 0005: Agent-safe Desktop Submit Diagnostics and Bounded Retry

- Status: Accepted
- Date: 2026-03-27

## Context

The desktop Pro handoff path had become good enough to avoid false positives, but it was still expensive for agents to diagnose why a run failed:

- receipt fields were too thin
- submit logs, worker logs, and screenshots were scattered
- the default Pro submit policy still leaned on click-first behavior
- visible-paste cases could stop before an `Enter` submit attempt even though a human operator saw text in the composer

Because the skill is mainly used by other agents, the runtime needs to optimize for:

- reproducible failure diagnosis from one artifact bundle
- a safe default submit policy
- bounded self-healing instead of unbounded retries

## Decision

Adopt an agent-safe desktop submit contract.

1. `submit-pro-chatgpt` defaults to `--submit-method enter`.
2. Every desktop run creates a canonical artifact bundle under `artifacts/runs/<timestamp>-<runId>/`.
3. Receipts include run-scoped diagnostics such as:
   - `runId`
   - `artifactDir`
   - `submitAttempted`
   - `submitAttemptMethod`
   - `attemptCount`
   - `failureClass`
   - `failureReason`
   - `finalAction`
4. Failures may persist a replay-oriented `failed-prompt.txt`, but prompt text is not inlined into logs or receipts.
5. Worker/client logs carry `automationContext` and redact raw clipboard or prompt text to hashes and lengths.
6. The desktop submit path is allowed one bounded self-heal retry when:
   - the failure happened before a confirmed submit attempt, and
   - the visible composer/surface still suggests a safe submit may be possible.
7. Success criteria remain strict. A retry may help reach submit, but it does not weaken strict post-submit proof.

## Consequences

- Agents can inspect `summary.json` first and usually classify the failure without cross-reading multiple JSONL files.
- The Pro path is biased toward `Enter` as the safest cross-machine submit primitive.
- The runtime remains fail-closed after one retry, reducing duplicate-submit risk.
- Aggregate logs remain useful for compatibility, but run bundles are now the canonical diagnostic surface.
- The repository still does not add reply scraping, login automation, cookie extraction, or unofficial API usage.
