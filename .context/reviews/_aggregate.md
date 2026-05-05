# Aggregate Review — Cycle 22

## Review method
Direct deep review of all source files by a single agent with multi-perspective analysis. Focused on verifying cycle-21 fix status and finding new issues in recently changed code (semantic search, image queue, service worker, settings, navigation).

## Verified prior fixes (from cycle 21)

| ID | Status | Notes |
|----|--------|-------|
| C21-AGG-01 (semantic stub) | FIXED | `semantic_search_mode` enum added; endpoint rejects non-production |
| C21-AGG-02 (chunked encoding) | FIXED | Body read as text with cap; chunked encoding rejected |
| C21-AGG-03 (quiesce onIdle) | FIXED | `image-queue.ts:609` uses `onIdle` |
| C21-AGG-07 (OG photo buffer) | FIXED | `route.tsx:96-100` post-fetch buffer length check |
| C21-AGG-09 (Content-Type) | FIXED | `route.ts:75-78` validates Content-Type |
| C21-AGG-10 (comment) | FIXED | Comment now reads "returns RANDOM results" |

---

## Findings (sorted by severity)

### HIGH severity

#### C22-AGG-01: Race condition in `decrementRateLimit` UPDATE+DELETE sequence (carry-over C21-AGG-04)

- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Cross-agent agreement**: C22-HIGH-01 (code-reviewer), C22-SEC-01 (security), C22-ARCH-01 (architect), C22-CT-01 (critic), C22-DEBUG-01 (debugger) — 5 agents agree
- **Issue**: Between UPDATE (sets count=0) and DELETE (removes row), a concurrent `incrementRateLimit` can set count=1 via `onDuplicateKeyUpdate`. The DELETE then removes the row, losing the increment. This undermines the DB-as-source-of-truth invariant for rate limiting.
- **Failure scenario**: High-concurrency rollback + new request on same IP/window. Rate limit counter undercounts, allowing more requests than configured. Weakens brute-force protection.
- **Fix**: Wrap UPDATE+DELETE in a transaction, or replace with a single atomic DELETE that includes the decrement condition.
- **Confidence**: High

#### C22-AGG-02: Service Worker HTML cache has no size limit or eviction

- **Source**: `apps/web/public/sw.js:143-178`
- **Cross-agent agreement**: C22-HIGH-02 (code-reviewer), C22-PERF-02 (perf-reviewer), C22-CT-02 (critic) — 3 agents agree
- **Issue**: HTML_CACHE stores every visited HTML page with no entry-count cap. Only time-based eviction (24h). Unlike IMAGE_CACHE which has 50MB LRU, HTML cache grows indefinitely within a version. A user browsing many pages could accumulate a large cache, potentially triggering browser quota eviction that also wipes the image cache.
- **Fix**: Add LRU eviction with conservative cap (e.g., 50 entries or 5MB), mirroring the image cache pattern.
- **Confidence**: High

---

### MEDIUM severity

#### C22-AGG-03: `backfillClipEmbeddings` lacks rate limiting (carry-over C21-AGG-06)

- **Source**: `apps/web/src/app/actions/embeddings.ts:26-89`
- **Cross-agent agreement**: C22-MED-01 (code-reviewer), C22-SEC-03 (security), C22-CT-04 (critic) — 3 agents agree
- **Issue**: While `isAdmin()` and `requireSameOriginAdmin()` were added in cycle 21, the action itself has no invocation rate limiting. An admin (or compromised admin session) can invoke it repeatedly, causing up to 5000 embed operations per call. Creates sustained CPU (SHA-256) and DB write pressure.
- **Fix**: Add a per-admin or global rate limit (e.g., once per hour) using existing in-memory Maps or DB-backed buckets.
- **Confidence**: High

#### C22-AGG-04: Bootstrap cleanup tasks run synchronously on every bootstrap call

- **Source**: `apps/web/src/lib/image-queue.ts:583-585`
- **Cross-agent agreement**: C22-MED-02 (code-reviewer), C22-PERF-01 (perf-reviewer), C22-CT-03 (critic), C22-DEBUG-03 (debugger) — 4 agents agree
- **Issue**: `purgeExpiredSessions`, `purgeOldBuckets`, and `purgeOldAuditLog` execute synchronously on every `bootstrapImageProcessingQueue` call. During active processing with many batches, bootstrap runs repeatedly (every 500 images + continuation). The cleanup functions are idempotent in effect but generate unnecessary DB load. The hourly `gcInterval` (lines 587-592) already handles periodic cleanup.
- **Failure scenario**: During DB recovery, bootstrap retries every 30 seconds. Cleanup runs each time, amplifying load on a recovering system.
- **Fix**: Gate synchronous cleanup to run only once per process lifetime, or only on the first bootstrap.
- **Confidence**: Medium

#### C22-AGG-05: Semantic search client hardcodes `topK: 20`

- **Source**: `apps/web/src/components/search.tsx:79`
- **Cross-agent agreement**: C22-MED-03 (code-reviewer), C22-ARCH-03 (architect), C22-CT-04 (critic) — 3 agents agree
- **Issue**: The search component hardcodes `topK: 20` instead of using the shared `SEMANTIC_TOP_K_DEFAULT` constant from `clip-embeddings.ts`. If the server-side default changes, the client and server will silently disagree.
- **Fix**: Import `SEMANTIC_TOP_K_DEFAULT` and use it.
- **Confidence**: Medium

---

### LOW severity

#### C22-AGG-06: Semantic search settings UI allows `production` without ONNX validation

- **Source**: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:274-286`
- **Issue**: The admin dropdown allows setting `semantic_search_mode` to `production` with no validation that a real ONNX model is installed. An admin can accidentally enable the feature, causing the public endpoint to serve semantically meaningless results to users.
- **Fix**: Add a warning in the admin UI or validate on save that `production` requires model presence.
- **Confidence**: Medium

#### C22-AGG-07: SW HTML cache can cache logged-in state

- **Source**: `apps/web/public/sw.js:233-235`
- **Cross-agent agreement**: C22-SEC-02 (security), C22-DEBUG-02 (debugger) — 2 agents agree
- **Issue**: The SW caches HTML responses without checking for auth cookies. If an admin browses public pages while logged in, cached HTML includes authenticated nav state. A subsequent anonymous visitor on the same device receives the logged-in HTML, leaking the existence of an admin session.
- **Fix**: Bypass cache for requests with `admin_session` cookie, or add `Vary: Cookie` handling.
- **Confidence**: Medium

#### C22-AGG-08: Caption stub may mislead admins

- **Source**: `apps/web/src/lib/caption-generator.ts:32-38`
- **Issue**: The stub returns EXIF-derived strings like "Photo taken with Canon EOS R5" that look like AI-generated captions. Admins may not realize these are placeholders.
- **Fix**: Prefix stub captions with `[AUTO]` or similar marker.
- **Confidence**: Low

#### C22-AGG-09: `decrementRateLimit` docstring falsely claims atomicity

- **Source**: `apps/web/src/lib/rate-limit.ts:422-426`
- **Cross-agent agreement**: C22-DOC-01 (document-specialist)
- **Issue**: The docstring says "this atomically reduces the count" but the implementation is non-atomic. Misleading documentation.
- **Fix**: Update comment to match behavior, or make the function atomic.
- **Confidence**: High

---

## No new regressions detected
- All cycle-21 fixes are clean and stable.
- No new failure modes introduced by recent commits.

## Carry-forward (unchanged — existing deferred backlog)
- C16-HIGH-01: SW metadata cache read-modify-write race — deferred
- C17-ARCH-03: SW metadata store uses single shared JSON blob — deferred
- C17-PERF-02: getImagesLitePage COUNT(*) OVER() — deferred
