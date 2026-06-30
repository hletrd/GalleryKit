# Code Reviewer Report - Cycle 24

## Provenance

- Role: code-reviewer
- Repository: `/Users/hletrd/flash-shared/gallery`
- Date: 2026-06-30 KST
- Reviewed HEAD: `0cc094dd76d51e88fe163c0b7075e3f0b341f74c`
- Scope: review-only. No source files modified.
- Standing instructions read/applied: `AGENTS.md` from prompt, `CLAUDE.md`, and `code-review` skill.

## Inventory

Current HEAD inventory before issue analysis:

- App source: 505 TypeScript/TSX files under `apps/web/src`.
- Unit tests: 267 `*.test.ts` / `*.test.tsx` files under `apps/web/src/__tests__`.
- App route handlers: 12 `route.ts` / `route.tsx` files under `apps/web/src/app`.
- App pages: 21 `page.tsx` files under `apps/web/src/app`.
- Migrations/schema metadata: 31 files under `apps/web/drizzle`.
- Operational scripts: 27 files under `apps/web/scripts`.
- E2E files: 8 files under `apps/web/e2e`.

Reviewed current code/docs across the review-relevant surfaces: DB schema and migrations, upload and Lightroom ingestion, image processing queue, semantic search and embedding backfill, topic mutation/aliases/smart collections, auth/action/public-route gates, restore/backup maintenance, public data projections, file serving, JSON-LD injection points, deployment/runtime documentation, and test coverage around those areas. Final static sweeps covered raw SQL, dangerous render/eval patterns, lint suppressions, TODO/FIXME markers, route/action inventories, and dirty worktree status.

## Findings

### C24-01 - Semantic text search scans embeddings that the enrichment step later discards

- Severity: Medium
- Confidence: Medium
- Files/lines: `apps/web/src/app/api/search/semantic/route.ts:270-275`, `apps/web/src/app/api/search/semantic/route.ts:325-331`, comparison point `apps/web/src/app/api/search/similar/[id]/route.ts:168-177`
- Category: logic, cross-file consistency, edge case

The natural-language semantic search route scans `image_embeddings` by `model_version` only, ranks those rows, and only afterward filters to `images.processed = true` during enrichment. The similar-photo route already joins `images` and filters `processed = true` during the scan itself.

Normal writers mostly maintain the processed-image invariant: queue embedding writes run after `processed=true` (`apps/web/src/lib/image-queue.ts:697-742`), bootstrap retry selects processed rows (`apps/web/src/lib/image-queue.ts:386-400`), and admin embedding backfill selects processed rows (`apps/web/src/app/actions/embeddings.ts:120-140`). The route still has a real read-side asymmetry. If a restore/import/manual repair/future writer leaves stale embedding rows for unprocessed images, those rows can consume the scan/top-K budget and then disappear at enrichment. A user can receive fewer than `topK` results, or no results, while valid processed embeddings exist below the stale rows.

Concrete fix: make `api/search/semantic` mirror the similar route by joining `images` in the scan and filtering `eq(images.processed, true)` before scoring:

```ts
.from(imageEmbeddings)
.innerJoin(images, eq(imageEmbeddings.imageId, images.id))
.where(and(
  eq(imageEmbeddings.modelVersion, activeModelVersion),
  eq(images.processed, true),
))
```

Add a regression test with one high-scoring unprocessed/stale embedding and one lower-scoring processed embedding; the processed image should still be returned.

### C24-02 - Foreground image processing can still pin most of the shared MySQL pool

- Severity: Medium
- Confidence: High
- Files/lines: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:87-90`, `apps/web/src/lib/image-queue.ts:519-657`, `apps/web/src/lib/image-queue.ts:812-815`, comparison point `apps/web/src/lib/admin-backfill-runner.ts:129-141` and `apps/web/src/lib/admin-backfill-runner.ts:667-678`
- Category: availability, maintainability, cross-file resource budgeting

The app-wide pool is 10 connections with queue limit 20. Foreground processing allows `QUEUE_CONCURRENCY` up to 8 and each job acquires an image-processing advisory-lock connection before reading the row, running Sharp, writing outputs, and marking the image processed. That connection is released only in `finally`.

The background color backfill has explicit pool-budget arithmetic and clamps concurrency. The foreground upload queue does not have an equivalent live-traffic reserve. If an operator sets `QUEUE_CONCURRENCY=8`, a burst of uploads can hold 8/10 connections for encode-duration work. Concurrent public pages, admin actions, semantic search, restore checks, and upload requests can then sit behind the pool queue and fail under load.

Concrete fix: apply the same pool-budget model to foreground queue concurrency, or split long-running processing locks onto a separate small pool. At minimum, clamp effective queue concurrency based on `POOL_CONNECTION_LIMIT` with a live-traffic reserve and document the shipped maximum. A stronger fix is to avoid holding a pooled DB connection across Sharp work: claim in DB/advisory lock, release during CPU/file processing, then finish with a conditional `UPDATE ... WHERE processed=false` plus cleanup on affected-row miss.

### C24-03 - Browser and Lightroom ingestion still duplicate the upload lifecycle

- Severity: Medium
- Confidence: High
- Files/lines: browser path `apps/web/src/app/actions/images.ts:175-248`, `apps/web/src/app/actions/images.ts:253-299`, `apps/web/src/app/actions/images.ts:418-537`; Lightroom path `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`, `apps/web/src/app/api/admin/lr/upload/route.ts:395-477`, `apps/web/src/app/api/admin/lr/upload/route.ts:404-516`
- Category: SOLID, maintainability, cross-file interaction

The browser server action and Lightroom API route both implement quota claim/settle, disk checks, restore-maintenance windows, metadata extraction, GPS/HDR policy, insert shape, processing-settings snapshots, and queue job construction. Current code has many parity comments that show this surface has already regressed several times: settings snapshots, color signals, captions, audit attribution, quota settlement, and restore cleanup have all needed mirrored fixes.

Failure scenario: a new image column, privacy decision, processing setting, or queue-job field lands in one ingestion path and not the other. Lightroom-published photos can then differ from browser uploads in color handling, privacy stripping, semantic embeddings, auditability, or retry behavior.

Concrete fix: extract a shared ingestion service with source-specific adapters. The shared layer should own: sanitized original save result -> DB insert values -> tag handling hook -> queue job payload -> quota settlement/cleanup contract. Add parity tests that assert browser and Lightroom upload paths produce the same insert/enqueue shape for the same normalized input, with only source-specific fields intentionally different.

### C24-04 - Single-writer runtime assumptions are documented but not enforced

- Severity: Medium
- Confidence: High
- Files/lines: `CLAUDE.md:233-235`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/upload-tracker-state.ts:70-78`, `apps/web/src/instrumentation.ts:1-6`, `apps/web/src/lib/image-queue.ts:76-90`
- Category: operational correctness, cross-process state, manual validation risk

The docs state the shipped deployment is single web-instance / single-writer because restore maintenance, upload tracking, queue state, some rate-limit buckets, backfill status, and shared-group view buffers are process-local. The code matches that: restore maintenance is a `globalThis` boolean, upload tracker is a process-local `Map`, queue bootstrap state is process-local, and each process runs queue bootstrap from Next instrumentation.

This is acceptable only while deployment stays single-instance. If Docker Compose, PM2, Kubernetes, or a host-level restart policy accidentally runs two web processes against the same DB/uploads directory, restore maintenance in one process will not block uploads in the other, upload quota/rate-limit state will split, queue bootstraps will duplicate work until advisory locks arbitrate per image, and in-memory status/buffers become misleading.

Concrete fix: add an enforceable startup/readiness guard for the current product contract. For example, acquire and hold a MySQL advisory lock such as `gallerykit_web_single_writer` for the process lifetime and fail readiness/startup if it cannot be acquired, unless an explicit `ALLOW_MULTI_WRITER_UNSAFE=true` override is set. Before real horizontal scaling, move restore maintenance, upload quota, queue state/status, and affected rate-limit buckets to a shared store with tests for two-process behavior.

### C24-05 - Topic slug is a mutable primary key with manual fanout into FKs and JSON predicates

- Severity: Medium
- Confidence: High
- Files/lines: `apps/web/src/db/schema.ts:4-16`, `apps/web/src/db/schema.ts:19-33`, `apps/web/src/db/schema.ts:240-242`, `apps/web/src/app/actions/topics.ts:285-339`, `apps/web/src/app/actions/topics.ts:310-335`
- Category: data integrity, maintainability, SOLID

`topics.slug` is the primary key and several tables reference it directly. Rename is implemented as insert-new-topic, update known children, rewrite smart-collection JSON predicates, then delete the old topic. The current implementation covers known children (`images`, `topic_aliases`, `topic_views`) and rewrites smart collection ASTs, but the correctness burden is manual and cross-file.

Failure scenario: a future migration adds another child table or another serialized reference to topic slug. Topic rename can silently orphan that relationship, cascade-delete history, or leave saved rules pointing at a deleted slug. The comments around `topic_views` and smart collections show this failure class has already occurred as the schema evolved.

Concrete fix: migrate toward immutable topic IDs as FK targets and keep `slug` as a unique mutable attribute. If that is too large for now, add a schema-level regression test that enumerates every FK/reference to `topics.slug` and fails unless `updateTopic` handles it. Also centralize serialized topic-slug reference rewrites behind a registered dependency list so new features must opt into rename behavior.

### C24-06 - Production semantic threshold is acknowledged as needing real-gallery validation

- Severity: Low
- Confidence: High
- Files/lines: `apps/web/src/lib/clip-embeddings.ts:185-191`
- Category: product correctness, manual validation risk

`PRODUCTION_COSINE_THRESHOLD` is set from synthetic-gradient and limited real-photo observations, and the code comment explicitly says to re-validate on real gallery data after deploy. This is not a code safety defect, but it is a live search-quality risk: too high a threshold hides valid semantic matches, while too low a threshold returns unrelated photos. Because the threshold gates public search results, poor calibration will look like a broken feature even if the embedding pipeline works.

Concrete fix: add a small real-gallery evaluation fixture or operator script that records query -> expected image IDs and reports recall/precision against the configured threshold. Prefer making the production threshold env/admin-configurable with bounded validation and surfacing zero-result/low-score metrics in admin diagnostics.

## Checks With No New Finding

- Admin API auth wrapper invariant passed via `npm run lint:api-auth --workspace=apps/web`.
- Mutating server-action same-origin invariant passed via `npm run lint:action-origin --workspace=apps/web`.
- Public mutating route rate-limit invariant passed via `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Type checking passed via `npm run typecheck --workspace=apps/web`.
- Current audit purge is bounded (`apps/web/src/lib/audit.ts:124-133`), so the prior unbounded-delete concern is no longer current.
- Current upload serving validates real paths and streams from the already validated file descriptor (`apps/web/src/lib/serve-upload.ts:175-184`, `apps/web/src/lib/serve-upload.ts:269-274`), so the prior pathname TOCTOU concern is no longer current.
- JSON-LD `dangerouslySetInnerHTML` sites were included in the sweep; they route through existing safe JSON serialization helpers or prebuilt JSON strings from server code, with no new confirmed issue found in this pass.

## Final Missed-Issues / File-Skipped Sweep

Final sweep commands covered executable source, scripts, e2e, route inventories, schema/migration surfaces, and high-risk patterns (`dangerouslySetInnerHTML`, `eval`, `new Function`, `TODO/FIXME/HACK/XXX`, `@ts-ignore`, broad ESLint disables). Generated/build/dependency artifacts and binary assets were intentionally skipped: `node_modules`, `.next`, `.git`, uploaded media/data directories, font/image binaries, and historical review/plan artifacts except for provenance comparison.

Worktree note: `.context/reviews/verifier.md` was already modified by another actor during this review. It was not read as source truth for these findings and was not modified by this report.
