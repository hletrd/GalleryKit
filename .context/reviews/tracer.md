# Cycle 30 Tracer Review

Review target: current HEAD `666b74f8704024bb1a1fa1faa02a8e34114e678c`
Review role: `tracer`
Mode: review-only. Product code was not changed.

## Inventory And Trace Map

Read first:

- `AGENTS.md`
- `CLAUDE.md`

Repository trace inventory:

- Source inventory: 518 files under `apps/web/src`, 81,758 lines.
- Runtime traces inspected: upload to queue, queue to derivative commit, admin/in-app color backfill, operator color sidecar, semantic embedding/search, public search/load-more, service worker image cache, restore maintenance drains, rate-limit IP derivation and bounded maps, deploy health path.

Key causal flows checked:

- Upload actions take same-origin/admin checks, upload tracker claim, upload-processing contract lock, original write, metadata/GPS/HDR gates, DB insert, tag write, and image-queue enqueue.
- Image queue takes per-image advisory lock, rechecks unprocessed row state, encodes derivatives, verifies files, conditionally marks processed, cleans derivatives if the row disappeared, and tracks caption/embedding side effects.
- In-app color backfill takes the global color backfill lock and per-image processing claim before re-encoding and updating.
- Operator color sidecar takes the global color lock but does not take per-image claims.
- Restore drains image queue, shared view-count buffer, and tracked background DB writes before import.
- Public search, semantic search, and map routes use public select-field shapes and rate-limit checks where applicable.

## Confirmed Issues

### TRC30-01 - Service worker metadata has a lost-update race across concurrent image cache operations

Severity: Medium
Confidence: High
Status: Confirmed issue

Code region:

- `apps/web/public/sw.template.js:100-130`
- `apps/web/public/sw.template.js:161-175`
- `apps/web/public/sw.template.js:177-181`
- `apps/web/public/sw.template.js:203-217`
- `apps/web/public/sw.template.js:258-262`

Causal trace:

1. Request A and request B enter the service worker for different derivative URLs.
2. Both call `getMeta()` and receive the same current metadata blob.
3. A records or touches URL A and calls `setMeta(entriesA)`.
4. B records or touches URL B and calls `setMeta(entriesB)`.
5. The later write overwrites the entire blob and drops the other request's mutation.
6. Cache bytes and LRU metadata diverge.

Failure scenario:

A public gallery paint with many simultaneous cached/revalidating derivatives slowly loses metadata entries. Later LRU eviction undercounts total cache size and cannot evict URLs absent from metadata, leaving stale cache entries until browser quota eviction intervenes.

Suggested fix:

Make all metadata mutations single-flight in the service worker. The critical region is the whole `getMeta -> mutate -> setMeta` sequence, not only `setMeta()`. Add a concurrency regression test.

### TRC30-02 - Color sidecar traces show all-candidate scheduling rather than bounded causal batches

Severity: Medium
Confidence: High
Status: Confirmed issue

Code region:

- `apps/web/scripts/backfill-color-pipeline.ts:343-360`
- `apps/web/scripts/backfill-color-pipeline.ts:475-512`
- Comparison: `apps/web/src/lib/admin-backfill-runner.ts:394-423`

Causal trace:

1. Sidecar acquires `LOCK_COLOR_PIPELINE_BACKFILL`.
2. Sidecar queries all processed stale rows into `rows`.
3. Sidecar creates a PQueue task for every row.
4. Only after all tasks are scheduled does it wait for `queue.onIdle()`.
5. Batch updates flush every 100 processed outcomes, but the pending task graph remains O(total candidates).

Failure scenario:

With a large stale candidate set, the sidecar spends memory on the full candidate snapshot and every closure. If RSS pressure kills the process before progress is flushed, the global lock is released by connection close but the operator sees partial or no useful progress.

Suggested fix:

Follow the in-app runner's keyset batch trace: fetch a bounded candidate batch, schedule only that batch, drain, flush, advance cursor, repeat. Keep causal progress local and restartable.

## Likely Issues

### TRC30-03 - Semantic scan/scoring has no causal backpressure after inference completes

Severity: Medium
Confidence: High
Status: Likely issue

Code region:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/app/api/search/semantic/route.ts:270-311`
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`
- `apps/web/src/lib/clip-embeddings.ts:164-168`

Causal trace:

1. Semantic search request passes rate limit and same-origin checks.
2. Query embedding is created or stubbed.
3. Route fetches up to `SEMANTIC_SCAN_LIMIT` stored embeddings from MySQL.
4. Route decodes and scores every embedding in the request.
5. Route sorts all scored matches and slices top K.

Failure scenario:

The CLIP model queue limits inference, but step 3 through step 5 are not behind a separate CPU/memory semaphore. Several public requests can simultaneously decode, score, and sort large embedding sets on the same Node process, delaying unrelated async continuations.

Suggested fix:

Add scan/scoring backpressure distinct from model inference. Use a heap instead of full sort, chunk/yield CPU work, or move vector search out of the web request process.

### TRC30-04 - Dynamic first-page gallery trace still couples page paint to exact grouped count

Severity: Medium
Confidence: High
Status: Likely issue

Code region:

- `apps/web/src/lib/data.ts:878-907`
- `apps/web/src/lib/data.ts:1446-1460`

Causal trace:

1. Public first page asks for approximately 30 images.
2. Query joins tag tables and groups by image ID.
3. Query also calculates `COUNT(*) OVER()` across all grouped matches.
4. Response uses visible rows plus `totalCount`.

Failure scenario:

A visitor or crawler request for the first page is causally blocked on exact grouped counting. Even if load-more later uses cursor pagination, the initial route keeps the heavier offset/count trace.

Suggested fix:

Separate "first visible page" from "exact total". Use `pageSize + 1` for route responsiveness and move exact counts to cached/admin-only paths.

## Risks Needing Manual Validation

### TRC30-05 - Color sidecar does not participate in per-image processing claims

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Code region:

- Queue per-image claim: `apps/web/src/lib/image-queue.ts:470-497` and `apps/web/src/lib/image-queue.ts:543-699`
- In-app backfill per-image claim: `apps/web/src/lib/admin-backfill-runner.ts:485-514`
- Sidecar global-only lock and reprocess path: `apps/web/scripts/backfill-color-pipeline.ts:305-328` and `apps/web/scripts/backfill-color-pipeline.ts:198-274`

Causal trace:

1. Queue and in-app backfill treat `gallerykit:image-processing:{id}` as the per-image serialization primitive.
2. Sidecar serializes only against other color backfills with the global color lock.
3. Sidecar re-encodes derivative files before its batch DB update.
4. Any future processed-image retry/reprocess path that uses the queue lock can overlap the sidecar because the sidecar does not observe that lock.

Failure scenario:

A future admin action or maintenance command reprocesses a processed image while the sidecar is force-reencoding the same row. Both write the same derivative filenames; one DB update can describe the other process's bytes, or a failure path can restore/delete files expected by the other process.

Current mitigating evidence:

- The live queue currently rechecks `processed = false` before encode, so normal fresh uploads do not overlap sidecar candidates.
- Current failed-image retry selects unprocessed failed rows, not sidecar's `processed = true` candidate set.
- Delete-mid-reencode cleanup is handled by affected-row checks.

Suggested fix:

Either make the sidecar acquire the same per-image claim around `reprocessRow()` through DB update, or lock the current non-overlap invariant with tests and explicit operator documentation.

### TRC30-06 - Proxy-derived client IP needs live topology validation

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation

Code region:

- `apps/web/src/lib/rate-limit.ts:166-197`
- `apps/web/src/lib/rate-limit.ts:80-99`
- `apps/web/src/lib/rate-limit.ts:115-124`

Causal trace:

1. Public and auth rate limits key by `getClientIp()`.
2. With `TRUST_PROXY=true`, app chooses a client before the trusted proxy suffix from `X-Forwarded-For`, then falls back to `X-Real-IP`.
3. If upstream nginx or the TLS edge collapses the chain to one proxy address, all users share the same app-side key.

Failure scenario:

One abusive public search or OG caller can consume a shared bucket and throttle unrelated users. For login buckets, one client's failed attempts can lock out everyone behind the same derived address.

Suggested fix:

Validate live headers through the production edge and set real-IP/trusted-hop configuration from observed topology. Keep a deploy smoke check that proves distinct clients derive distinct app keys.

### TRC30-07 - Timeline archive scan cost needs production EXPLAIN validation

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Code region:

- `apps/web/src/lib/data-timeline.ts:97-116`
- `apps/web/src/lib/data-timeline.ts:129-145`
- `apps/web/src/lib/data-timeline.ts:186-207`

Causal trace:

1. Timeline route asks for year/month or On This Day slices.
2. Query wraps `capture_date` with `YEAR()`, `MONTH()`, or `DAY()`.
3. MySQL cannot use a pure capture-date range for those function predicates.
4. Dynamic public traffic repeats this work.

Failure scenario:

At larger image counts, archive routes become scan-heavy and can compete with gallery listing, upload, and queue DB work.

Suggested fix:

Validate with production-like `EXPLAIN ANALYZE`. Use date ranges for year/month and generated/indexed date-part columns or rollups for On This Day.

## Non-Issues Confirmed In This Trace

- In-memory rate-limit maps are bounded: `apps/web/src/lib/bounded-map.ts:91-99` enforces caps on write, and `apps/web/src/lib/bounded-map.ts:156-187` prunes expired and excess entries.
- Load-more guards duplicate/stale async flows with loading and version guards; no stale append race was confirmed.
- Search UI aborts/guards stale semantic responses; no stale-result UI overwrite was confirmed.
- Restore path drains tracked background DB writes before import; no stale analytics/audit write race was confirmed in current HEAD.
- Queue delete-mid-processing path cleans derivatives if the processed-row update affects zero rows.

## Final Sweep And Skipped Areas

Final sweeps included upload/queue/retry, restore drains, semantic search, public search, map, timeline, service worker cache, bounded maps, and sidecar backfills. I did not line-review generated build output, binary assets, uploads/data directories, `.git`, `node_modules`, historical screenshots, or prior review archives except as context for stale-assumption avoidance.
