# Cycle 18 Critic Review

Scope: whole repository at current HEAD `4ad6a394453fac80cc29aacc6f93eab3ed8c12ca` on `master`.

Role: critic reviewer. I did not implement product/code fixes. This artifact is the only file I changed.

## Inventory Inspected

Read first:
- `AGENTS.md`
- `CLAUDE.md`
- `~/.agents/skills/code-review/SKILL.md`

Repository inventory:
- 498 review-relevant app/lib/script/test/migration files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/src/__tests__`.
- Current review artifacts under `.context/reviews/`, including the current perf lane and the previous top-level critic/aggregate artifacts.
- Prior blind-spot clusters from run-9 cycle 8, run-4 cycle 18, photographer-r18, and recent deferred plans.

High-risk code/docs inspected:
- Public APIs/actions: semantic search, similar search, OG routes, load/search/share actions, public route rate-limit lint, same-origin/proxy helpers.
- Admin/API surfaces: image uploads, Lightroom upload, DB backup/download, admin auth wrapper, server-action origin lint.
- Image and semantic pipeline: upload enqueue sites, image queue, CLIP model loading/inference, embedding backfills, embedding schema, processing snapshots.
- Data/schema/docs: `data.ts`, `data-timeline.ts`, sitemap/feed helpers, storage quarantine, migration journal/reconciler/tests, deploy/Docker/nginx docs.

Validation stance:
- Static review only. I did not run the full blocking gates because this was a critic-only pass and no product code was changed.
- Existing unrelated worktree change observed: `.context/reviews/perf-reviewer.md` was already modified before this artifact write and was left untouched.

## Findings

### C18-CRIT-01 - Disabled/non-production semantic routes still do unmetered config DB work

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:168-185` calls `getGalleryConfig()` to resolve `semanticSearchMode` before the semantic rate limit is charged.
- `apps/web/src/app/api/search/semantic/route.ts:194-205` increments the semantic rate limit only after the config gate passes.
- `apps/web/src/__tests__/semantic-search-route.test.ts:244-261` locks the current disabled-mode behavior: the route returns 503, does not read the body, and does not call `preIncrementSemanticAttempt`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:85-113` pre-increments, calls `getGalleryConfig()`, then rolls the token back when mode is not `production`.
- `apps/web/src/lib/gallery-config.ts:34-39` shows `getGalleryConfig()` reads `admin_settings` from MySQL.
- `apps/web/src/lib/request-origin.ts:79-106` checks only request headers. That is useful against browser cross-site calls, but non-browser clients can send matching `Origin`/`Referer` headers.
- `apps/web/src/lib/gallery-config-shared.ts:103-104` makes `semantic_search_mode='disabled'` the default fresh-install state.

Issue:
The routes avoid JSON body work and embedding scans in disabled/non-production modes, but they still admit a database configuration read before retaining a rate-limit charge. For the text route, disabled mode is completely uncharged. For the similar route, the token is rolled back after the config read. The route comments describe this as avoiding charged disabled-mode work, but the protected work here is not only body parsing or CLIP CPU; it is also the shared MySQL config read on a public endpoint.

Concrete failure scenario:
A scripted client sends many small `POST /api/search/semantic` requests with `Content-Type: application/json`, a valid `Content-Length`, and an `Origin` matching the host while semantic search is disabled. Each request returns 503 without consuming the semantic bucket, but still executes the `admin_settings` SELECT. A similar probe against `/api/search/similar/1` in disabled or stub mode also gets its token refunded after the config read. On the documented single-host deployment, this can consume DB connections/CPU while application-level telemetry shows no rate-limit pressure for the semantic bucket.

Suggested fix:
Charge the semantic bucket before the config DB read once the cheap syntactic gates pass, and do not roll back disabled/stub mode after the config read has been consumed. If product policy wants disabled-mode responses to remain effectively free, make the mode check non-DB on the hot path, for example a short-TTL in-process cached setting with bounded refresh. Add tests that assert disabled/stub semantic requests either retain a token after `getGalleryConfig()` or hit a cached no-DB mode path.

### C18-CRIT-02 - CLIP inference bounds active work but leaves pending public/background callers unbounded and abort-insensitive

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/src/lib/clip-model.ts:53-70` limits active CLIP inference with `CLIP_INFERENCE_CONCURRENCY`, but stores pending callers in an unbounded `inferenceWaiters` array.
- `apps/web/src/app/api/search/semantic/route.ts:248-255` checks request abort before `embedTextReal(query)`, but once a caller waits inside `withInferenceSlot()` there is no abort signal to remove it.
- `apps/web/src/lib/clip-model.ts:138-146` routes production text search through the same inference slot.
- `apps/web/src/lib/clip-model.ts:171-222` routes image embedding, including Sharp preprocessing, through the same slot.
- `apps/web/src/lib/image-queue.ts:272` and `apps/web/src/lib/image-queue.ts:327-332` track embedding/caption side effects in a process-local `Set` without a pending-depth cap.
- `apps/web/src/lib/image-queue.ts:720-746` starts the post-upload embedding side effect and drains it only by completion.

Issue:
The active CLIP work is bounded, but the admission queue is not. Public production semantic searches and background post-upload embedding side effects share the same slot. Disconnected public requests remain represented by queued promises, and background side effects can keep accumulating while waiting. That turns a CPU protection mechanism into an unbounded memory/latency queue under burst load.

Concrete failure scenario:
Production semantic mode is enabled with the default CLIP concurrency of 1. A burst of public searches arrives while uploads are finishing and scheduling production image embeddings. Many browser requests disconnect after timing out, but their waiters remain in `inferenceWaiters`; when they eventually run, they still spend ONNX CPU. Meanwhile the image queue's side-effect set grows and restore/shutdown has more abandoned work to drain. Interactive search latency, background processing, and shutdown behavior all degrade together.

Suggested fix:
Replace the manual waiter array with a bounded semaphore or queue that supports max pending count, max wait time, and `AbortSignal` removal. Return 429 or 503 on saturation. Separate public interactive search admission from background image-embedding admission, or give them distinct quotas/priorities. Expose queue depth/wait time metrics so operators can see when the CLIP subsystem is saturated.

### C18-CRIT-03 - Embedding rows are one-per-image, so model cutovers are destructive and hard to roll back

Severity: Medium
Confidence: High
Status: Confirmed design risk

Evidence:
- `apps/web/src/db/schema.ts:280-294` makes `image_embeddings.image_id` the primary key; `model_version` is only an indexed attribute.
- `apps/web/scripts/backfill-clip-embeddings.ts:123-147` selects images missing an embedding row for the target model version.
- `apps/web/scripts/backfill-clip-embeddings.ts:172-183` writes through `onDuplicateKeyUpdate`, replacing the existing row for that image with the target model version.
- `apps/web/src/app/actions/embeddings.ts:103-124` mirrors the per-version missing-row selection.
- `apps/web/src/app/actions/embeddings.ts:152-163` mirrors the destructive upsert.
- `apps/web/src/app/api/search/semantic/route.ts:261-273` scans only rows matching the active model version.

Issue:
The read path is model-version aware, but the storage model cannot retain two embeddings for one image. Backfilling a new model overwrites the old vector. That makes a semantic model upgrade a destructive migration rather than a staged cutover. The code comments correctly distinguish stub and production rows, but the schema shape prevents side-by-side validation or quick rollback.

Concrete failure scenario:
An operator tries a new production CLIP model version and starts a backfill. Halfway through, quality regressions or a host restart interrupt the process. Rows already rewritten no longer exist for the previous model version, and rows not yet rewritten do not exist for the new version. Search either sees a partial corpus for the new model or loses rewritten rows when rolling back to the old model. Recovering requires a full re-embed from originals.

Suggested fix:
Model embeddings as `(image_id, model_version)` with a composite primary/unique key, and make the active semantic model a separate setting. Backfill a candidate version side by side, verify coverage and quality, then flip the active model. If storage cost rules that out, document production model upgrades as destructive maintenance windows and gate production search until coverage for the active version is complete.

## Review Blind Spots Rechecked

- Settings-forwarding regression class from run-9 is closed at current HEAD. Browser upload forwards all processing/search snapshot fields at `apps/web/src/app/actions/images.ts:500-526`, and `apps/web/src/__tests__/images-actions.test.ts:264-276` asserts the producer payload. Lightroom upload has a source-contract lock at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:384-394`.
- The old `retryFailedImage` hardcoded English error is fixed: `apps/web/src/app/actions/images.ts:1194-1224` uses translation keys for invalid ID and non-failed-state errors.
- The historical non-monotonic migration journal remains grandfathered, but deploy safety is guarded by the migrator baselining/post-condition and migration tests. I did not refile it as a current defect.
- The storage backend still has a public-root `original/` mapping risk inside the quarantined abstraction (`apps/web/src/lib/storage/local.ts:20`, `apps/web/src/lib/storage/local.ts:130-135`), but it is not live product code today. The quarantine is executable at `apps/web/src/__tests__/storage-quarantine.test.ts:111-143`; re-open before the first real importer.
- Older cycle-18 feed/sitemap items are fixed at current HEAD: sitemap homepage/topic `lastModified` exists at `apps/web/src/app/sitemap.ts:57-73`, topic feed locale validation exists at `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:34-47`, and Atom enclosure/title metadata exists at `apps/web/src/lib/atom-feed.ts:119-136`.
- The cycle-17 home-page "successful empty gallery on image query failure" appears resolved at current HEAD: `apps/web/src/app/[locale]/(public)/page.tsx:149-167` now awaits `getImagesLitePage(...)` directly instead of catching it into an empty gallery.

## Final Missed-Issues Sweep

I re-swept public APIs/actions, semantic/similar routes, CLIP queueing, upload enqueue paths, backup/download containment, storage quarantine, migration journal guards, route-lint scanners, feed/sitemap current fixes, privacy select fields, and prior review registers. I did not find a new current critical vulnerability, public PII leak, schema deploy blocker, or color/HDR settings-forwarding regression beyond the three findings above.

Total findings: 3
- Critical: 0
- High: 1
- Medium: 2
- Low: 0
