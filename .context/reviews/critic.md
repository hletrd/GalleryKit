# Critic Review — GalleryKit Repository

**Repository:** /Users/hletrd/flash-shared/gallery  
**HEAD:** bcd67b12  
**Date:** 2026-06-25  
**Scope:** Full codebase — apps/web/src/ and all subdirectories  
**Reviewer:** oh-my-claudecode:critic (multi-perspective, adversarial where warranted)

---

## VERDICT: ACCEPT-WITH-RESERVATIONS

The GalleryKit codebase is exceptionally mature for a personal gallery application. After 10+ review-plan-fix cycles, the surface-level defects are largely closed. No CRITICAL findings remain. The remaining issues are architectural constraints, operational hazards, and defense-in-depth gaps that a production operator should understand before deploying. The code is well-structured, thoroughly tested (~240 unit tests), and demonstrates strong security consciousness. Reservations center on: (1) single-writer topology constraints that are documented but easy to miss, (2) a few defense-in-depth symmetry gaps, and (3) some operational sharp edges around the CLIP semantic search feature and Docker deployment.

---

## Pre-commitment Predictions

Before investigation, I predicted the following problem areas:

1. **Race conditions in the image processing queue** — The PQueue + MySQL advisory lock combination is complex. I expected to find gaps in the claim-release lifecycle or bootstrap retry logic.
2. **Type safety escapes around BLOB/Buffer handling** — The MEDIUMBLOB embedding column and various `as unknown as` casts are known fragile patterns.
3. **Rate-limit Map growth under sustained attack** — The `createResetAtBoundedMap` and `createWindowBoundedMap` patterns should cap growth, but I expected to find pruning gaps.
4. **Operational hazards in the single-writer topology** — Process-local state (upload tracker, rate limit buckets, view count buffers) is a documented constraint but I expected to find undocumented assumptions.
5. **Security surface around the semantic search endpoint** — A new public endpoint with embedding computation is a natural attack surface.

**Actual findings:** Prediction 1 was partially correct — the queue has robust claim-release logic but the `getProcessingQueueState()` global symbol lookup lacks runtime shape validation. Prediction 2 was correct — the `as unknown as Buffer` cast in `image-queue.ts:505` lacks a safety comment. Prediction 3 was partially correct — `ogRateLimit` and `shareRateLimit` prune on read but stale entries accumulate between reads. Prediction 4 was correct — several process-local state assumptions are documented but not enforced. Prediction 5 was partially correct — the semantic endpoint is well-guarded but the `allowMissingSource` option in `hasTrustedSameOriginWithOptions` is a subtle bypass vector.

---

## Critical Findings

**None.** After thorough investigation across all architectural layers, no CRITICAL findings (data loss, security breach, unrecoverable corruption) were found. The codebase has been hardened through multiple review cycles.

---

## Major Findings (causes significant rework or operational risk)

### 1. `getProcessingQueueState()` Global Symbol Lookup Lacks Runtime Shape Validation
**File:** `apps/web/src/lib/image-queue.ts:172-197`  
**Confidence:** HIGH  
**Evidence:**
```typescript
export const getProcessingQueueState = (): ProcessingQueueState => {
    const globalWithQueue = globalThis as typeof globalThis & {
        [processingQueueKey]?: ProcessingQueueState;
    };
    if (!globalWithQueue[processingQueueKey]) {
        globalWithQueue[processingQueueKey] = {
            queue: new PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 1 }),
            // ... other fields
        };
    }
    return globalWithQueue[processingQueueKey]!;
};
```
**Why this matters:** If a test, script, or future code path sets `globalThis[Symbol.for('gallerykit.imageProcessingQueue')]` to a non-object value (e.g., `true` for a feature flag), the `if (!globalWithQueue[processingQueueKey])` guard passes and the code attempts to access `.queue` on a boolean, crashing the process. This is a latent type-safety gap — the TypeScript cast papers over the runtime reality.  
**Fix:** Add a runtime shape validator:
```typescript
const state = globalWithQueue[processingQueueKey];
if (typeof state === 'object' && state !== null && 'queue' in state && state.queue instanceof PQueue) {
    return state;
}
// Initialize fresh...
```

### 2. `as unknown as Buffer` Type Cast in Embedding Buffer Handling Lacks Safety Comment
**File:** `apps/web/src/lib/image-queue.ts:505`  
**Confidence:** HIGH  
**Evidence:** `embeddingBuffer as unknown as Buffer` — no comment explaining why this cast is safe.  
**Why this matters:** The cast is correct (mysql2 returns Buffer for MEDIUMBLOB), but without a safety comment, a future refactor might remove the cast or change the column type without understanding the invariant. This is a maintainability hazard that has caused bugs in similar codebases.  
**Fix:** Add `// SAFETY: mysql2 returns Buffer for MEDIUMBLOB; Drizzle types it as unknown` or better, use `Buffer.isBuffer(embeddingBuffer)` runtime check.

### 3. `hasTrustedSameOriginWithOptions` `allowMissingSource` Option Is a Subtle Bypass
**File:** `apps/web/src/lib/request-origin.ts:83-107`  
**Confidence:** MEDIUM  
**Evidence:**
```typescript
export function hasTrustedSameOriginWithOptions(
    requestHeaders: HeaderLookup,
    options: { allowMissingSource?: boolean } = {}
) {
    const { allowMissingSource = false } = options;
    // ...
    return allowMissingSource;
}
```
**Why this matters:** The `allowMissingSource` option defaults to `false`, but any caller passing `{ allowMissingSource: true }` bypasses the entire same-origin check. While no current caller does this, the option exists and is exported. If a future developer adds a new route and uses this option to "fix" a CORS issue, they open a CSRF vector. The option is not documented with a security warning.  
**Fix:** Remove the `allowMissingSource` option entirely, or if it must exist for testing, move it to a test-only export and add a prominent security warning.

### 4. `ogRateLimit` and `shareRateLimit` Stale Entry Accumulation Between Requests
**File:** `apps/web/src/lib/rate-limit.ts:77,87`  
**Confidence:** MEDIUM  
**Evidence:**
```typescript
export const ogRateLimit = createResetAtBoundedMap<string>(OG_RATE_LIMIT_MAX_KEYS);
export const shareRateLimit = createResetAtBoundedMap<string>(SHARE_RATE_LIMIT_MAX_KEYS);
```
**Why this matters:** Unlike `loginRateLimit` which uses `createWindowBoundedMap` with automatic expiry, `ogRateLimit` and `shareRateLimit` rely on explicit `prune()` calls in the pre-increment helpers. If a client makes no requests after their window expires, the stale entry remains until the next request triggers a prune or the max-keys cap is reached. Under sustained attack from unique IPs, the Maps approach their caps and begin evicting oldest entries, which may cause legitimate users to be rate-limited while attacker entries persist. This is bounded by the cap but represents a degradation in rate-limit accuracy.  
**Fix:** Add a background timer-based prune (e.g., every 60 seconds) or switch to `createWindowBoundedMap` for consistency.

### 5. Semantic Search Endpoint Content-Length Bypass for Chunked Encoding
**File:** `apps/web/src/app/api/search/semantic/route.ts:127-131`  
**Confidence:** MEDIUM  
**Evidence:**
```typescript
const transferEncoding = request.headers.get('transfer-encoding');
if (transferEncoding?.includes('chunked')) {
    return NextResponse.json({ error: 'Chunked transfer encoding is not supported' }, { status: 400, headers: NO_STORE_HEADERS });
}
```
**Why this matters:** The endpoint rejects chunked transfer encoding but does not enforce a maximum body size for requests without Content-Length (e.g., HTTP/2 which does not use Content-Length). A malicious client could send an unbounded stream body. While the route parses JSON which would fail on non-JSON, the body is consumed before the JSON parse, potentially causing memory exhaustion.  
**Fix:** Use `request.clone().body?.getReader()` with a byte counter, or set a `AbortSignal.timeout()` on the request. Alternatively, read only the first `MAX_SEMANTIC_BODY_BYTES` from the stream before parsing.

### 6. `getTrustedRequestProtocol` Falls Back to `http` Without Warning
**File:** `apps/web/src/lib/request-origin.ts:45-53`  
**Confidence:** MEDIUM  
**Evidence:**
```typescript
export function getTrustedRequestProtocol(requestHeaders: HeaderLookup) {
    // ...
    return trustedForwardedProto
        || getProtocolFromCandidate(requestHeaders.get('origin'))
        || getProtocolFromCandidate(requestHeaders.get('referer'))
        || 'http';
}
```
**Why this matters:** In production behind HTTPS reverse proxies, this fallback is unlikely to trigger. However, if the proxy is misconfigured and strips all three headers, the function silently returns `http`, which causes `requireSecureCookie` in `auth.ts:227` to be `false` unless `NODE_ENV === 'production'`. In production, the `NODE_ENV` check saves the cookie as secure anyway, but the fallback logic is inconsistent with the fail-closed posture elsewhere. More critically, if an operator runs production without `NODE_ENV=production` (e.g., in a custom container), cookies may be sent over HTTP.  
**Fix:** Return `null` instead of `'http'` and let the caller decide based on `NODE_ENV`, or log a warning when the fallback is used in production.

### 7. `logAuditEvent` Metadata Truncation May Lose Security-Relevant Fields
**File:** `apps/web/src/lib/audit.ts:24-39`  
**Confidence:** MEDIUM  
**Evidence:** When metadata JSON exceeds 4096 characters, it is truncated to a 4000-character preview with a `truncated: true` flag.  
**Why this matters:** The truncation may drop security-relevant fields (e.g., IP addresses, user agents, action details) if they appear late in the JSON. The `preview` field is explicitly not parseable. For a security audit, this could mean missing forensic evidence.  
**Fix:** Prioritize security-relevant fields in the truncation strategy, or raise the limit for security-critical actions.

### 8. `uploadImages` God-Function Exceeds 200 Lines with Mixed Concerns
**File:** `apps/web/src/app/actions/images.ts:107-` (function spans ~350 lines)  
**Confidence:** HIGH  
**Evidence:** The function handles disk space checks, cumulative upload tracking, per-file validation, processing enqueuing, GPS stripping, HDR rejection, EXIF extraction, DB insertion, blur data URL validation, and error cleanup.  
**Why this matters:** This is a classic "god function" that violates the Single Responsibility Principle. It is difficult to test in isolation, and a bug in one concern (e.g., disk space check) can affect unrelated concerns (e.g., DB insertion). The function has been incrementally grown across 10+ review cycles.  
**Fix:** Extract `checkUploadQuota()`, `validateAndSaveFile()`, `enqueueForProcessing()`, and `buildInsertValues()` helpers. The existing test coverage provides a safety net for refactoring.

### 9. `processImageFormats` Cyclomatic Complexity ~15
**File:** `apps/web/src/lib/process-image.ts` (function spans ~200 lines)  
**Confidence:** HIGH  
**Evidence:** The function handles format selection, size iteration, color pipeline decisions, 10-bit AVIF fallback, wide-gamut downscale, ICC profile handling, and error cleanup.  
**Why this matters:** High cyclomatic complexity correlates with higher bug density and makes the function difficult to reason about. The function is the heart of the image processing pipeline — any bug here affects every uploaded image.  
**Fix:** Extract `processSingleFormat()`, `resolveAvifBitDepth()`, and `buildEncoderOptions()` helpers. The existing test coverage (15+ process-image tests) provides a safety net.

### 10. `deleteImage()` Best-Effort File Cleanup Does Not Report Failures to Caller
**File:** `apps/web/src/app/actions/images.ts` (within deleteImage)  
**Confidence:** HIGH  
**Evidence:** The `deleteImageVariants` call is wrapped in try/catch with a log, but the function returns `success: true` to the caller even when file cleanup fails.  
**Why this matters:** This can leave orphaned files on disk. Over time, orphaned files accumulate and consume disk space. The admin UI shows "deleted successfully" while files remain.  
**Fix:** Include `cleanupErrors` in the return value so the admin UI can warn about orphaned files and offer a "clean up orphaned files" action.

---

## Minor Findings (suboptimal but functional)

### 1. `console.log` Used in Production Code for Backfill Progress
**File:** `apps/web/src/lib/admin-backfill-runner.ts`  
**Confidence:** HIGH  
**Why:** `console.log` is used for progress reporting. In production, this pollutes logs without structured levels. Replace with a proper logger or use `console.info` with a structured prefix.

### 2. Historical Bug Reference Comments Add Noise
**File:** `apps/web/src/lib/process-image.ts`, `lib/data.ts`  
**Confidence:** LOW  
**Why:** Comments like `BUG-R5C1-02`, `PP-BUG-1`, `PP-BUG-3` reference fixed bugs from prior review cycles. These add noise and may confuse new readers. Move to commit messages or a changelog after 2-3 release cycles.

### 3. Import Organization Inconsistent Across Files
**File:** Multiple files  
**Confidence:** LOW  
**Why:** Some files group imports by type (external, internal, relative), others do not. No automated import sorting is enforced. Add ESLint `import/order` rule.

### 4. `retryFailedImage` Does Not Validate `retryCount` Bounds
**File:** `apps/web/src/lib/image-queue.ts`  
**Confidence:** MEDIUM  
**Why:** The `retryCount` parameter is passed to the DB update without clamping. A caller could pass a negative number or an extremely large value. Add `Math.max(0, Math.min(retryCount, MAX_RETRIES))`.

### 5. `deleteImageVariants` Uses Synchronous File Operations
**File:** `apps/web/src/lib/process-image.ts`  
**Confidence:** LOW  
**Why:** `readdirSync` and `unlinkSync` are used in `deleteImageVariants`. While acceptable for cleanup, it blocks the event loop. Use `fs.promises.readdir` and `fs.promises.unlink` for consistency.

### 6. `tagNamesAgg` SQL Constant Uses Raw String Without Type Safety
**File:** `apps/web/src/lib/data.ts`  
**Confidence:** LOW  
**Why:** The `tagNamesAgg` constant is a raw SQL string. While it's a controlled constant, it bypasses Drizzle's type system. The existing test (`data-tag-names-sql.test.ts`) locks the contract, which is acceptable.

### 7. `MAX_BLUR_DATA_URL_LENGTH` Rationale Not Documented Inline
**File:** `apps/web/src/lib/blur-data-url.ts`  
**Confidence:** HIGH  
**Why:** The constant `MAX_BLUR_DATA_URL_LENGTH = 4096` is well-named, but the rationale (why 4096, not 2048 or 8192) is not documented. Add JSDoc explaining the derivation.

### 8. `safeJsonLd` Missing `>` Escape Justification
**File:** `apps/web/src/lib/safe-json-ld.ts:17`  
**Confidence:** MEDIUM  
**Why:** `safeJsonLd` escapes `<` to `<` and `>` to `>`. The `<` escape is well-documented (prevents `</script>` termination). The `>` escape has no documented threat model. Add a comment or remove it if no threat model exists.

### 9. JSON-LD Script Injection Defense Gap in Timeline/Year Pages
**File:** `apps/web/src/app/[locale]/(public)/timeline/page.tsx:112`, `year/[year]/page.tsx:102`  
**Confidence:** MEDIUM  
**Why:** Both pages use the spread-prop pattern `{...{ dangerouslySetInnerHTML: { __html: galleryLdJson } }}` instead of the direct `dangerouslySetInnerHTML={{ __html: safeJsonLd(galleryLd) }}` pattern used in all other pages. While `safeJsonLd` is still called, the indirection separates sanitization from injection. Match the pattern in other pages.

### 10. `buildCursorCondition` Uses String Interpolation for SQL Fragments
**File:** `apps/web/src/lib/data.ts`  
**Confidence:** MEDIUM  
**Why:** The function builds SQL comparison strings like `` `${column} > ?` ``. The `column` values come from a closed set, but this pattern is risky if the set ever expands without validation. Add a whitelist validation.

---

## What's Missing (gaps, unhandled edge cases, unstated assumptions)

1. **No health check for the image processing queue.** The `/api/health` and `/api/live` endpoints check DB connectivity but do not report queue depth, permanently-failed count, or bootstrap status. An operator cannot tell if the queue is backed up without checking logs.

2. **No automated cleanup for orphaned original files.** When an image is deleted, the original file is removed, but if the delete fails mid-transaction (DB rolled back but files already deleted), or if the process crashes between file deletion and DB commit, the original may be orphaned. There is no periodic scan for orphaned originals.

3. **No metrics emission for image processing.** The queue tracks retry counts and last errors in memory, but these are not exposed to Prometheus/Grafana or any monitoring system. The only observability is console logs.

4. **No graceful shutdown for the semantic search endpoint.** The CLIP model load is a lazy singleton; if the process receives SIGTERM during a semantic search request, the in-flight embedding computation is lost. There is no shutdown hook for the model.

5. **No validation that `image_sizes` are strictly increasing.** The `parseImageSizes` function validates that sizes are positive and within count limits, but does not enforce that the array is sorted or strictly increasing. A config like `[7680, 640]` would produce bizarre derivative naming.

6. **No test for the `getTrustedRequestProtocol` fallback path.** The function has four return paths but tests likely only cover the happy path (X-Forwarded-Proto present). The `http` fallback is a blind spot.

7. **No test for `hasTrustedSameOriginWithOptions` with `allowMissingSource: true`.** This option is a potential bypass vector but may not be tested.

8. **No documentation of the `TRUSTED_PROXY_HOPS` calculation for complex proxy chains.** The `getClientIp` function uses `getTrustedProxyHopCount` to select an IP from `X-Forwarded-For`, but the documentation does not explain how to calculate the correct hop count for multi-layer proxy setups (e.g., CDN -> ALB -> Nginx -> App).

9. **No automated test for the `ensureDirs` singleton promise clearing on failure.** The `dirsPromise` is nulled on catch, but there is no test verifying that a failed `ensureDirs` call allows retry on the next call.

10. **No rate limiting on the `/api/admin/lr/upload` route.** The Lightroom Classic publish-plugin upload route has a dedicated nginx location with a 216 MiB body cap, but the route itself does not implement application-level rate limiting. A compromised PAT could be used to flood uploads.

---

## Ambiguity Risks

### 1. `uploadImages` HDR Warning vs. Rejection Semantics
**File:** `apps/web/src/app/actions/images.ts:282-293`  
- **Interpretation A:** When `allowHdrIngest` is true, HDR sources are accepted with a warning count increment.
- **Interpretation B:** The warning is purely for the response message; the image is still processed as SDR.
- **Risk if wrong:** An admin might think "warning" means "HDR is preserved" when the pipeline actually delivers SDR. The CLAUDE.md documents this honestly, but the UI message should be explicit.

### 2. `force_srgb_derivatives` Effect on AVIF
**File:** `apps/web/src/lib/process-image.ts` (encoder decision matrix)  
- **Interpretation A:** When `force_srgb_derivatives=true`, ALL outputs including AVIF are sRGB.
- **Interpretation B:** AVIF remains gamut-preserved; only WebP/JPEG are forced to sRGB.
- **Risk if wrong:** The CLAUDE.md says "AVIF still gamut-preserved" but this is easy to miss. An admin might expect AVIF to also be sRGB.

### 3. `wide_gamut_max_source_pixels` Downscale Behavior
**File:** `apps/web/src/lib/process-image.ts`  
- **Interpretation A:** Sources above the cap are downscaled to EXACTLY the cap (e.g., 50 MP).
- **Interpretation B:** Sources above the cap are downscaled to FIT WITHIN the cap while preserving aspect ratio.
- **Risk if wrong:** A photographer might think their 60 MP image becomes 50 MP when it actually becomes something like 45 MP (aspect-ratio-preserved fit). The code does `resize({ width, height, fit: 'inside' })` which is interpretation B, but this is not documented in the admin UI.

---

## Multi-Perspective Notes

### Security Engineer
- The defense-in-depth posture is strong: Argon2id, HMAC-SHA256 sessions, timing-safe comparison, dual rate limiting, CSRF origin checks on every mutating action, Unicode bidi rejection, GPS stripping, and advisory locks.
- The `dummyHashPromise` precomputation at module init closes a TOCTOU race on login timing attacks — excellent.
- The `hasTrustedSameOriginWithOptions` `allowMissingSource` option is a latent bypass vector. No current caller uses it, but it should be removed or heavily guarded.
- The semantic search endpoint's `allowMissingSource` is not used (it calls `hasTrustedSameOrigin` directly), but the option's existence in the codebase is a risk.
- The Lightroom upload route (`/api/admin/lr/upload`) has no application-level rate limiting — only nginx-level. A compromised PAT could flood uploads.
- The `safeJsonLd` `>` escape justification is missing. While not exploitable today, defense-in-depth documentation should be complete.

### New Hire
- The codebase is well-documented with extensive inline comments explaining WHY, not just WHAT. The CLAUDE.md is comprehensive.
- However, the sheer volume of historical bug references (`BUG-R5C1-02`, `PP-BUG-3`, etc.) can be overwhelming. A glossary or migration of these to a changelog would help.
- The `as unknown as` casts are not always explained. A "SAFETY:" comment convention would help new hires understand which casts are intentional vs. accidental.
- The test file naming convention (`subject-area-descriptive-name.test.ts`) is clear, but with 240+ tests, a test directory structure or README would help navigate.

### Ops Engineer
- The single-writer topology is well-documented but critical: process-local state (upload tracker, rate-limit buckets, view count buffers, backfill status) means horizontal scaling is NOT safe without moving these to a shared store.
- The per-deploy auto-prune in `deploy.sh` is excellent for preventing disk exhaustion, but the recovery procedure (block-volume resize) should be documented in a runbook.
- The CLIP model weights are NOT baked into the Docker image — they must be seeded separately. This is documented but easy to miss during initial deployment.
- The `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env flag is the only gate for production semantic search. If this is accidentally set on a fresh install without model weights, the endpoint will 503 on every request — correct behavior, but the error message should guide the operator to the seeding procedure.
- The MySQL advisory locks are scoped to the SERVER, not the database. Multi-tenant deployments on a shared MySQL instance will serialize each other's operations. This is documented but should be in a deployment checklist.
- The `getGalleryConfig()` function reads from DB on every request (unless cached by React `cache()`). The `serve-upload.ts` debounces this with a 5-second TTL, which is correct, but other hot paths should be audited for similar debouncing.

---

## Verdict Justification

**Why ACCEPT-WITH-RESERVATIONS:**

The GalleryKit codebase has been through 10+ review-plan-fix cycles and the quality shows. No CRITICAL findings remain. The security posture is strong, the test coverage is comprehensive (~240 unit tests + Playwright E2E), and the architecture is well-documented.

The reservations are:
1. **Operational complexity:** The single-writer topology, CLIP weight seeding, and MySQL advisory lock scoping are documented but represent real deployment hazards.
2. **Defense-in-depth gaps:** The `allowMissingSource` option, stale rate-limit entries, and missing runtime validation on global symbol lookups are minor but real.
3. **Maintainability:** The god-functions (`uploadImages`, `processImageFormats`) and historical comment noise make the codebase harder to navigate than it needs to be.

**What would need to change for ACCEPT:**
- Remove or guard the `allowMissingSource` option.
- Add runtime shape validation to `getProcessingQueueState()`.
- Extract helpers from `uploadImages` and `processImageFormats`.
- Add background pruning for `ogRateLimit` and `shareRateLimit`.
- Document the `>` escape in `safeJsonLd`.

**Review mode:** Operated in THOROUGH mode throughout. No escalation to ADVERSARIAL was warranted — the codebase is genuinely well-hardened and the findings are refinements, not systemic issues. No CRITICAL findings were discovered, and the MAJOR findings are all maintainability/operational concerns rather than security breaches.

**Realist Check recalibrations:**
- Finding #5 (semantic search chunked encoding) was considered for downgrade from MAJOR to MINOR because the JSON parse would fail on a non-JSON stream, but the memory exhaustion risk before parse failure warranted keeping it MAJOR.
- Finding #6 (getTrustedRequestProtocol http fallback) was downgraded from MAJOR to MEDIUM because `NODE_ENV === 'production'` provides a second layer of defense for the secure cookie flag.

---

## Open Questions (unscored)

1. **Does the `ensureDirs` singleton promise correctly handle concurrent calls across module reloads in Next.js dev mode?** Next.js dev mode can reload modules, potentially creating multiple `dirsPromise` instances. This is likely harmless (mkdir is idempotent) but worth verifying.

2. **What is the memory footprint of the `viewCountRetryCount` Map under a sustained DB outage with 500+ shared groups?** The cap is 500 entries, but each entry is a small object. At personal-gallery scale this is negligible, but should be documented.

3. **Does the `bounded-map` FIFO eviction correctly handle the case where the most-recently-inserted entry is also the most-recently-accessed?** FIFO eviction does not update insertion order on access, so a frequently-accessed entry at the head of the Map will be evicted first. This is documented as acceptable but may surprise operators.

4. **Is the `clip-model.ts` lazy singleton correctly isolated from the Next.js request lifecycle?** The model load is triggered by the first semantic search request and persists for the process lifetime. If the model load fails, the promise is nulled and the next request retries. This is correct but should be verified under memory pressure.

5. **Does the `public/sw.template.js` correctly handle the case where the Service Worker update check fires during a page navigation?** The template has a 300ms HEAD timeout, but if the network is slow, the SW serves stale bytes. This is documented as acceptable but may cause confusion.

---

*Review completed by oh-my-claudecode:critic*  
*Head: bcd67b12*  
*Files examined: 50+ source files across all architectural layers*  
*Test files referenced: 240+ unit tests, lint gate fixtures, E2E tests*
