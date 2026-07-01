# Cycle 71 Architecture / Tracing Review

Reviewer: default native subagent (`019f1c0b-e05a-7410-80b9-d957728c1538`)
HEAD: `bf86f7c176ecb1ed542d851bfa0e76e2b9d73cd5`

## Findings

### C71-01 - Sidecar backfills can mutate the DB while durable restore maintenance is active

- Severity/confidence: Medium / High.
- File/line:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:508-539`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:731-746`
  - `apps/web/scripts/backfill-clip-embeddings.ts:115-123`, `:160-214`
  - `apps/web/scripts/backfill-color-pipeline.ts:335-352`, `:365-371`, `:437-473`
- Evidence: failed restore import or post-restore migration returns `keepMaintenance: true`, so `db-actions.ts` keeps the durable marker active. The same `finally` still releases the restore/color/semantic advisory locks. The CLIP and color sidecar scripts only honor their advisory locks and never check the durable marker.
- Failure scenario: a restore fails after partial DB mutation and intentionally freezes the web app with durable maintenance. An operator or scheduled sidecar then starts a backfill, acquires its advisory lock after restore released it, selects rows, and writes embeddings or color pipeline columns into the partial database.
- Suggested fix: add a script-safe durable restore-maintenance assertion to both sidecars before lock acquisition, after lock acquisition, and before batch writes/upserts. Fail closed when the marker cannot be read.
