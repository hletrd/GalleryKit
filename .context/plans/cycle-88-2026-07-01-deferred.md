# Cycle 88/100 Deferred Findings

Start HEAD: `afc2bf5245932fd421d84e8d29ca2e0be01280fb`.
Review aggregate: `.context/reviews/cycle-88-2026-07-01/_aggregate.md`.

## Newly Deferred

### C88-03 - Semantic embeddings are model-version filtered but stored as one row per image

- Original severity: Medium.
- Original confidence: High.
- Citation: `apps/web/src/db/schema.ts:284`, `apps/web/src/lib/image-queue.ts:379`, `apps/web/src/app/api/search/semantic/route.ts:263`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/scripts/backfill-clip-embeddings.ts:27`.
- Deferral reason: The current cycle is constrained to safe, narrow fixes. The user instruction for Cycle 88 explicitly says, "Implement only safe, narrow fixes" and "Do not invent broad refactors or new dependencies." A correct fix for this finding requires a dedicated schema/data migration across Drizzle schema, SQL migration, legacy reconcile, writer upserts, search lookups, and production backfill behavior. This is a product/performance coverage issue, not a security finding or data-loss finding.
- Exit criterion: Reopen when a dedicated semantic-embedding schema migration is in scope. The implementation must store one row per `(image_id, model_version)`, preserve efficient `model_version` scans and target image lookups, update Drizzle/reconcile/migration journal state, and add regression tests covering stub/production mode switches without overwriting the other model version's embedding.

## Scheduled Instead Of Deferred

- `C88-01` is scheduled in `.context/plans/cycle-88-2026-07-01-plan.md`.
- `C88-02` is scheduled in `.context/plans/cycle-88-2026-07-01-plan.md`.

## Carry-Forward Deferred

- `C80-06`: `site-config.json` runtime/build-time contract is ambiguous. Exit criterion remains a dedicated operator-contract decision: either implement a validated runtime loader and pass client-safe values explicitly, or document/remove the runtime mount and state that `site-config.json` edits require rebuild/deploy. Update `CLAUDE.md`, `apps/web/README.md`, `apps/web/docker-compose.yml`, code imports, and tests together.
- `C77-ARCH-01`: restore maintenance does not fence in-flight non-upload admin mutations. Exit criterion remains a shared foreground admin mutation barrier used by every application-table writer that can run during restore, with restore closing/draining that barrier before durable maintenance/import and concurrency regression coverage.
- `C76-04`: bottom-sheet dropdown portal coverage is source-shaped only. Exit criterion remains a DOM/runtime test proving dropdown content stays inside the dialog subtree or a shared portal helper with equivalent runtime coverage.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift. Exit criterion remains behavior coverage that fails if pending photos are filtered out by a processed predicate.
- `C75-08`: bulk-edit validation alert association remains deferred with its original accessibility exit criterion.
- Historical performance, semantic-search, settings re-encode, shared-view, browser-matrix, and broad e2e expansion items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.
