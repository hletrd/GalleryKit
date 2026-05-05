# Aggregate Review — Cycle 21

## Review method
Direct deep review of all source files by a single agent with multi-perspective analysis. All key modules examined: rate-limit, image-queue, data, semantic search, smart collections, service worker, OG image generation, checkout, Stripe webhook, auth, upload pipeline, and recently changed files.

## Verified prior fixes (from cycle 19)

| ID | Status | Notes |
|----|--------|-------|
| C19-AGG-01 (ESM entry-point detection) | FIXED | `typeof require !== 'undefined'` guard reordered in cycle 20. |
| C19-AGG-02 (misplaced cache() comment) | FIXED | Comment moved to `getSharedGroupCached` in cycle 20. |
| C19-AGG-03 (regex suffix optional) | FIXED | `[A-Za-z0-9_]+` changed to `[A-Za-z0-9_]*` in cycle 20. |
| C19-AGG-04 (semantic fallback unfiltered) | FIXED | Fallback now returns empty results in cycle 20. |
| C19-AGG-05 (sw.js build script comment) | FIXED | Comment updated in cycle 20. |

---

## Findings (sorted by severity)

### HIGH severity

#### C21-AGG-01: Semantic search is fully wired but returns random results

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:141-147`, `apps/web/src/lib/clip-inference.ts`
- **Cross-agent agreement**: C21-HIGH-01 (code-reviewer), C21-SEC-04 (security), C21-ARCH-01 (architect), C21-CT-01 (critic), C21-DEBUG-01 (debugger) — 5 agents agree
- **Issue**: The semantic search endpoint is fully operational (admin toggle, public API, result enrichment, rate limiting, backfill script). However, `embedTextStub` and `embedImageStub` produce deterministic SHA-256-based embeddings with NO semantic meaning. Cosine similarity scores are mathematically valid but random. An admin enabling the feature sees apparently-working search results that are completely unrelated to queries.
- **Failure scenario**: Admin enables semantic search. Users submit queries like "sunset beach" and receive random photos of buildings, portraits, or documents. The scores look legitimate (0.2-0.9 range). Users lose trust in the search feature and file support tickets about "bad search quality" rather than recognizing the feature is non-functional.
- **Fix**: Add a `semantic_search_mode` config (`disabled` | `stub` | `production`). Default to `disabled`. Only allow `production` when a real ONNX model is detected. Make `stub` require explicit opt-in with a warning banner.
- **Confidence**: High

---

### MEDIUM severity

#### C21-AGG-02: Chunked transfer encoding bypasses semantic search body size guard

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:74-90`
- **Cross-agent agreement**: C21-MED-01 (code-reviewer), C21-SEC-01 (security), C21-CT-03 (critic) — 3 agents agree
- **Issue**: The body size guard only checks `Content-Length`. When `Transfer-Encoding: chunked` is used (no Content-Length), the guard is bypassed and `request.json()` buffers an unbounded stream.
- **Failure scenario**: Attacker sends chunked POST with multi-megabyte JSON body. Server buffers it into memory before JSON parsing fails. DoS via memory exhaustion.
- **Fix**: Read body as text with explicit length cap: `const text = await request.text(); if (text.length > MAX_SEMANTIC_BODY_BYTES) return 413;` then `JSON.parse(text)`.
- **Confidence**: High

#### C21-AGG-03: `quiesceImageProcessingQueueForRestore` does not wait for active jobs

- **Source**: `apps/web/src/lib/image-queue.ts:604-625`
- **Cross-agent agreement**: C21-MED-02 (code-reviewer), C21-ARCH-02 (architect), C21-CT-02 (critic), C21-DEBUG-02 (debugger) — 4 agents agree
- **Issue**: The function waits for `queue.onPendingZero()` which only tracks queued (not active) jobs. An actively running Sharp processing job can continue while restore proceeds.
- **Failure scenario**: Admin initiates DB restore. Quiescence returns immediately because no jobs are queued (one is actively running). Restore drops tables. Active job finishes and tries to UPDATE the now-restored `images` table or write files, causing corruption.
- **Fix**: Use `await queue.onIdle()` if p-queue supports it, or track active job promises and await them.
- **Confidence**: High

#### C21-AGG-04: Race condition in `decrementRateLimit` UPDATE+DELETE sequence

- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Cross-agent agreement**: C21-MED-03 (code-reviewer), C21-SEC-02 (security), C21-ARCH-04 (architect), C21-DEBUG-03 (debugger) — 4 agents agree
- **Issue**: Between UPDATE (sets count=0) and DELETE (removes row), a concurrent `incrementRateLimit` can set count=1. The DELETE then removes the row, losing the increment.
- **Failure scenario**: High-concurrency rollback + new request on same IP/window. Rate limit counter undercounts, allowing more requests than configured.
- **Fix**: Wrap UPDATE+DELETE in a transaction, or use a single atomic operation.
- **Confidence**: Medium

---

### LOW severity

#### C21-AGG-05: Service worker HTML cache has no size limit or eviction

- **Source**: `apps/web/src/public/sw.js:18,143-178`
- **Cross-agent agreement**: C21-LOW-01 (code-reviewer), C21-PERF-01 (perf-reviewer), C21-DEBUG-04 (debugger)
- **Issue**: HTML_CACHE stores every visited page with no eviction. Unlike IMAGE_CACHE (50MB LRU), HTML cache grows indefinitely within a version.
- **Fix**: Add LRU eviction policy with conservative cap (e.g., 5MB or 50 entries).
- **Confidence**: High

#### C21-AGG-06: `backfillClipEmbeddings` lacks rate limiting

- **Source**: `apps/web/src/app/actions/embeddings.ts`
- **Cross-agent agreement**: C21-LOW-03 (code-reviewer), C21-SEC-03 (security), C21-CT-04 (critic)
- **Issue**: Admin-only action processes up to 5000 images with no rate limiting. Repeated invocation causes CPU and DB pressure.
- **Fix**: Add per-admin rate limit (e.g., once per hour) or global semaphore.
- **Confidence**: Medium

#### C21-AGG-07: OG photo route buffer size guard bypassable via chunked encoding

- **Source**: `apps/web/src/app/api/og/photo/[id]/route.tsx:91-100`
- **Cross-agent agreement**: C21-LOW-06 (code-reviewer), C21-SEC-05 (security), C21-DEBUG-04 (debugger)
- **Issue**: Internal fetch size guard relies on Content-Length. With chunked encoding, `arrayBuffer()` buffers full response unchecked.
- **Fix**: Add post-fetch buffer size validation: `if (photoBuffer.length > OG_PHOTO_MAX_BYTES) return fallback`.
- **Confidence**: Medium

#### C21-AGG-08: Bootstrap cleanup tasks run repeatedly

- **Source**: `apps/web/src/lib/image-queue.ts:576-592`
- **Cross-agent agreement**: C21-LOW-05 (code-reviewer), C21-PERF-02 (perf-reviewer), C21-DEBUG-05 (debugger)
- **Issue**: `purgeExpiredSessions` and `purgeOldAuditLog` run on every bootstrap call. Bootstrap triggered on startup, after failed jobs, and after queue drains.
- **Fix**: Gate cleanup to run at most once per process lifetime or per hour.
- **Confidence**: Low

#### C21-AGG-09: Semantic search accepts any Content-Type

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:64-109`
- **Cross-agent agreement**: C21-LOW-04 (code-reviewer)
- **Issue**: Endpoint does not validate `Content-Type: application/json`.
- **Fix**: Add `if (!request.headers.get('content-type')?.includes('application/json')) return 400`.
- **Confidence**: Low

#### C21-AGG-10: Semantic search endpoint comment understates stub randomness

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:17-19`
- **Cross-agent agreement**: C21-DOC-01 (document-specialist)
- **Issue**: Comment says "not semantically meaningful" but should say "returns RANDOM results".
- **Fix**: Update comment to be more emphatic.
- **Confidence**: Low

---

## No new regressions detected
- All cycle-20 fixes are clean and stable.
- No new failure modes introduced by recent commits.

## Carry-forward (unchanged — existing deferred backlog)
- C16-HIGH-01: SW metadata cache read-modify-write race — deferred
- C17-ARCH-03: SW metadata store uses single shared JSON blob — deferred
- C17-PERF-02: getImagesLitePage COUNT(*) OVER() — deferred
