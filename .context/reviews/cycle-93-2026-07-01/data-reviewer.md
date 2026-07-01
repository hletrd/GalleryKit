# Cycle 93 Data/Runtime Review

Scope: current deployed `master` at `2571d8a8c27e2d2a7bc95ed5e6a72e26487093dc`.

## Confirmed Findings

### C93-12 / C88-03 - `image_embeddings` storage cannot retain multiple model versions per image

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/db/schema.ts:284`, `apps/web/drizzle/0012_image_embeddings.sql:10`, `apps/web/src/app/api/search/semantic/route.ts:274`, `apps/web/src/app/api/search/similar/[id]/route.ts:139`, `apps/web/src/lib/image-queue.ts:379`, `apps/web/scripts/backfill-clip-embeddings.ts:212`.
- Problem: active code treats `model_version` as an isolation dimension, but storage uses `image_id` as the sole primary key and writers upsert on `image_id`.
- Failure scenario: a stub embedding row exists, then a production backfill overwrites the same row. Switching modes or model versions destroys the inactive row, so model-version-isolated reads cannot preserve parallel versions.
- Suggested fix: add a migration for one row per `(image_id, model_version)`, update Drizzle schema/reconcile/upsert conflict targets, and add a regression proving writing a second model version preserves the first.

### C93-13 / C77-ARCH-01 - Restore maintenance does not fence already-in-flight non-upload admin mutations

- Severity / confidence: High / High.
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/actions/settings.ts:43`, `apps/web/src/app/actions/settings.ts:164`, `apps/web/src/app/actions/topics.ts:184`, `apps/web/src/app/actions/topics.ts:256`, `apps/web/src/app/actions/tags.ts:44`.
- Problem: restore maintenance starts inside `restoreDatabase`, but ordinary admin mutations only check maintenance at entry and can continue to later DB writes after restore begins.
- Failure scenario: an admin settings/topic/tag action passes its entry check, restore starts and imports SQL, then the in-flight action writes during or just before import. The user receives a success response for data that may be overwritten by restore or race DDL/data replacement.
- Suggested fix: introduce a shared foreground admin-write barrier acquired by restore and by every mutating admin action around the actual DB write section, with representative tests.
