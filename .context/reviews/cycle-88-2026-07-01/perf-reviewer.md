# Cycle 88 Performance Reviewer

Start HEAD: `afc2bf5245932fd421d84e8d29ca2e0be01280fb`.

## Inventory

Examined image queue, uploads, analytics buffering, semantic/similar search, CLIP embedding scripts, schema, migration history, and relevant tests.

## Findings

### C88-03 - Semantic embeddings are model-version filtered but stored as one row per image

- Severity: Medium.
- Confidence: High.
- Citations: `apps/web/src/db/schema.ts:284`, `apps/web/src/lib/image-queue.ts:379`, `apps/web/src/app/api/search/semantic/route.ts:263`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/scripts/backfill-clip-embeddings.ts:27`.
- Problem: `image_embeddings` is keyed by image id, while writers upsert both `embedding` and `model_version`; readers then filter by `model_version`. Switching between production and stub modes can overwrite the other mode's row and cause partial semantic/similar search coverage until embeddings are regenerated.
- Failure scenario: Production embeddings exist, semantic mode flips to stub for testing, later uploads/backfill overwrite rows with stub embeddings, and switching back to production makes those images disappear from production semantic search until reprocessed.
- Suggested fix: Dedicated migration and schema/update path to store one row per `(image_id, model_version)`, preserving scan and target-embedding lookup performance.

This is a real issue but not a safe narrow Cycle 88 fix because it requires schema migration, reconcile changes, writer/read query changes, and production-data migration planning.
