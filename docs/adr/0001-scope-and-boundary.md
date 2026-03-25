# ADR 0001: Scope and Boundary

- Status: Accepted
- Date: 2026-03-25

## Context

The project goal is an OSS MVP that dispatches prompts into a locally logged-in ChatGPT web session on Windows. The tool must stay inside visible browser automation boundaries and avoid hidden or unsupported integration paths.

## In Scope

- Launch or attach to a local browser automation flow for ChatGPT web usage.
- When no project is specified, start from a new chat flow and submit the prompt.
- When a project is specified, navigate into that ChatGPT Project and submit the prompt there.
- Handle attachment-menu interaction as part of the visible UI flow.
- Optimize first for Korean Windows environments and ChatGPT Pro UI, with Plus fallback considerations.
- Build the project as a public OSS repository with Node.js as the initial implementation base.

## Out of Scope

- Reading, scraping, or structuring ChatGPT responses.
- Calling unofficial APIs, private endpoints, or reverse-engineered internal interfaces.
- Automating authentication or bypassing login steps.
- Extracting, backing up, exporting, or reusing cookies, tokens, or account/session secrets.
- Background account automation outside the visible browser UI.

## Risk Boundaries

- The implementation must only automate actions a human could visibly perform in the logged-in browser session.
- Browser selectors and flows may drift across UI variants; the project should prefer resilient selectors and document UI assumptions.
- Project navigation and attachment flows are explicitly allowed, but only through standard visible UI interaction.
- Security-sensitive session data must not be read from browser storage or exported from the machine.

## Consequences

- The MVP is intentionally narrow: prompt dispatch only.
- The implementation will likely use browser automation adapters rather than direct HTTP integrations.
- Future features must be rejected if they cross into response scraping or hidden-session handling.
