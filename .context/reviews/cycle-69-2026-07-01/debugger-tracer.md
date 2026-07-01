# Cycle 69 Debugger / Tracer Review

Start HEAD: `87e2b98db76e90985299e37ad90cf2faad12c5c4`.

## Inventory

- Required context: `AGENTS.md`, `CLAUDE.md`, latest aggregate/deferred files.
- Traced upload processing, image queue side effects, semantic search/similar route model-version reads, embedding storage, and bootstrap missing-active-embedding retry.

## Findings

### DBG69-01 - Post-upload embeddings can use stale upload-time semantic mode

- Severity/confidence: Medium / Medium.
- File/line: `apps/web/src/lib/image-queue.ts:753`, `apps/web/src/lib/image-queue.ts:766`, `apps/web/drizzle/0012_image_embeddings.sql:10`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/similar/[id]/route.ts:135`.
- Evidence: normal upload jobs carry an upload-time `semanticSearchMode` snapshot. After the image is processed, the embedding side effect prefers that snapshot and writes a single-row `image_embeddings` record keyed by `image_id`. Semantic and similar routes only read rows matching the active model version.
- Failure scenario: an image is uploaded while semantic mode is `stub` or `disabled`, then the operator enables production mode before processing finishes. The queued side effect can skip production embedding or write a stale stub row after production is active. Because the table has one row per image, that stale write can hide the image from production semantic results until bootstrap/backfill repairs it.
- Fix direction: resolve the current runtime-gated semantic mode immediately before the post-processing embedding write. Keep processing-byte settings snapshotted; only semantic embedding mode should be current-state based.
