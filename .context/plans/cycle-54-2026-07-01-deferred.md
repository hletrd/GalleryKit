# Cycle 54/100 Deferred Findings

No new Cycle 54 findings are deferred. Both deduplicated Cycle 54 findings are scheduled in `.context/plans/cycle-54-2026-07-01-plan.md`.

## Carry-forward Deferred Items

- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps. Exit criterion: schedule a design-backed change that defines production web bootstrap policy, includes tests/source contracts proving it cannot run concurrent bulk CLIP work beside the sidecar/restore lock, and preserves recent-upload embedding recovery behavior.
- `TV-40-03` - JavaScript operational scripts need semantic checking. Exit criterion: migrate the operational script check to semantic `checkJs` or equivalent without masking existing script type errors.
- `PERF-C39-03` - feed and sitemap updated-time indexes. Exit criterion: migration-shaped plan with EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - backfill pipeline-version indexes. Exit criterion: migration-shaped plan with query-plan evidence and write-path impact review.
- `AGG-C38-07` - broad imported-helper side-effect classification. Exit criterion: scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - sidecar keyset pagination. Exit criterion: throughput/memory plan defines keyset cursor semantics and regression coverage.
