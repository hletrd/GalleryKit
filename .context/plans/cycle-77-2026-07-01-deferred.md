# Cycle 77/100 Deferred Findings

Start HEAD: `8aefc3659fa8b6c08bff0da62d29b9ceb40029c5`.
Review aggregate: `.context/reviews/cycle-77-2026-07-01/_aggregate.md`.

## Newly Deferred

### C77-ARCH-01 - Restore maintenance does not fence in-flight non-upload admin mutations

- Severity: High
- Confidence: High
- Source: `.context/reviews/cycle-77-2026-07-01/architect-debugger-tracer.md`
- Reason deferred: the safe fix crosses the mutating admin action contract. It needs a whole-action foreground mutation lease or an equivalent DB-backed protocol that restore can close and drain before writing the durable marker. A partial second maintenance check in the cited example actions would leave the core time-of-check/time-of-use race open and create false closure.
- Exit criterion: introduce a shared foreground admin mutation barrier used by every application-table writer that can run during restore, make restore close and drain that barrier before durable maintenance/import, and add a concurrency regression where an action passes the initial entry check but cannot write after restore starts.

## Carry-Forward Deferred

- `C76-04`: bottom-sheet dropdown portal coverage is source-shaped only. Exit criterion remains a DOM/runtime test proving dropdown content stays inside the dialog subtree or a shared portal helper with equivalent runtime coverage.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift. Exit criterion remains behavior coverage that fails if pending photos are filtered out by a processed predicate.
- `C75-08`: bulk-edit validation alert association remains deferred with its original accessibility exit criterion.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.
