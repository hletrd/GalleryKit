# Cycle 85/100 Deferred Findings

Start HEAD: `1d29b98861098a68a8107746997a5d81d70f03f1`.
Review aggregate: `.context/reviews/cycle-85-2026-07-01/_aggregate.md`.

## Newly Deferred

None.

## Carry-Forward Deferred

- `C80-06`: `site-config.json` runtime/build-time contract is ambiguous. Exit criterion remains a dedicated operator-contract decision: either implement a validated runtime loader and pass client-safe values explicitly, or document/remove the runtime mount and state that `site-config.json` edits require rebuild/deploy. Update `CLAUDE.md`, `apps/web/README.md`, `apps/web/docker-compose.yml`, code imports, and tests together.
- `C77-ARCH-01`: restore maintenance does not fence in-flight non-upload admin mutations. Exit criterion remains a shared foreground admin mutation barrier used by every application-table writer that can run during restore, with restore closing/draining that barrier before durable maintenance/import and concurrency regression coverage.
- `C76-04`: bottom-sheet dropdown portal coverage is source-shaped only. Exit criterion remains a DOM/runtime test proving dropdown content stays inside the dialog subtree or a shared portal helper with equivalent runtime coverage.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift. Exit criterion remains behavior coverage that fails if pending photos are filtered out by a processed predicate.
- `C75-08`: bulk-edit validation alert association remains deferred with its original accessibility exit criterion.
- Historical performance, semantic-search, settings re-encode, shared-view, browser-matrix, and broad e2e expansion items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.
