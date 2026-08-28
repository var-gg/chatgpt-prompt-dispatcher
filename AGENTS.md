# AGENTS.md

## Project Rules

- Treat this repository as an OSS-first automation project.
- Keep all browser work inside documented, user-visible web automation boundaries.
- Official login flows inside the visible UI may use existing sessions, password-manager/autofill,
  and authorized browser/device automation. Do not bypass provider authentication, extract
  cookies/session secrets, call unofficial APIs, or start account recovery without explicit scope.
- Record major architectural decisions under `docs/adr/`.
- Prefer small, reviewable commits.
