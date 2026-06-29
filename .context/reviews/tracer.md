# Cycle 9 Tracer Review

HEAD reviewed: `2506c5f7`

Mode: read-only causal tracing review. Source code and plans were not edited.

## Scope And Method

Read first, per workspace rule:
- `AGENTS.md`
- `CLAUDE.md`

Required traces covered:
- Upload -> DB -> queue -> processing -> public rendering.
- Restore -> maintenance -> queue.
- Search/tag filters -> data queries -> UI.
- Semantic search -> model -> embeddings -> enrichment.
- Sharing/analytics -> rate limit -> writes.
- Deploy/migration artifacts.

I traced each lane from entry point to durable side effects and then ran a final missed-issue sweep against prior review hypotheses and high-risk keywords. This report distinguishes confirmed issues, likely issues, risks needing manual validation, and false positives/already fixed.

## Inventory

Upload, DB, queue, processing, rendering:
- Browser upload: `apps/web/src/app/actions/images.ts:113-190`, `apps/web/src/app/actions/images.ts:317-425`, `apps/web/src/app/actions/images.ts:480-512`
- Lightroom upload: `apps/web/src/app/api/admin/lr/upload/route.ts:60-115`, `apps/web/src/app/api/admin/lr/upload/route.ts:241-305`, `apps/web/src/app/api/admin/lr/upload/route.ts:374-489`
- Queue snapshot and worker: `apps/web/src/lib/image-queue.ts:90-175`, `apps/web/src/lib/image-queue.ts:392-465`, `apps/web/src/lib/image-queue.ts:525-683`, `apps/web/src/lib/image-queue.ts:814-884`
- Original save/format processing: `apps/web/src/lib/process-image.ts:844-994`, `apps/web/src/lib/process-image.ts:1002-1120`
- Public render/query: `apps/web/src/lib/data.ts:618-646`, `apps/web/src/lib/data.ts:784-811`, `apps/web/src/components/home-client.tsx:286-421`

Restore, maintenance, queue:
- Restore lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts:266-386`
- Dump scan/import: `apps/web/src/app/[locale]/admin/db-actions.ts:468-584`
- SQL scanner: `apps/web/src/lib/sql-restore-scan.ts:39-155`
- Queue quiesce/resume: `apps/web/src/lib/image-queue.ts:966-1019`

Search/tag filters:
- Public pages: `apps/web/src/app/[locale]/(public)/page.tsx:149-222`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:134-215`
- Tag UI: `apps/web/src/components/tag-filter.tsx:10-120`, `apps/web/src/components/home-client.tsx:243-273`, `apps/web/src/components/home-client.tsx:412-421`
- Public actions and data: `apps/web/src/app/actions/public.ts:113-310`, `apps/web/src/lib/data.ts:1481-1632`
- Search UI: `apps/web/src/components/search.tsx:154-253`

Semantic search and embeddings:
- Semantic route: `apps/web/src/app/api/search/semantic/route.ts:156-330`
- Similar route: `apps/web/src/app/api/search/similar/[id]/route.ts:97-215`
- Embedding helpers/caps: `apps/web/src/lib/clip-embeddings.ts:22-44`, `apps/web/src/lib/clip-embeddings.ts:116-172`
- Real model loader: `apps/web/src/lib/clip-model.ts:53-71`, `apps/web/src/lib/clip-model.ts:98-128`, `apps/web/src/lib/clip-model.ts:171-223`
- Queue embedding write: `apps/web/src/lib/image-queue.ts:600-683`
- Sidecar backfill: `apps/web/scripts/backfill-clip-embeddings.ts:1-60`, `apps/web/scripts/backfill-clip-embeddings.ts:113-196`
- In-app embedding action: `apps/web/src/app/actions/embeddings.ts:55-180`

Sharing, analytics, rate limits:
- Share writes: `apps/web/src/app/actions/sharing.ts:22-82`, `apps/web/src/app/actions/sharing.ts:84-183`, `apps/web/src/app/actions/sharing.ts:185-304`
- Analytics writes: `apps/web/src/app/actions/public.ts:319-414`
- Analytics reads/index use: `apps/web/src/lib/analytics-data.ts:28-86`, `apps/web/src/lib/analytics-data.ts:93-112`, `apps/web/src/lib/analytics-data.ts:161-191`
- Schema/indexes: `apps/web/src/db/schema.ts:220-260`, `apps/web/drizzle/0026_analytics_top_view_indexes.sql:1-3`

Deploy/migrations:
- Migration reconciler/postcondition: `apps/web/scripts/migrate.js:719-779`, `apps/web/scripts/migrate.js:804-835`
- Journal tail: `apps/web/drizzle/meta/_journal.json:145-193`
- Runtime image/deploy: `apps/web/Dockerfile:105-145`, `apps/web/docker-compose.yml:1-27`, `apps/web/deploy.sh:10-62`
- Semantic operations docs: `CLAUDE.md:509-538`

## Confirmed Issues

None found in the current tree.

## Likely Issues

None found.

## Risks Needing Manual Validation

### TRC9-RISK-01 - Semantic search recall is capped to the most recently updated embedding rows

Severity: Medium
Confidence: High
Status: Risk needing manual validation

Code region:
- `apps/web/src/lib/clip-embeddings.ts:22-44`
- `apps/web/src/app/api/search/semantic/route.ts:242-283`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`
- `apps/web/src/db/schema.ts:277-292`
- `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`
- `CLAUDE.md:534-538`

Concrete failure scenario:
`SEMANTIC_SCAN_LIMIT` defaults to 2000 (`clip-embeddings.ts:43-44`). Both natural-language semantic search and similar-image search read only rows matching the active model version, ordered by `updated_at DESC`, then apply `.limit(SEMANTIC_SCAN_LIMIT)` before scoring (`semantic/route.ts:242-283`, `similar/[id]/route.ts:141-170`). On a gallery with more production embeddings than the cap, older rows are not candidates at all. A user searching for an older photo or asking for similar photos from an older shoot can receive no match even though that image has a valid embedding. This is intentional as a CPU/DB bound and is documented as a runtime limit (`CLAUDE.md:534-538`), but the user-facing feature reads as semantic search over the gallery.

Suggested fix:
Add an operator/admin health surface that compares production embedding count to `SEMANTIC_SCAN_LIMIT` and labels semantic search as "recent embedding window" when count exceeds the cap. For complete-gallery semantics, replace the brute-force latest-row scan with a vector index/ANN path or a paginated bounded top-k scan that makes recall tradeoffs explicit.

### TRC9-RISK-02 - Unwired in-app embedding backfill reports success after only one capped candidate set

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Code region:
- `apps/web/src/app/actions/embeddings.ts:79-80`
- `apps/web/src/app/actions/embeddings.ts:103-124`
- `apps/web/src/app/actions/embeddings.ts:129-172`
- `apps/web/scripts/backfill-clip-embeddings.ts:113-117`
- `apps/web/scripts/backfill-clip-embeddings.ts:192-196`

Concrete failure scenario:
The in-app action is explicitly noted as currently unwired and secondary to the sidecar (`actions/embeddings.ts:79-80`). If a future UI or admin workflow wires it directly, it selects at most `SEMANTIC_SCAN_LIMIT` pending rows once (`actions/embeddings.ts:103-124`), processes that fixed array, and returns `{ status: 'ok', processed, skipped }` (`actions/embeddings.ts:129-172`). With 3000 missing embeddings and the default cap of 2000, it can return success after 2000 rows with no `hasMore` or remaining-count signal. The sidecar at least logs that the scan limit was reached and says to rerun (`backfill-clip-embeddings.ts:113-117`).

Suggested fix:
Keep the action unwired, remove it, or make it keyset-paginated like the sidecar and return `hasMore`/remaining count. Add a source contract if it stays dark so a future UI cannot present the capped one-shot action as a complete backfill.

### TRC9-RISK-03 - Process-local coordination remains valid only under the documented single web-instance topology

Severity: Medium
Confidence: High
Status: Risk needing manual validation

Code region:
- `CLAUDE.md:227`
- `apps/web/docker-compose.yml:1-27`
- `apps/web/src/lib/restore-maintenance.ts:1-55`
- `apps/web/src/lib/image-queue.ts:273-323`
- `apps/web/src/app/actions/public.ts:319-338`
- `apps/web/src/app/actions/sharing.ts:22-82`

Concrete failure scenario:
The shipped compose file runs one `gallerykit-web` service with host networking and bind mounts (`docker-compose.yml:1-27`), matching the documented single-writer assumption (`CLAUDE.md:227`). Restore maintenance state, queue state, upload tracking, and several rate-limit fast paths are process-local. If production is later scaled to multiple web containers behind the same database without moving those states to shared storage, one instance can accept uploads or public write attempts while another is in restore maintenance, and per-IP limits are divided by instance count.

Suggested fix:
Before any scale-out, move restore maintenance, queue coordination, upload quota tracking, and public/share/semantic rate-limit fast paths into shared database/Redis-backed state, or hard-fail startup when more than one web instance is configured.

## False Positives / Already Fixed

### TRC9-FP-01 - Lightroom upload missing semantic-search mode snapshot

Severity if live: Medium
Confidence: High
Status: Already fixed

Evidence:
- Browser upload snapshots `semanticSearchMode`: `apps/web/src/app/actions/images.ts:504-507`
- Lightroom upload snapshots the same field: `apps/web/src/app/api/admin/lr/upload/route.ts:452-478`
- Queue accepts and applies the field: `apps/web/src/lib/image-queue.ts:90-117`, `apps/web/src/lib/image-queue.ts:632-643`

Failure scenario if unfixed:
Lightroom uploads in production semantic mode would process derivatives but skip production embeddings until a backfill.

Suggested fix:
No source fix needed. Keep the browser/LR enqueue parity covered by tests or source contracts.

### TRC9-FP-02 - Restart/bootstrap re-enqueues permanently failed rows

Severity if live: Medium
Confidence: High
Status: Already fixed

Evidence:
- Bootstrap excludes rows with `processing_error`: `apps/web/src/lib/image-queue.ts:823-859`
- Runtime permanent-failure set blocks repeated enqueue within a process: `apps/web/src/lib/image-queue.ts:402-407`

Failure scenario if unfixed:
Rows that had exhausted retries would be reprocessed on every restart.

Suggested fix:
No source fix needed.

### TRC9-FP-03 - Restore SQL scanner misses dangerous statements split by comments

Severity if live: High
Confidence: High
Status: Already fixed

Evidence:
- Dangerous statement patterns include privilege, DDL, handler, definer, prepared statement, and file-system primitives: `apps/web/src/lib/sql-restore-scan.ts:39-105`
- Scanner checks both comment-deleted and comment-spaced sanitized forms: `apps/web/src/lib/sql-restore-scan.ts:113-155`
- Restore reads the whole dump in overlapping chunks through that scanner before invoking `mysql --one-database`: `apps/web/src/app/[locale]/admin/db-actions.ts:468-520`

Failure scenario if unfixed:
A crafted dump could hide `DROP`, `CREATE USER`, or similar tokens across comments and pass the pre-import scanner.

Suggested fix:
No source fix needed.

### TRC9-FP-04 - Public semantic route reads body before rate limiting

Severity if live: Medium
Confidence: High
Status: Already fixed

Evidence:
- Content-type, transfer-encoding, content-length, and config gates run before body materialization: `apps/web/src/app/api/search/semantic/route.ts:156-173`
- Semantic rate limit is pre-incremented before `request.text()`: `apps/web/src/app/api/search/semantic/route.ts:178-203`

Failure scenario if unfixed:
Attackers could force repeated body reads/JSON parse work without spending rate-limit budget.

Suggested fix:
No source fix needed.

### TRC9-FP-05 - Analytics top-view queries lack supporting indexes

Severity if live: Low
Confidence: High
Status: Already fixed

Evidence:
- Top queries group by entity after `bot`/window filtering: `apps/web/src/lib/analytics-data.ts:28-86`, `apps/web/src/lib/analytics-data.ts:161-180`
- Schema includes top-view indexes: `apps/web/src/db/schema.ts:231-260`
- Migration 0026 creates the matching indexes: `apps/web/drizzle/0026_analytics_top_view_indexes.sql:1-3`
- Journal includes migration 0026 with a monotonic tail entry: `apps/web/drizzle/meta/_journal.json:187-193`

Failure scenario if unfixed:
Admin analytics could degrade to full table scans as view rows grow.

Suggested fix:
No source fix needed.

### TRC9-FP-06 - Migration journal non-monotonic entries can silently skip deploy migrations

Severity if live: High
Confidence: High
Status: Already fixed for current flow

Evidence:
- Fresh/legacy databases are reconciled and all journal hashes are baselined: `apps/web/scripts/migrate.js:719-756`
- After Drizzle migrate, every journal hash is asserted present: `apps/web/scripts/migrate.js:758-779`
- The runtime image copies the migration script and runs it before `server.js`: `apps/web/Dockerfile:105-145`
- The journal tail is monotonic for recent entries: `apps/web/drizzle/meta/_journal.json:145-193`

Failure scenario if unfixed:
Drizzle's MySQL cursor could skip committed migrations while deploy appears green.

Suggested fix:
No source fix needed. Continue following the AGENTS migration rule for future entries.

## Final Missed-Issue Sweep

Final sweep covered:
- Upload maintenance checks, upload quota claim/settle, strict config reads, DB insert cleanup, queue enqueue parity, per-image advisory claims, derivative verification, delete-during-processing cleanup, queue side effects, and bootstrap retry state.
- Restore locks, maintenance begin/end, queue quiesce order, SQL scanner comment/literal handling, `mysql --one-database` invocation, and post-restore migration behavior.
- Tag query canonicalization, AND semantics for multiple tags, search LIKE escaping, public search rate-limit pre-increment/rollback, UI stale-response guards, and load-more cursor continuity.
- Semantic mode gates, production env opt-in, model-version filtering, embedding binary decode/write shape, CLIP inference concurrency, enrichment privacy select, and scan-limit behavior.
- Share creation rate limits, atomic share-key update, group-share transaction, analytics rate limits, privacy-preserving analytics writes, and top-view query indexes.
- Deploy bind mounts, prune-after-up guarantees, migration journal tail, migration hash postconditions, and single-instance topology assumptions.

No confirmed source defects were found. The actionable items from this lane are the three manual-validation/operational risks above, led by semantic-search recall when production embedding count exceeds `SEMANTIC_SCAN_LIMIT`.

Validation not run: no tests or build were executed because this was a review artifact only and no source files were changed.
