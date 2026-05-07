# Code Review — Cycle 22

## Method
Systematic review of all files changed since cycle 21 and targeted deep-dive into open cycle-21 findings. Verified fix status of each prior finding against HEAD.

## Verified Prior Fixes (Cycle 21)

| ID | Status | Evidence |
|----|--------|----------|
| C21-AGG-01 (semantic stub) | FIXED | `semantic_search_mode` enum in gallery-config-shared.ts; route rejects non-production |
| C21-AGG-02 (chunked encoding) | FIXED | `route.ts:81-84` rejects chunked; `route.ts:105-116` reads body as text with cap |
| C21-AGG-03 (quiesce onIdle) | FIXED | `image-queue.ts:609` uses `onIdle` |
| C21-AGG-07 (OG photo buffer) | FIXED | `route.tsx:96-100` post-fetch buffer length check |
| C21-AGG-09 (Content-Type) | FIXED | `route.ts:75-78` validates Content-Type |
| C21-AGG-10 (comment) | FIXED | Comment now reads "returns RANDOM results" |

## Findings

### HIGH

#### C22-HIGH-01: `decrementRateLimit` UPDATE+DELETE race condition (carry-over C21-AGG-04)
- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Issue**: `decrementRateLimit` runs UPDATE then DELETE as two separate SQL statements. Between them, a concurrent `incrementRateLimit` can set count=1 via its atomic `onDuplicateKeyUpdate`. The subsequent DELETE then removes the row, losing the increment. This undercounts rate-limit usage.
- **Fix**: Wrap UPDATE+DELETE in a single transaction, or replace with a single conditional DELETE (`DELETE ... WHERE count <= 1` before decrement, or use `DELETE ... WHERE count <= 0` after a single UPDATE that sets count=count-1).
- **Confidence**: High

#### C22-HIGH-02: Service Worker HTML cache has no entry count limit
- **Source**: `apps/web/public/sw.js:143-178`
- **Issue**: `networkFirstHtml` stores every visited HTML page with no entry-count cap. Only time-based eviction (24h). Unlike IMAGE_CACHE which has a 50MB LRU cap, HTML_CACHE grows indefinitely within a version.
- **Failure scenario**: A user browsing 100+ pages over a day accumulates a large HTML cache. On slow connections or constrained devices, this wastes storage and may trigger browser quota eviction that also wipes the image cache.
- **Fix**: Add LRU eviction with a conservative cap (e.g., 50 entries or 5MB).
- **Confidence**: High

### MEDIUM

#### C22-MED-01: `backfillClipEmbeddings` lacks rate limiting (carry-over C21-AGG-06)
- **Source**: `apps/web/src/app/actions/embeddings.ts:26-89`
- **Issue**: While `isAdmin()` and `requireSameOriginAdmin()` were added in cycle 21, the action itself has no rate limiting. An admin (or compromised admin session) can invoke it repeatedly, causing up to 5000 embed operations per call with bounded concurrency of 2. This creates sustained CPU and DB load.
- **Fix**: Add a per-admin or global rate limit (e.g., once per hour) using the existing in-memory Maps or DB-backed buckets.
- **Confidence**: High

#### C22-MED-02: Bootstrap cleanup tasks run synchronously on every bootstrap call
- **Source**: `apps/web/src/lib/image-queue.ts:583-585`
- **Issue**: `purgeExpiredSessions`, `purgeOldBuckets`, and `purgeOldAuditLog` execute synchronously on every `bootstrapImageProcessingQueue` call. When there are many pending images, bootstrap is called repeatedly (every batch of 500 + continuation). The cleanup functions are idempotent but generate unnecessary DB load. The hourly `gcInterval` (lines 587-592) already handles periodic cleanup; the synchronous calls are redundant.
- **Fix**: Gate the synchronous cleanup to run only once per process lifetime, or only on the first bootstrap.
- **Confidence**: Medium

#### C22-MED-03: Semantic search hardcodes `topK: 20` in client
- **Source**: `apps/web/src/components/search.tsx:79`
- **Issue**: The search component hardcodes `topK: 20` instead of using the shared `SEMANTIC_TOP_K_DEFAULT` constant from `clip-embeddings.ts`. If the server-side default changes, the client and server will disagree.
- **Fix**: Import `SEMANTIC_TOP_K_DEFAULT` and use it.
- **Confidence**: Medium

### LOW

#### C22-LOW-01: Semantic search settings UI allows `production` without ONNX validation
- **Source**: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:274-286`
- **Issue**: The admin dropdown allows setting `semantic_search_mode` to `production` with no validation that a real ONNX model is installed. An admin can accidentally enable the feature, causing the public endpoint to serve random results (even though stub embeddings are deterministic, they are semantically meaningless).
- **Fix**: Add a warning in the UI or validate on save that `production` requires model presence.
- **Confidence**: Medium

#### C22-LOW-02: Caption stub may mislead admins into believing AI is running
- **Source**: `apps/web/src/lib/caption-generator.ts:32-38`
- **Issue**: The stub caption generator returns strings like "Photo taken with Canon EOS R5" which look like AI-generated descriptions. When `auto_alt_text_enabled` is true, admins may not realize these are EXIF-derived stubs.
- **Fix**: Prefix stub captions with `[AUTO]` or similar marker, or add a UI indicator in the admin bulk editor.
- **Confidence**: Low

## Final Sweep
No logic bugs in recently changed search/nav/settings components. No TypeScript errors visible in reviewed files. All prior cycle-21 fixes verified clean.
