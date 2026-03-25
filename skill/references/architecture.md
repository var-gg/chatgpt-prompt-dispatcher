# Architecture Reference

This skill ships as a portable bundle under `skill/` while the repository root remains the full development source of truth.

## Layers

1. Repository source of truth
2. Materialized install layer
3. Runtime state outside the bundle

## Notes

- Host adapters should remain thin.
- Core implementation belongs in `src/`.
- Portable skill content belongs in `skill/`.
