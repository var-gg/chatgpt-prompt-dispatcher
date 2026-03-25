# ADR 0002: Repository, Install Layer, and Runtime State Separation

- Status: Accepted
- Date: 2026-03-25

## Context

This project is designed as a single runtime skill repository. The repository root is the source of truth for design, code, tests, profiles, adapters, and portable skill packaging assets. The actual installable skill bundle must remain portable and isolated under `skill/` so it can be materialized into host runtimes without dragging along development-only files.

## Decision

Adopt a three-layer model:

1. **Repository = Source of Truth**
   - The repo root owns implementation, documentation, tests, adapters, and packaging logic.
   - Development happens in-place in the repository.
2. **Install Layer = Materialized Copy or Symlink**
   - Host runtimes consume the skill from a materialized copy or symlinked `skill/` directory.
   - The install layer is derived from the repository and is not the canonical editing surface.
3. **Runtime State = Separate**
   - Logs, screenshots, lockfiles, local overrides, and ephemeral automation artifacts stay outside the portable bundle.
   - Runtime state must not be committed into the portable skill package.

## Consequences

- `skill/` is treated as the portable deployment unit.
- Host-specific adapters under `adapters/` remain thin wrappers around core logic.
- Development tooling can evolve at repo root without polluting the install bundle.
- Runtime-specific local state is intentionally excluded from source control and portable packaging.

## Directory Rules

- `src/`: core implementation and shared logic.
- `profiles/`: reusable profile definitions and samples.
- `tests/`: automated and smoke test scaffolding.
- `docs/adr/`: architectural decision records.
- `adapters/openclaw/`: thin OpenClaw-facing adapter layer.
- `adapters/mcp/`: thin MCP-facing adapter layer.
- `skill/`: portable bundle root.
- `skill/references/`: reference docs loaded by skill users when needed.
- `skill/scripts/`: scripts intended to support skill execution and packaging.

## Rejected Alternatives

- Treating the runtime install location as the primary editing surface.
- Mixing runtime state or local browser artifacts into the repository root.
- Embedding host-specific adapter behavior directly into the portable bundle as the source of truth.
