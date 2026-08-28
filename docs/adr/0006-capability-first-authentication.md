# ADR 0006: Capability-first Authentication

- Status: Accepted
- Date: 2026-08-29

## Context

The original boundary prohibited all login automation. That blanket rule caused an otherwise
authorized prompt-dispatch task to stop whenever a session expired, even when the official login
UI, an existing account session, password-manager autofill, or an authorized paired device could
complete the flow safely.

Authentication is not the same action as prompt submission, account recovery, or secret export.
The project needs to preserve those boundaries without treating every login screen as a mandatory
human handoff.

## Decision

Adopt capability-first authentication for the visible ChatGPT UI.

1. Reuse the dedicated authenticated session first.
2. If signed out, continue the provider's official visible login with available authorized
   browser, password-manager/autofill, or paired-device automation.
3. Keep credentials, OTP values, QR payloads, cookies, and session tokens out of receipts, logs,
   screenshots, command output, and persisted artifacts.
4. Hand off only a provider- or OS-enforced CAPTCHA, biometric, physical security-key, secure
   keyguard, or similarly unavoidable user-presence step. Resume the same run afterwards.
5. Do not guess an account, extract unknown credentials, bypass authentication, call unofficial
   endpoints, or start password reset/account recovery without separate authorization.
6. Successful authentication does not expand the authorized downstream action. Prompt submission
   and its strict proof remain governed by the existing submit contract.

## Consequences

- Session expiry is a recoverable execution state instead of a mandatory manual stop.
- The runtime remains inside documented, user-visible UI automation boundaries.
- `auth-recovery-required` describes a missing prompt surface without presuming that only a human
  can resolve it.
- Provider-enforced human presence remains a narrow, resumable handoff rather than a whole-task
  transfer.
