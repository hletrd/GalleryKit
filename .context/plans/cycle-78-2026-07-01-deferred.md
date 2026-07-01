# Cycle 78/100 Deferred Findings

Start HEAD: `9286bef16f3401fb0d8c17f52de5c96804c04533`.
Review aggregate: `.context/reviews/cycle-78-2026-07-01/_aggregate.md`.

## Newly Deferred

No new Cycle 78 findings are deferred. `C78-01` through `C78-04` are scheduled for this cycle.

## Carry-Forward Deferred

- `C77-ARCH-01`: restore maintenance does not fence in-flight non-upload admin mutations. Exit criterion remains a shared foreground admin mutation barrier used by every application-table writer that can run during restore, with restore closing/draining that barrier before durable maintenance/import and concurrency regression coverage.
- `C76-04`: bottom-sheet dropdown portal coverage is source-shaped only. Exit criterion remains a DOM/runtime test proving dropdown content stays inside the dialog subtree or a shared portal helper with equivalent runtime coverage.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift. Exit criterion remains behavior coverage that fails if pending photos are filtered out by a processed predicate.
- `C75-08`: bulk-edit validation alert association remains deferred with its original accessibility exit criterion.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.
