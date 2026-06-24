# Test-Engineer Review — GalleryKit Test Suite (Cycle 8)

> **Date:** 2026-06-25
> **HEAD:** 87065049
> **Scope:** `apps/web/src/__tests__/` (225 test files), `apps/web/e2e/` (5 spec files), `apps/web/scripts/` (26 scripts)
> **Test Runner:** Vitest 4.1.9
> **Current Status:** 225 test files passed, 2 skipped, 2064 tests, 85s duration

---

## 1. Executive Summary

The GalleryKit test suite continues to be extensive and well-maintained, with **225 unit test files** and **5 E2E spec files** covering a broad surface. All tests pass (225 files, 2064 tests, 0 failures). Since the Cycle 7 review (HEAD 1d5545cb), several test improvements landed:

- **TEST-01:** Fixed racy `setImmediate` drain in `admin-backfill-runner-leak.test.ts` (first test only — second test still uses `setImmediate`)
- **TE-R9C1-01/02:** Added upload-tracker-state and upload-processing-contract-lock tests
- **TE-R9C3-01:** Hardened upload-tracker-state isolation with `beforeAll`
- **C4-A6:** Fixed db-pool test for Promise.race pattern
- **DEF-R9C7-01:** Fixed dead caption mock target in settings-wiring test
- **AGG-R7C4-01/AGG-R7C5-01:** Added NCLX matrix code coverage tests
- **FIND-R8C1-04:** Added free-download contract test

**Test Health:** HEALTHY with targeted gaps

**Key Strengths:**
- Excellent fixture-style lint gates (`check-action-origin`, `check-api-auth`, `check-public-route-rate-limit`, `touch-target-audit`) that prevent architectural regressions
- Comprehensive color/HDR pipeline tests (17+ test files, real Sharp integration)
- Thorough backfill runner coverage (9 dedicated test files with regression annotations)
- Good security test coverage for rate limiting, origin validation, and input sanitization
- Strong test documentation — each test file references the commit/defect it guards against

**Critical Gaps Remaining:**
- `lib/gps-exif-strip.ts` — NO direct unit tests for the byte-level GPS stripping functions (privacy-critical, ~600 lines of binary parsing)
- `lib/data.ts` — NO behavioral tests for any data access function (only fixture-style SQL contract tests)
- `app/actions/auth.ts` — NO direct unit tests for login/logout actions (most critical security gap)
- `app/actions/settings.ts` — NO test file exists
- `app/actions/embeddings.ts` — NO test file exists
- `lib/audit.ts` — NO tests for `logAuditEvent()` write path
- `lib/session.ts` — NO tests for `getSessionSecret()` (the 4-case env/DB fallback logic)
- E2E: Only Chromium, single-worker, no offline/SW tests, no semantic search E2E, no cross-browser coverage
- Several recently fixed bugs have NO regression tests (see Section 5)

---

## 2. Coverage Gap Analysis

### 2.1 Untested Critical Source Files

| File | Lines | What It Does | Why Untested | Risk |
|------|-------|-------------|--------------|------|
| `src/lib/gps-exif-strip.ts` | ~600 | Lossless byte-level GPS metadata removal for JPEG, TIFF, ISOBMFF, WebP | Complex binary parsers; no synthetic fixtures | **CRITICAL** — Privacy-critical GPS stripping is untested at the unit level. The `strip-gps-from-original.test.ts` only tests the action-level wiring (calls `stripGpsFromOriginal`), not the actual byte-surgery functions (`stripGpsFromJpegBuffer`, `stripGpsFromTiffBuffer`, `stripGpsFromIsobmffBuffer`, `stripGpsFromWebpBuffer`, `stripGpsFromTiffRegion`). |
| `src/lib/data.ts` | ~1666 | Core data access layer: image queries, pagination, search, shared groups, view counts | Complex Drizzle queries; would need DB mock | **CRITICAL** — The entire app's data flows through here. Only fixture-style SQL contract tests exist (`data-tag-names-sql.test.ts`, `data-view-count-flush.test.ts`, etc.). No behavioral tests for `getImage`, `getImagesLite`, `searchImages`, `getSharedGroup`, `getMapImages`, `flushGroupViewCounts`, etc. |
| `src/lib/audit.ts` | ~78 | Fire-and-forget audit log writer + purge | Simple but best-effort; write path untested | **HIGH** — `audit-retention.test.ts` only tests `purgeOldAuditLog`. No tests for `logAuditEvent` (metadata serialization, truncation at 4096 bytes, surrogate-pair-safe slicing, JSON stringify failure fallback). |
| `src/app/actions/auth.ts` | ~250 | Login, logout, password change server actions | Would need Argon2 + DB mock + cookie mock | **HIGH** — The most security-critical untested code. `session.test.ts` and `auth-rate-limit.test.ts` test helpers, but the actual login action (password verification, session creation, cookie setting, rate limit integration) has no unit test. |
| `src/app/actions/settings.ts` | ~200 | Admin settings CRUD with color-impacting validation | No test file exists | **HIGH** — Settings changes affect the image processing pipeline. No behavioral tests for validation, persistence, or the settings-hash invalidation. |
| `src/app/actions/embeddings.ts` | ~150 | CLIP embedding management actions | No test file exists | **MEDIUM** — Semantic search feature actions untested. |
| `src/lib/session.ts` | ~151 | Session token generation, verification, secret management | `getSessionSecret` is async with DB fallback | **HIGH** — `session.test.ts` tests `hashSessionToken` and `generateSessionToken` format. `session-verify.test.ts` tests `verifySessionToken` with mocked DB. **Missing**: `getSessionSecret` (the 4-case env/DB fallback logic), race condition on concurrent calls, caching behavior. |
| `src/lib/image-queue.ts` | ~700 | PQueue-based image processing, bootstrap scan, hooks | Complex async orchestration | **HIGH** — Many tests exist but major gaps: `cleanOrphanedTmpFiles` (no tests), `purgeExpiredSessions` (no tests), `bootstrapProcessingQueue` / `continueBootstrapScan` (only enqueue wiring tested), `enqueueImageProcessing` claim retry path (lines 274-298), caption/embedding fire-and-forget hooks (lines 429-512). |
| `src/lib/process-image.ts` | ~1200 | Image upload, EXIF extraction, color pipeline, format conversion | Complex pipeline with many branches | **HIGH** — Many tests exist but missing: `saveOriginalAndGetMetadata` full path (disk full, EXIF reader error, blur failure fallback), `processImageFormats` full integration (DCI-P3 path, 10-bit AVIF fallback on encode failure, wide-gamut downscale intermediate, per-format fresh sharp isolation), `deleteImageVariants` with directory scan, `getSafeExtension` / `RawFileError`, `ensureDirs` singleton, `clampUtf8Bytes` / `cleanMetadataString`, `parseExifDateTime` timezone handling. |
| `src/lib/auth-rate-limit.ts` | ~140 | Account-scoped and password-change rate limiting | `passwordChangeRateLimit` Map untested | **MEDIUM** — `auth-rate-limit.test.ts` covers entry getters and record/clear/rollback. **Missing**: `pruneAccountLoginRateLimit`, `passwordChangeRateLimit` usage (no tests for the password change rate limit path at all). |
| `src/lib/analytics.ts` | ~182 | Bot detection, GeoIP, referrer sanitization | Partial coverage | **MEDIUM** — `analytics.test.ts` covers `extractTldPlusOne`, `sanitizeReferrerHost`, `isBot`, `lookupCountry`. **Missing**: `getSiteHost` (invalid URL error handling), `isPrivateHost` (IPv6 bracket stripping, loopback detection), `sanitizeReferrerHost` edge cases (non-http protocols, extremely long TLD+1 >128 chars). |

**Confidence: High** — These are genuinely critical untested files identified by reading the actual source code and comparing against the test inventory.

### 2.2 Untested Components (React)

| Component | Risk | What's Missing |
|-----------|------|----------------|
| `components/photo-viewer.tsx` | **Medium** | Blur placeholder rendering, color details accordion, download button wiring. Only e2e-tested. |
| `components/home-client.tsx` | **Medium** | Masonry grid, load-more integration, locale switching. Only e2e-tested. |
| `components/image-manager.tsx` | **Medium** | Bulk operations, table sorting, pagination. No tests at all. |
| `components/admin-user-manager.tsx` | **Medium** | Admin CRUD UI. No tests at all. |
| `components/bulk-edit-dialog.tsx` | **Low** | Bulk edit modal. No tests at all. |
| `components/nav-client.tsx` | **Low** | Navigation with locale switcher. No tests at all. |
| `components/wide-gamut-hint.tsx` | **Low** | P3 display hint. No tests at all. |
| `components/similar-photos.tsx` | **Low** | Similar photos carousel. No tests at all. |
| `components/on-this-day-widget.tsx` | **Low** | On-this-day widget. No tests at all. |

**Confidence: Medium** — These are React components that are covered by E2E tests, but unit/component tests would catch regressions faster and with better isolation.

### 2.3 Untested Scripts (19 of 26, 26.9% coverage)

| Script | Risk | Why Test | Suggested Approach |
|--------|------|----------|------------------|
| `scripts/init-db.ts` | **High** | DB initialization; wrong SQL = broken deploy | Unit test: verify SQL execution order, error handling |
| `scripts/seed-admin.ts` | **High** | Creates first admin; wrong hash = lockout | Test Argon2 hash generation, validation of required env vars |
| `scripts/backfill-clip-embeddings.ts` | **Medium** | CLIP backfill; runs in production | Test CLI arg parsing, production mode gating, error paths |
| `scripts/backfill-color-pipeline.ts` | **Medium** | Color pipeline backfill sidecar | Test advisory lock acquisition, batching logic (in-app runner is tested, sidecar is NOT) |
| `scripts/build-sw.ts` | **Medium** | SW version stamping | Test git-SHA + pipeline-version concatenation, template replacement |
| `scripts/download-clip-models.ts` | **Medium** | Model weight download | Test URL construction, retry logic, path validation |
| `scripts/migrate.js` | **Medium** | Schema migration | Test journal monotonicity, hash validation, reconcile logic (partially covered by fixture tests) |

**Confidence: High** — The 7 high/medium risk scripts above are genuine gaps.

---

## 3. Flaky Tests and Race Conditions

### 3.1 PARTIALLY FIXED — `admin-backfill-runner-leak.test.ts`

**File:** `src/__tests__/admin-backfill-runner-leak.test.ts`
**Confidence:** HIGH
**Status:** First test fixed (TEST-01, commit 730208ff), second test still racy.

**First test (lines 98-150):** FIXED — now uses `vi.waitFor(() => state.running === false && state.lastError !== null, { timeout: 5000, interval: 10 })` instead of `setImmediate` x2.

**Second test (lines 153-194):** STILL FLAKY — uses `await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));` at lines 173-174. This is the same racy pattern that the first test had. Under CPU contention, the fire-and-forget runner's catch+finally may not complete within 2 ticks.
**Fix:** Replace with `vi.waitFor(() => !readAdminBackfillState().running, { timeout: 5000 })`, consistent with the first test and all other backfill runner tests.

### 3.2 CONFIRMED FLAKY — `image-queue-bootstrap.test.ts` (NOT FIXED)

**File:** `src/__tests__/image-queue-bootstrap.test.ts`
**Confidence:** HIGH
**Issue:** Two tests timeout at 15000ms under full-suite load. `vi.doMock` with `vi.resetModules()` is slow under parallel load. The continuation test uses `vi.waitFor` with 20s timeout but still fails when CPU is contended by sharp/clip/db transitive import graphs. The `vi.waitFor` with 20s timeout races against the test runner's own 15s default timeout.
**Specific failing tests:**
- "caps each bootstrap pass and schedules a continuation for large backlogs" (line 131)
- "continues scanning after the previous batch cursor so later rows are not starved" (line 153)
**Recommended fixes:**
1. Use `vi.useFakeTimers()` for ALL bootstrap tests (the third test uses this and passes reliably)
2. Isolate the file to serial execution (`describe.sequential`)
3. Increase timeout to 30s+ or mark as `test.skip` under CI
4. Reduce the batch size in tests from 500 to 50 (same behavior, less mock overhead)

### 3.3 Throw-Based `vi.waitFor` Anti-Pattern (4 locations)

**Files:** `admin-backfill-runner-detection-failure.test.ts:178-185`, `admin-backfill-runner-deleted-mid-reencode.test.ts:199-206`, `admin-backfill-runner-fatal-counters.test.ts:196-203` and `288-297` and `363-370`
**Confidence:** MEDIUM
**Issue:** The `vi.waitFor` callback throws when the condition is NOT met, relying on vitest's internal retry logic. This produces noisy error logs on every retry interval. The 20s timeout is excessive for a unit test.
**Fix:** Use `await vi.waitFor(() => expect(readAdminBackfillState().running).toBe(false), { timeout: 5000 })` for cleaner assertion failure messages.

### 3.4 `data-tag-names-sql.test.ts` — 30s Timeout Masks Import-Time Flakiness

**File:** `src/__tests__/data-tag-names-sql.test.ts:244-267`
**Confidence:** HIGH
**Issue:** The test comment documents that this test flakes under "full-suite parallel test load" because cold-importing `drizzle-orm`, `drizzle-orm/mysql-proxy`, and `../db/schema` occasionally exceeds 5000ms. The fix was to bump the timeout to 30s. This is a band-aid — the root cause is dynamic imports of heavy modules inside a test. The test is order-dependent: if drizzle-orm was already imported by a prior test, this test runs fast; if it's the first to import it, it may take 5-15s.
**Fix:** Pre-import the heavy modules at the top level (or in a `beforeAll`) so the cold-start cost is paid once and predictable.

### 3.5 `process-image-color-roundtrip.test.ts` — Sharp/AVIF Encode Variability

**File:** `src/__tests__/process-image-color-roundtrip.test.ts`
**Confidence:** MEDIUM
**Issue:** Pixel values shift with encoder quantization. The test uses generous tolerance (~25 codes) + conditional 10-bit probe. On a CI runner without libheif 10-bit support, the test takes the 8-bit fallback path, which is tested but the 10-bit path is NOT tested on such runners.
**Fix:** Consider splitting into two tests: one for 8-bit fallback (always runs) and one for 10-bit (skipped when libheif unavailable).

### 3.6 Potential Remaining Flaky Patterns

| Test File | Risk | Why |
|-----------|------|-----|
| `clip-semantic-integration.test.ts` | Medium | ONNX runtime model loading is non-deterministic in timing; may timeout on slow runners |
| `e2e/admin.spec.ts` | Medium | Upload workflow depends on external file system and image processing queue; 30s timeout may be tight under load |
| `rate-limit-db.test.ts` | Medium | DB-backed rate limit tests depend on MySQL being available; may fail in CI if DB is not ready |
| `process-image-exif-strip.test.ts` | Low | `afterAll` cleans up files by `generatedIds` list; if a test fails mid-run, the list may be incomplete |

---

## 4. Tests That Don't Actually Assert Correctness

### 4.1 Tests That Only Check Format, Not Cryptographic Correctness

**File:** `src/__tests__/session.test.ts:24-44`
**Confidence:** HIGH
**Code:** Tests that `generateSessionToken` produces `timestamp:random:signature` format.
**Issue:** The test verifies the token's STRUCTURE but does NOT verify that the signature is actually a valid HMAC-SHA256 of the timestamp and random parts. A broken implementation returning `timestamp:random:0000...0000` (64 zeros) would pass this test.
**Fix:** Add an assertion that splits the token, recomputes `HMAC-SHA256(timestamp + ":" + random, secret)`, and asserts it matches the signature part.

### 4.2 Tests With Mocked ID Generation (Trivially True)

**File:** `src/__tests__/upload-dropzone.test.ts:6-19`
**Confidence:** HIGH
**Issue:** The test injects a deterministic ID generator (`() => ids.shift()!`) and only verifies that the IDs are different. It does NOT test the real ID generation logic. It also doesn't test error handling (empty file list, null inputs), file type validation, or the actual upload flow.
**Fix:** Test the actual ID generation by asserting UUIDv4 format, or test with the real generator and verify uniqueness across multiple calls.

### 4.3 Fixture-Style Tests (Pattern Matching, Not Runtime)

These tests read source files and assert regex matches. They are valuable for catching regressions but do NOT verify runtime behavior:

| Test File | Lines | What It Actually Tests | Risk |
|-----------|-------|------------------------|------|
| `data-tag-names-sql.test.ts` | 1-267 | Source contains `GROUP_CONCAT` + `LEFT JOIN` + `GROUP BY` | Medium — SQL compiles but may return wrong results |
| `data-view-count-flush.test.ts` | 1-50 | Source contains buffer swap pattern | Medium — Pattern exists but runtime behavior untested |
| `data-adjacency-source.test.ts` | 1-50 | Source contains prev/next SQL conditions | Medium — Same as above |
| `data-timeline.test.ts` | 1-50 | Source contains timeline query shapes | Medium — Same as above |
| `process-image-blur-wiring.test.ts` | 1-50 | Source contains blur validation pattern | Medium — Wire exists but data validity untested |
| `images-action-blur-wiring.test.ts` | 1-50 | Source contains blur validation in upload action | Medium — Same as above |
| `images-action-gps-toggle-wiring.test.ts` | 1-50 | Source contains GPS toggle wiring | Medium — Same as above |
| `og-route-source-contracts.test.ts` | 1-50 | Source contains OG route patterns | Low — Source pattern check |
| `privacy-fields.test.ts` | 1-50 | Sensitive fields exist in schema | Low — TypeScript compiler already enforces this |
| `client-source-contracts.test.ts` | 1-50 | Client-only imports | Low — Build-time concern |
| `next-config.test.ts` | 1-50 | next.config.ts patterns | Low — Build-time concern |
| `nginx-config.test.ts` | 1-50 | nginx.conf patterns | Low — Infrastructure concern |
| `db-pool-connection-handler.test.ts` | 1-73 | Source contains `Promise.race`, `Symbol.for` | **Medium** — NEW source-scan test. Verifies code PATTERN exists but does NOT test that the timeout actually fires |

**Confidence: High** — These are legitimate concerns. The source-scan tests are "lint tests" — they verify code structure, not runtime behavior. They should be complemented by runtime tests where possible.

### 4.4 Tests That Could Pass Even If Code Is Broken

| Test File | Issue | How It Could Pass Broken |
|-----------|-------|--------------------------|
| `process-image-blur-wiring.test.ts` | Tests that `blurDataUrl` flows through the pipeline | If blur generation produces invalid data URL but consumer accepts it, test passes |
| `images-action-blur-wiring.test.ts` | Tests blur data URL wiring in upload action | Same as above |
| `upload-processing-contract-lock.test.ts` | Tests that the lock is acquired | If lock acquisition fails silently (returns no-op release), test may pass |
| `restore-upload-lock.test.ts` | Tests upload lock during restore | Same silent-failure concern |
| `settings-hash.test.ts` | Tests hash computation | If hash algorithm changes but test fixture is updated to match, test passes without catching the change |
| `serve-upload-settings-debounce.test.ts` | Tests settings hash caching | If cache never invalidates (always returns stale), test may pass if it only checks the first call |

---

## 5. Missing Regression Tests for Recently Fixed Bugs

Since the last review, several bugs were fixed but have NO corresponding regression tests. This is a critical gap — each bug fix should be accompanied by a test that would have caught the bug.

### 5.1 SEC3-01: `getRateLimitBucketStart` Division-by-Zero Guard

**File:** `src/lib/rate-limit.ts:329-333`
**Fix:** `const windowSec = Math.max(1, Math.floor(windowMs / 1000));` (commit 9a66a4ca)
**Test Status:** NO regression test added. The `rate-limit.test.ts` tests `getRateLimitBucketStart` with `windowMs = 60_000` and `120_001` but does NOT test:
- `windowMs = 0` (would have divided by zero before the fix)
- `windowMs = 500` (tests the `Math.max(1, ...)` floor)
- `windowMs = -1` (negative values)
**Confidence:** HIGH
**Recommendation:** Add edge case tests for `getRateLimitBucketStart(0, 0)`, `getRateLimitBucketStart(1000, 500)`, and `getRateLimitBucketStart(1000, -1)`.

### 5.2 SEC3-02: `enqueueImageProcessing` Returns Boolean

**File:** `src/lib/image-queue.ts:255-268`
**Fix:** `enqueueImageProcessing` now returns `boolean` so callers know if the job was rejected (commit c5c91e1a)
**Test Status:** NO regression test for the return value. The `image-queue.test.ts` tests path traversal rejection but does NOT assert the return value is `false` for rejected jobs or `true` for accepted jobs.
**Confidence:** HIGH
**Recommendation:** Add assertions: `expect(enqueueImageProcessing({...invalid})).toBe(false)` and `expect(enqueueImageProcessing({...valid})).toBe(true)`.

### 5.3 BUG-1/BUG-2: Claim Retry Mechanism and `claimRetryScheduled` Cleanup

**File:** `src/lib/image-queue.ts:283-316`
**Fix:** Fixed claim retry mechanism and `claimRetryScheduled` cleanup (commit 735f9715)
**Test Status:** NO regression test for the specific bug scenarios:
- C4-A1: Removing from `enqueued` BEFORE scheduling retry so the retry actually re-adds the job
- C4-A2: Resetting `claimRetryScheduled` on successful claim so `claimRetryCounts` is cleaned up
**Confidence:** HIGH
**Recommendation:** Add tests that mock `acquireImageProcessingClaim` to return `null` multiple times, then succeed, and verify:
1. The job is re-enqueued after each retry (not stuck forever)
2. `claimRetryCounts` is cleaned up after successful claim
3. `claimRetryScheduled` is reset properly

### 5.4 BUG-4: Wide-Gamut Temp File Cleanup on Downscale Throw

**File:** `src/lib/process-image.ts`
**Fix:** Clean up wide-gamut temp file on downscale throw (commit 70ea54d9)
**Test Status:** NO regression test. The `process-image-color-roundtrip.test.ts` and other process-image tests do NOT test the temp file cleanup path when `toFile()` throws.
**Confidence:** HIGH
**Recommendation:** Mock `sharp().toFile()` to throw and verify `fs.unlink()` is called for the temp file.

### 5.5 BUG-10: Topic Image Cleanup on Pre-Transaction Route-Segment Conflict

**File:** `src/app/actions/topics.ts`
**Fix:** Clean up topic image on pre-transaction route-segment conflict (commit 70ea54d9)
**Test Status:** NO regression test. The `topics-actions.test.ts` tests topic creation but does NOT test the specific scenario where route-segment conflict occurs BEFORE the transaction and the temp file needs cleanup.
**Confidence:** MEDIUM
**Recommendation:** Add a test that mocks `createTopic` to hit the route-segment conflict path and verify the temp file is deleted.

### 5.6 BUG-11: Bootstrap Timer Cleanup on Shutdown

**File:** `src/lib/queue-shutdown.ts` and `src/lib/image-queue.ts`
**Fix:** Clear bootstrap timer on shutdown (commit 98d09476)
**Test Status:** NO regression test. The `queue-shutdown.test.ts` exists but does NOT test that the bootstrap timer is cleared.
**Confidence:** HIGH
**Recommendation:** Add a test that sets a bootstrap timer, calls shutdown, and verifies the timer is cleared.

### 5.7 CODE-02: Epsilon-Based Zero Check in `cosineSimilarity`

**File:** `src/lib/clip-embeddings.ts`
**Fix:** Use epsilon-based zero check in `cosineSimilarity` (commit 0b86aec9)
**Test Status:** NO regression test for the epsilon fix. The `clip-embeddings.test.ts` tests `cosineSimilarity` with zero vectors but does NOT test the specific case that triggered the bug (near-zero vectors where the old `=== 0` check would fail).
**Confidence:** MEDIUM
**Recommendation:** Add a test with a vector where `normA` or `normB` is very small but non-zero (e.g., `1e-10`) and verify the function returns 0 instead of throwing or returning NaN.

### 5.8 AGG-08: `retryFailedImage` Restore Maintenance Guard

**File:** `src/app/actions/images.ts`
**Fix:** Guard `retryFailedImage` against restore maintenance (commit 24c8e483)
**Test Status:** The `retry-failed-image-auth.test.ts` tests auth but does NOT test the restore maintenance guard. The mock sets `isRestoreMaintenanceActive: () => false` always.
**Confidence:** HIGH
**Recommendation:** Add a test that mocks `isRestoreMaintenanceActive` to return `true` and verifies `retryFailedImage` returns a maintenance message without making DB calls.

### 5.9 AGG-12: Semantic Search Rate-Limit Rollback Removed

**File:** `src/app/api/search/semantic/route.ts`
**Fix:** Stop refunding rate-limit tokens after expensive semantic-search work (commit 4264d1d4)
**Test Status:** The `semantic-search-route.test.ts` tests the disabled path rollback (line 187) but does NOT test that the production path does NOT rollback after embedding/DB failure.
**Confidence:** HIGH
**Recommendation:** Add a test that mocks `embedTextReal` to throw and verifies `rollbackSemanticAttempt` is NOT called.

### 5.10 R5-H4/H5: OG Route SSRF Fallback + Same-Origin Redirect Validation

**File:** `src/app/api/og/photo/[id]/route.tsx` and `src/app/api/og/route.tsx`
**Fix:** Fail-closed SSRF fallback + same-origin redirect validation (commit 689b5096)
**Test Status:** NO regression test for the SSRF guard or redirect validation.
**Confidence:** HIGH
**Recommendation:** Add tests for:
1. Non-HTTP(S) URL rejection (e.g., `file://`, `ftp://`)
2. Redirect to different host rejection
3. Same-origin redirect acceptance

---

## 6. Mock/Stub Abuse

### 6.1 [CRITICAL] `semantic-search-route.test.ts` — Complete DB Fake

**File:** `src/__tests__/semantic-search-route.test.ts:65-114`
**Confidence:** HIGH
**Issue:** The db mock replaces the entire Drizzle ORM with a hand-rolled fake that returns pre-canned responses. The test doesn't verify that the actual Drizzle queries are correct; it only verifies that the route handler calls the mocked `dbSelectMock` in a certain way. If the route's query logic changes (e.g., adds a `.where()` clause), the test may still pass because the mock ignores the where clause.
**Failure scenario:** If the route handler adds a new `.where()` condition that filters out the mock embedding rows, the test would still pass because the mock ignores the where clause and returns the pre-canned rows. A real DB would return different results.
**Fix:** Use a real in-memory SQLite database or a Drizzle-to-SQLite proxy for integration testing. At minimum, verify the actual SQL generated by the query builder using `.toSQL()`.

### 6.2 [HIGH] `image-queue.test.ts` — Mocks Entire Module Graph

**File:** `src/__tests__/image-queue.test.ts:1-141`
**Confidence:** HIGH
**Issue:** The test mocks EVERY dependency of `image-queue.ts` and only tests three things: (1) path traversal rejection, (2) source code regex matching for `pruneRetryMaps`, and (3) bootstrap retry scan scheduling. The actual queue processing logic (the `processImageFormats` call, error handling, file cleanup) is never tested because it's all mocked.
**Failure scenario:** A real bug in the queue worker (e.g., `processImageFormats` throws but the error handler doesn't clean up files) would never be caught because `processImageFormats` is mocked to a no-op.
**Fix:** Add integration tests that use a real (or minimally mocked) `processImageFormats` with synthetic images. The current test is fine as a unit test for `enqueueImageProcessing`'s validation logic, but it's insufficient as the only test for the image queue.

### 6.3 [HIGH] `process-image-dimensions.test.ts` — Excessive Mocking

**File:** `src/__tests__/process-image-dimensions.test.ts:12-72`
**Confidence:** HIGH
**Issue:** Mocks Sharp's constructor to return a fake instance with fake `metadata()`, then tests that `saveOriginalAndGetMetadata` throws when `metadata()` returns `{ width: 0 }`. The test is essentially verifying that the function checks `!width || !height` and throws. It doesn't test the actual Sharp integration, the actual file streaming, or the actual EXIF extraction.
**Failure scenario:** If Sharp's actual behavior changes (e.g., `metadata()` returns `null` instead of `{ width: 0 }` for corrupt files), this test would still pass because it tests the mocked behavior, not the real one.
**Fix:** Add integration tests with actual corrupt/valid image files. Keep the unit test for the dimension validation logic but acknowledge its limited scope.

### 6.4 [MEDIUM] `auth-rate-limit.test.ts` — Mocks Rate-Limit Module

**File:** `src/__tests__/auth-rate-limit.test.ts:10-17`
**Confidence:** MEDIUM
**Issue:** The test mocks `decrementRateLimit`, `incrementRateLimit`, and `resetRateLimit` from the rate-limit module. This means the test verifies that `auth-rate-limit.ts` calls these functions with the right arguments, but it doesn't test the actual rate-limiting behavior (e.g., whether `incrementRateLimit` actually increments a counter).
**Fix:** This is acceptable as a unit test, but there should be integration tests that test the full rate-limiting stack with real (or in-memory) state.

### 6.5 [MEDIUM] `admin-backfill-runner-detection-failure.test.ts` — Incomplete fs Mock

**File:** `src/__tests__/admin-backfill-runner-detection-failure.test.ts:86-103`
**Confidence:** MEDIUM
**Issue:** The mock spreads `...actual` from the real `fs/promises` module, which means any fs function other than `access` uses the REAL implementation. If the runner code adds a call to `fs.readFile` or `fs.stat`, this test would suddenly touch the real filesystem.
**Fix:** Mock all fs functions explicitly, or use a virtual filesystem mock like `memfs`. At minimum, add a comment warning that `...actual` is intentional but risky.

---

## 7. Missing Edge Case Tests

### 7.1 Session Security Edge Cases

**File:** `src/__tests__/session.test.ts`
**Confidence:** HIGH
**Missing:**
- Token verification (does `verifySessionToken` correctly validate a generated token?)
- Token expiration (does it reject expired tokens?)
- Token tampering (does it reject tokens with modified signatures?)
- Token replay (does it reject reused tokens?)
- Secret rotation (does verification work with a rotated secret?)
- `getSessionSecret` with all 4 cases: env var set, production refusal, DB fetch, DB generation
- `getSessionSecret` race condition (concurrent calls should share the same promise)

### 7.2 Rate Limiting Edge Cases

**File:** `src/__tests__/rate-limit.test.ts`
**Confidence:** MEDIUM
**Missing:**
- `getRateLimitBucketStart(windowMs = 0)` — division-by-zero guard (SEC3-01)
- `getRateLimitBucketStart(windowMs = 500)` — `Math.max(1, ...)` floor
- `getRateLimitBucketStart(windowMs = -1)` — negative values
- Concurrent pruning from multiple calls (shared `lastPruneTime`)
- Hard cap behavior when entries are added DURING pruning
- `preIncrementShareAttempt` / `preIncrementOgAttempt` — OG and share rate limit pre-increment
- `pruneSearchRateLimit` — search rate limit pruning

### 7.3 Upload Edge Cases

**File:** `src/app/actions/images.ts`
**Confidence:** HIGH
**Missing:**
- Empty FormData
- Null topic
- Extremely large tag string (>10KB)
- Unicode bidi in filename
- Batch upload with mixed success/failure
- Disk full after file save but before DB insert
- Sharp metadata extraction throws
- `saveOriginalAndGetMetadata` returns null

### 7.4 Semantic Search Edge Cases

**File:** `src/__tests__/semantic-search-route.test.ts`
**Confidence:** HIGH
**Missing:**
- Multiple results with different similarity scores (verify sorting)
- Results below the threshold being filtered out
- The `topK` limit being respected
- Empty results when no embeddings match
- Cosine similarity computation correctness
- Rate-limit is NOT refunded after embedding/DB failure (AGG-12)

### 7.5 Color/HDR Pipeline Edge Cases

**File:** `src/lib/process-image.ts`
**Confidence:** MEDIUM
**Missing:**
- NCLX box with invalid/malformed size field
- ICC profile with >256 tags (bounds check trigger)
- HEIF file with multiple `colr` boxes (first vs last wins)
- 16-bit PNG with no ICC
- HDR source with `allow_hdr_ingest=true` but SDR-only delivery
- Custom monitor ICC profile (Eizo CG2700X) with chromaticity match
- `force_srgb_derivatives=true` with wide-gamut source + 10-bit AVIF
- AVIF encode fails at 10-bit, falls back to 8-bit (encode-time rejection, not probe-time)
- Wide-gamut downscale throws, temp file cleanup (BUG-4)

### 7.6 API Route Edge Cases

**File:** Various API routes
**Confidence:** HIGH
**Missing:**
- `/api/og/photo/[id]` — Image ID not found, Satori render throws, output exceeds `OG_PHOTO_MAX_BYTES`
- `/api/admin/db/download` — File not found, file is a directory
- `/api/search/semantic` — Content-Type sub-type rejection (`json-patch`), chunked transfer encoding rejection, body size > 8192 bytes
- `/api/search/similar/[id]` — Non-numeric ID (`abc`, `12abc`, `0x1A`, `1.5`, empty string, very large number)
- `/app/uploads/[...path]` — File is a directory

---

## 8. Missing Error Path Tests

### 8.1 Server Action Error Paths

| Action | Error Path | Tested? |
|--------|-----------|---------|
| `uploadImages` | DB insert fails mid-batch (partial upload) | NO |
| `uploadImages` | Disk full after file save but before DB insert | NO |
| `uploadImages` | Sharp metadata extraction throws | NO |
| `uploadImages` | `saveOriginalAndGetMetadata` returns null | NO |
| `deleteImage` | File deletion succeeds but DB delete fails | NO |
| `deleteImage` | DB delete succeeds but file deletion fails | NO |
| `updateImage` | Concurrent edit by another admin (stale data) | NO |
| `createTopic` | DB connection lost mid-transaction | NO |
| `login` | Argon2 verification throws (corrupted hash) | NO |
| `login` | Session secret generation fails | NO |
| `changePassword` | Old password verification fails (rate limit should still increment) | Partially |
| `retryFailedImage` | Restore maintenance active → returns maintenance message | NO (AGG-08) |
| `retryFailedImage` | Image not found → returns localized error | NO (AGG-39) |

### 8.2 Image Processing Error Paths

| Error Path | Tested? |
|-----------|---------|
| `processImageFormats` throws after partial derivative creation (orphan cleanup) | Partially |
| Sharp `limitInputPixels` rejection (decompression bomb) | NO |
| AVIF encode fails at 10-bit, falls back to 8-bit (encode-time rejection) | NO |
| WebP/JPEG encode produces 0-byte file | NO |
| EXIF extraction throws on malformed file | NO |
| ICC profile parsing throws on truncated buffer | NO |
| Color detection throws on unsupported format | NO |
| Wide-gamut downscale throws, temp file cleanup (BUG-4) | NO |

### 8.3 New Code Error Paths (Since Last Review)

| Change | Missing Test | Confidence |
|--------|-------------|------------|
| `rate-limit.ts`: `getRateLimitBucketStart` division-by-zero guard | `windowMs = 0`, `windowMs = 500`, `windowMs = -1` | HIGH |
| `semantic/route.ts`: Rate-limit rollback removed (AGG-12) | Verify NO rollback after embedding/DB failure | HIGH |
| `similar/[id]/route.ts`: ID validation hardened (AGG-20) | Non-numeric ID rejection | HIGH |
| `image-queue.ts`: `enqueueImageProcessing` returns boolean | Return value for all rejection paths | HIGH |
| `queue-shutdown.ts`: Bootstrap timer cleanup | Timer cleared on shutdown | HIGH |
| `process-image.ts`: Temp file cleanup on downscale throw | Mock `toFile()` throw, verify `fs.unlink()` | HIGH |
| `actions/images.ts`: Restore maintenance guard (AGG-08) | Maintenance active → returns message | HIGH |
| `db/index.ts`: Connection init timeout | Mock init query hang >10s | HIGH |
| `instrumentation.ts`: Exit code and signal handling | Shutdown timeout exits with code 1 | MEDIUM |
| `revalidation.ts`: Error handling | `revalidatePath` failures caught and logged | MEDIUM |
| `safe-json-ld.ts`: XSS hardening | `>` escaped in JSON-LD output | LOW |

---

## 9. Missing Integration Tests

### 9.1 Component-Component Integration

- **Photo viewer + Lightbox**: No tests for the interaction (click to open, keyboard navigation, prev/next)
- **Upload dropzone + Image manager**: No tests for the upload-complete-to-grid-refresh flow
- **Search + Load-more**: No tests for the search-results-pagination interaction
- **Color details + Wide-gamut hint**: No tests for conditional rendering based on display capability

### 9.2 Server-Client Integration

- **Upload action + Image queue**: No integration test for the full upload-to-processing-to-visible flow
- **Session creation + Middleware auth**: No integration test for the cookie-to-auth flow
- **Shared link creation + Shared page render**: No integration test for the full sharing flow

### 9.3 API-DB Integration

- **All API routes**: Most route tests mock the DB or use source-text inspection. No true integration tests that hit a test database.
- **Data layer functions**: No integration tests for the complex Drizzle queries against a real database.

### 9.4 Image Processing Pipeline Integration

- **Full upload pipeline**: No end-to-end test for: upload → save original → process formats → verify outputs → mark processed → serve
- **Color pipeline**: The color roundtrip tests are the closest, but they don't test the full `saveOriginalAndGetMetadata` → `processImageFormats` → `enqueueImageProcessing` flow

---

## 10. E2E Test Gaps

### 10.1 Playwright Configuration Issues

**File:** `playwright.config.ts`
**Confidence:** HIGH
**Issues:**
- **Only Chromium** — No Firefox, WebKit, or mobile Safari testing. The app has browser-specific behavior (Firefox wide-gamut detection gap, Safari P3 support) that is never tested.
- **Single worker** (`workers: 1`) — All tests run serially to avoid login rate-limit collisions. This makes the suite slow and still shares state (DB, filesystem, rate limit counters).
- **No separate projects** — Admin (serialized) and public (parallelizable) tests are not separated into different Playwright projects.

### 10.2 Critical E2E Gaps

| Feature | Priority | Why Missing |
|---------|----------|-------------|
| Semantic search full flow | **High** | No seeded data, no env var for semantic key |
| Smart collections | **High** | No seeded collection data |
| DB backup/restore | **High** | Critical operation with no E2E |
| Lightroom Classic publish plugin | **High** | `/api/admin/lr/upload` has no E2E |
| Service worker registration and caching | **Medium** | `sw-cache.test.ts` is unit-only |
| Offline mode | **Medium** | No E2E for the offline HTML fallback |
| Cross-browser testing | **High** | Only Chromium configured |
| Admin analytics dashboard | Medium | No seeded analytics data |
| CSV export | Medium | No E2E for the export flow |
| Theme switching | Low | Visual-only feature |
| Timeline / year-in-review | Medium | No E2E for these public pages |
| Photo map | Medium | No E2E for the map page |
| Bulk image operations | Medium | No E2E for select-all, bulk delete, bulk tag |
| Password change flow | Medium | No E2E for the password change flow |
| Admin token CRUD | Medium | No E2E for token creation/revocation |
| Shared single-photo link (`/s/[key]`) | Medium | Skips when `E2E_SHARE_KEY` is not set |
| Similar photos | Medium | No E2E for the similar photos route |

### 10.3 E2E Test Environment Issues

**File:** `e2e/helpers.ts`
**Confidence:** HIGH
**Issues:**
- **No test database isolation** — E2E tests pollute the production DB with test data (uploaded images, created topics, sessions)
- **No global test teardown** — Some tests have `finally` blocks for cleanup, but no global cleanup of all test artifacts
- **No cleanup of uploaded files** — Originals and derivatives from test uploads may persist
- **No cleanup of rate limit counters** between tests
- **No cleanup of sessions** created by `createAdminSessionCookie`
- **Test order dependencies** — The wrong-password test consumes one rate limit attempt, which could affect subsequent tests if order changes

---

## 11. Missing Security Tests

### 11.1 CSRF Protection

**Confidence:** HIGH
**Missing:**
- No E2E test for CSRF against server actions (POST with wrong Origin to a server action)
- No test for cookie-based CSRF (session cookie theft + cross-origin use)
- No test for login CSRF (forcing login with attacker credentials)

### 11.2 XSS Prevention

**Confidence:** HIGH
**Missing:**
- No E2E test for stored XSS (upload image with `<script>` in title/description, verify it's escaped in gallery)
- No E2E test for reflected XSS (search query reflection, URL parameter reflection)
- No test for XSS in share links (malicious share key handling)
- No test for XSS in topic labels (displayed in navigation)
- No test for XSS in error messages (error page rendering)

### 11.3 File Upload Security

**Confidence:** HIGH
**Missing:**
- No E2E test for malicious file upload (PHP file disguised as JPG, SVG with XSS payload)
- No test for path traversal in filename (`../../../etc/passwd.jpg`)
- No test for oversized file rejection (>200MB)
- No test for decompression bomb (zip bomb, gzip bomb)
- No test for double extension (`file.jpg.php`)
- No test for null byte injection (`file.jpg\x00.php`)
- No test for symlink attack (upload symlink pointing to sensitive file)

### 11.4 Session Security

**Confidence:** HIGH
**Missing:**
- No test for session fixation on login (verify old session is invalidated)
- No test for session hijacking detection (concurrent login from different IP)
- No test for session expiration (wait 24h, verify re-auth required)
- No test for session cookie attributes (httpOnly, secure, sameSite)

### 11.5 Brute Force Protection

**Confidence:** HIGH
**Missing:**
- No test for rate limit exhaustion (5 failed attempts → lockout)
- No test for account-scoped rate limit (distributed brute force)
- No test for rate limit reset (successful login clears counter)
- No test for password change rate limiting
- No test for admin user creation rate limiting

### 11.6 Authorization Boundaries

**Confidence:** HIGH
**Missing:**
- No test for accessing admin routes as non-admin (403, not redirect)
- No test for accessing admin API routes without auth (401/403)
- No test for accessing another admin's data (horizontal privilege escalation)
- No test for public access to admin-only fields (GPS, PII in API responses)
- No test for accessing `/api/admin/db/download` without auth

### 11.7 Additional Missing Security Tests

| Test | Status | Why It Matters |
|------|--------|----------------|
| Clickjacking (X-Frame-Options) | NOT COVERED | UI redressing attacks |
| HSTS header | NOT COVERED | SSL stripping |
| Secure cookie flags | NOT COVERED | Session security |
| Admin token (PAT) security | NOT COVERED | API auth |
| Audit log integrity | NOT COVERED | Forensics |
| Data export security (CSV) | NOT COVERED | Information disclosure |
| GPS data stripping verification | NOT COVERED | Privacy |
| PII in public API responses | NOT COVERED | Privacy breach |
| Path traversal in upload filename | NOT COVERED | File system security |
| Symlink traversal in upload directory | NOT COVERED | File system security |

---

## 12. Missing Property-Based / Fuzz Tests

### 12.1 Areas That Would Benefit from Fuzzing

| Function | Property to Test | Fuzz Input |
|----------|-----------------|------------|
| `sanitizeForOg` in `lib/og-sanitize.ts` | Output never contains bidi chars or C0 controls | Random strings with Unicode bidi, C0, ZW chars |
| `isValidTagName` in `lib/validation.ts` | Valid tags pass, invalid tags fail | Random Unicode strings |
| `normalizeImageListCursor` in `lib/data.ts` | Invalid cursors always return null | Random JSON objects |
| `extractIccProfileName` in `lib/icc-extractor.ts` | Never throws on any Buffer input | Random Buffers of varying sizes |
| `parseCicpFromHeif` in `lib/color-detection.ts` | Never throws on any Buffer input | Random Buffers, truncated ISOBMFF files |
| `hasPlausibleSqlDumpHeader` in `lib/db-restore.ts` | Never accepts non-SQL binary data | Random binary data |
| `getTagSlug` in `lib/tag-records.ts` | Output is always a valid slug | Random Unicode strings |
| `hashSessionToken` in `lib/session.ts` | Always produces 64-char hex, always deterministic | Random strings |
| `verifyAvifNclxInBuffer` in `lib/process-image.ts` | Invalid buffers return `{ ok: false }` | Random Buffers |
| `verifyWebpIccInBuffer` in `lib/process-image.ts` | Invalid buffers return `{ ok: false }` | Random Buffers |
| `clampSemanticTopK` in `api/search/semantic/route.ts` | Always returns integer in [1, SEMANTIC_TOP_K_MAX]` | Random inputs (number, string, boolean, null, undefined, object, array) |
| `extractTldPlusOne` in `lib/analytics.ts` | Never throws, always returns non-empty string | Random host strings |
| `sanitizeReferrerHost` in `lib/analytics.ts` | Never throws, always returns 'direct', 'self', or valid TLD+1 | Random URL strings |

**Confidence: High** — These are all pure functions or stateless validators that are ideal candidates for property-based testing. The `fast-check` library would integrate well with the existing Vitest setup.

---

## 13. Missing Performance Tests

### 13.1 Areas That Would Benefit from Performance Testing

| Scenario | Why Test |
|----------|----------|
| Masonry grid with 1000+ images | Ensure virtualization or pagination doesn't break |
| Search with 10K+ images | Ensure search query performance |
| Upload with 100 files | Ensure batch processing doesn't OOM |
| Image processing with 50MP source | Ensure wide-gamut downscaling works |
| CLIP embedding generation for 1000 images | Ensure batch processing doesn't timeout |
| DB backup with 1M+ row `image_views` | Ensure retention purge doesn't lock the table |
| Admin dashboard with 100 failed images | Ensure retry UI doesn't freeze |
| Semantic search with 2000+ embeddings | Ensure scan limit is respected and query doesn't timeout |
| Image loading LCP/CLS | Ensure gallery performance budgets |
| Large gallery rendering | Ensure memory usage during long scroll sessions |

**Confidence: High** — No performance tests exist at all. This is a significant gap for a production gallery application.

---

## 14. Test Environment Isolation Issues

### 14.1 Process.env Mutation Without Proper Isolation

**File:** `src/__tests__/rate-limit.test.ts:19-37`
**Confidence:** MEDIUM
**Issue:** The `afterEach` restores `process.env` state, but if a test fails mid-way, the restoration may not run. `process.env` is a global mutable — parallel test execution can cause cross-test pollution.
**Fix:** Use `vi.stubEnv` from vitest, which provides proper isolation and automatic cleanup. Or set `pool: 'forks'` in vitest.config.ts for this test file.

### 14.2 Shared Mutable State in Process-Image Tests

**Files:** `process-image-color-roundtrip.test.ts`, `process-image-exif-strip.test.ts`, `process-image-orientation.test.ts`
**Confidence:** LOW
**Issue:** Module-level `generatedIds` array populated by `trackId()`. In watch mode, the module is not reloaded between runs, so `generatedIds` accumulates IDs from previous runs.
**Fix:** Reset `generatedIds` in `beforeAll` or use a per-test cleanup strategy.

### 14.3 E2E Database Pollution

**File:** `e2e/helpers.ts`
**Confidence:** HIGH
**Issue:** `createAdminSessionCookie` inserts into the production DB. No transaction rollback, no test data cleanup, no separate test database.
**Fix:** Add a dedicated E2E test database with automatic cleanup between runs. Implement test data factories for creating/destroying test fixtures.

---

## 15. Commonly Missed Issues (Final Sweep)

### 15.1 Tests That Verify Implementation Details Instead of Behavior

| Test | Issue | Recommendation |
|------|-------|----------------|
| `image-queue.test.ts:87-108` | Tests that `pruneRetryMaps` uses a specific code pattern | Test that the map never exceeds `MAX_RETRY_MAP_SIZE` regardless of implementation |
| `sw-template-contract.test.ts` | Tests that specific strings exist in the template | Complement with runtime tests of actual SW behavior in a browser |
| `client-server-only-boundary.test.ts` | Tests AST structure | Keep but add a runtime test that builds the client bundle and verifies it doesn't throw |
| `db-pool-connection-handler.test.ts` | Tests source patterns (Promise.race, Symbol.for) | Add a runtime test that mocks the pool connection and verifies the timeout fires |

### 15.2 Tests With Weak Assertions

| Test | Weak Assertion | Stronger Alternative |
|------|---------------|---------------------|
| `session.test.ts:5-9` | `hashSessionToken` has length 64 | Also assert it's valid hex, test with empty string, unicode, very long input |
| `session.test.ts:24-43` | Token format is `timestamp:random:signature` | Also assert timestamp is within reasonable range, random is unique across calls, signature verifies with HMAC |
| `data-pagination.test.ts:5-30` | Only tests happy path and empty input | Add boundary tests: `limit === rows.length`, `limit > rows.length`, `limit = 0`, inconsistent `total_count` |
| `upload-tracker.test.ts` | Basic claim settlement | Add concurrent modification, negative claim values, claim larger than available |

### 15.3 Missing "Happy Path" Variations

| Feature | Missing Variations |
|---------|-------------------|
| Upload | Multiple files, mixed formats (JPEG + PNG + HEIC), max size boundary, zero-byte file |
| Search | Empty result set, exact match, partial match, special chars in query, 1000-char query |
| Load more | First page, last page, empty topic, cursor at boundary |
| Image display | Portrait, panorama, very small image, missing derivative |
| Admin settings | Toggle all boolean settings, change all numeric settings to min/max values |
| Topic management | Rename to existing slug, rename with special chars, delete topic with images |
| Tag management | Merge tags, delete tag used by images, create tag with same name different case |
| Semantic search | Stub mode, production mode, disabled mode, rate-limited, maintenance mode |
| Similar photos | Valid ID, non-numeric ID, missing embedding, production mode only |

---

## 16. Recommendations by Priority

### 16.1 Critical (Do Next)

1. **Fix `admin-backfill-runner-leak.test.ts` second test flakiness** — Replace remaining `setImmediate` chain (lines 173-174) with `vi.waitFor(() => !readAdminBackfillState().running, { timeout: 5000 })`.

2. **Fix `image-queue-bootstrap.test.ts` flakiness** — Use `vi.useFakeTimers()` for all tests, isolate to serial execution, or reduce batch size from 500 to 50.

3. **Add regression tests for recently fixed bugs** (Section 5):
   - SEC3-01: `getRateLimitBucketStart` with `windowMs = 0`, `500`, `-1`
   - SEC3-02: `enqueueImageProcessing` return values for all rejection paths
   - BUG-1/BUG-2: Claim retry mechanism (re-enqueue after failed claim, cleanup after success)
   - BUG-4: Temp file cleanup on downscale throw
   - BUG-10: Topic image cleanup on route-segment conflict
   - BUG-11: Bootstrap timer cleared on shutdown
   - CODE-02: Epsilon-based zero check in `cosineSimilarity`
   - AGG-08: `retryFailedImage` restore maintenance guard
   - AGG-12: Semantic search NO rollback after embedding/DB failure
   - R5-H4/H5: OG route SSRF fallback + same-origin redirect validation

4. **Add unit tests for `lib/gps-exif-strip.ts`** — The most critical untested file. Test with synthetic JPEG/TIFF/HEIF/WebP buffers containing GPS data. Test all five strip functions and the action-level wiring.

5. **Add behavioral tests for `lib/data.ts`** — Add DB-mocked tests for `getImage`, `getImagesLite`, `searchImages`, `getSharedGroup`, `getMapImages`, `flushGroupViewCounts`. These are the heart of the app.

6. **Add unit tests for `app/actions/auth.ts`** — The most security-critical untested code. Test: password verification, session creation, cookie attributes, rate limit integration, error paths.

7. **Add tests for `lib/session.ts` `getSessionSecret()`** — The 4-case env/DB fallback logic is the most critical security function and has no direct tests.

8. **Add tests for `lib/audit.ts` `logAuditEvent()`** — Test metadata serialization, truncation at 4096 bytes, surrogate-pair-safe slicing, JSON stringify failure fallback.

### 16.2 High (Do Soon)

9. **Add E2E for semantic search** — Seed semantic search data and add `E2E_SEMANTIC_KEY` to CI.

10. **Add E2E for smart collections** — Seed a smart collection and test creation, viewing, and deletion.

11. **Add E2E for DB backup/restore** — Critical operation with no E2E coverage.

12. **Add tests for `scripts/init-db.ts` and `scripts/seed-admin.ts`** — Deployment-critical scripts.

13. **Add unit tests for `proxy.ts` middleware** — Mock `NextRequest`/`NextResponse` and test auth redirect, locale routing, and admin-render marker.

14. **Add error path tests for `uploadImages`** — Test DB failure mid-batch, disk full, Sharp failure, null metadata.

15. **Add CSRF test for server actions** — Verify that `requireSameOriginAdmin` rejects cross-origin `fetch()` calls to server actions.

16. **Add tests for `app/actions/settings.ts`** — Test validation, persistence, and settings-hash invalidation.

17. **Add tests for `app/actions/embeddings.ts`** — Test CLIP embedding management actions.

18. **Add cross-browser E2E** — Add Firefox and WebKit to Playwright projects.

### 16.3 Medium (Do When Convenient)

19. **Add component-level tests for `search.tsx`, `lightbox.tsx`, `photo-viewer.tsx`, `image-manager.tsx`** — Use React Testing Library.

20. **Add E2E for timeline, year-in-review, map pages** — Public pages with no E2E coverage.

21. **Add E2E for admin analytics, token management, password change** — Admin features with no E2E.

22. **Add tests for `scripts/build-sw.ts`** — Verify SW version stamping and template replacement.

23. **Add performance tests for key queries** — Ensure `getImagesLite`, `searchImages`, `getImagesForFeed` don't degrade with large datasets.

24. **Add runtime test for `db/index.ts` timeout** — Mock the init query to hang and verify the 10s timeout fires.

25. **Add property-based tests for input validators** — Use `fast-check` to fuzz `sanitizeForOg`, `isValidTagName`, `normalizeImageListCursor`, `extractIccProfileName`, `parseCicpFromHeif`, `clampSemanticTopK`.

### 16.4 Low (Nice to Have)

26. **Add visual regression tests for key pages** — Homepage, photo page, admin dashboard.

27. **Add offline mode E2E** — Test the service worker offline fallback.

28. **Add tests for `scripts/download-clip-models.ts`** — Test retry logic and path validation.

29. **Add tests for theme switching** — Verify dark/light/system preference persistence.

30. **Add load tests for concurrent uploads** — Ensure the upload processing contract lock serializes correctly.

31. **Add tests for `instrumentation.ts` signal handling** — Test SIGTERM/SIGINT exit codes and repeated signal handling.

---

## 17. Final Assessment

### Test Suite Health Score

| Category | Score | Notes |
|----------|-------|-------|
| Unit test coverage | 9/10 | 225 test files, excellent helper/lib coverage; major gaps in `data.ts`, `gps-exif-strip.ts`, `auth.ts` behavioral |
| Integration test coverage | 6/10 | Good for color pipeline, auth rate limiting; gaps in server actions, data layer, upload pipeline |
| E2E test coverage | 4/10 | Basic homepage, search, lightbox, admin login; many features untested; only Chromium, single-worker |
| Security test coverage | 7/10 | Excellent lint gates, rate limit tests, origin guard; gaps in server action CSRF, XSS, file upload security, session fixation |
| Accessibility test coverage | 6/10 | Good source-contract tests, touch-target audit; missing runtime a11y tests (keyboard nav, screen reader, focus management) |
| Performance test coverage | 2/10 | No performance tests at all |
| Error path coverage | 4/10 | Many happy paths tested, but error paths are sparse |
| Regression test coverage | 5/10 | Several recently fixed bugs have NO regression tests (Section 5) |
| Flakiness | 7/10 | Known flakes in `admin-backfill-runner-leak.test.ts` (second test) and `image-queue-bootstrap.test.ts`; `data-tag-names-sql.test.ts` has band-aid timeout |
| Test maintainability | 9/10 | Excellent documentation, clear naming, good use of mocks, regression annotations |
| **Overall** | **6.5/10** | **Strong foundation with significant gaps in E2E, error paths, untested critical files, missing regression tests for recent bugs, and flaky patterns** |

### Risk Heat Map

| Risk Area | Current Coverage | Gap Severity | Recommended Action |
|-----------|-----------------|------------|-------------------|
| GPS EXIF stripping (`gps-exif-strip.ts`) | None (unit) | **CRITICAL** | Add unit tests with synthetic binary buffers |
| Data layer (`data.ts`) | Fixture only | **CRITICAL** | Add DB-mocked behavioral tests |
| Authentication (login/logout actions) | Partial (helpers tested, actions not) | **HIGH** | Unit test `app/actions/auth.ts` |
| Session secret resolution | None | **HIGH** | Test `getSessionSecret()` 4-case logic |
| Audit log write path | None | **HIGH** | Test `logAuditEvent()` |
| Server action CSRF protection | Partial (API routes tested, actions not) | **HIGH** | E2E test cross-origin server action calls |
| Semantic search rate-limit posture (AGG-12) | Partial (rollback removed, not fully tested) | **HIGH** | Add test verifying NO rollback after expensive work |
| Similar-photo ID validation (AGG-20) | None | **HIGH** | Add test for non-numeric ID rejection |
| `image-queue-bootstrap.test.ts` | Flaky under load | **HIGH** | Fix fake timers or isolate to serial execution |
| `admin-backfill-runner-leak.test.ts` | Second test still racy | **HIGH** | Replace remaining `setImmediate` with `vi.waitFor` |
| Settings actions | None | **HIGH** | Add tests for `app/actions/settings.ts` |
| Embeddings actions | None | **MEDIUM** | Add tests for `app/actions/embeddings.ts` |
| E2E cross-browser | None | **HIGH** | Add Firefox and WebKit to Playwright |
| E2E semantic search | None | **HIGH** | Add E2E with seeded data |
| E2E DB backup/restore | None | **HIGH** | Add E2E for critical operation |
| Image processing error paths | Partial | **MEDIUM** | Add error path tests |
| Upload race conditions | Partial | **MEDIUM** | Add concurrent upload tests |
| Service worker runtime | None | **MEDIUM** | Add E2E for SW behavior |
| Performance | None | **MEDIUM** | Add benchmark tests |
| Property-based testing | None | **MEDIUM** | Add `fast-check` for pure functions |
| Regression tests for recent bugs | Many missing | **HIGH** | Add tests for SEC3-01, SEC3-02, BUG-1/2, BUG-4, BUG-10, BUG-11, CODE-02, AGG-08, AGG-12, R5-H4/H5 |

---

*Review completed. Verification: `npm test` (225 passed, 2 skipped, 0 failed, 85s); all subagent analyses synthesized. 35+ specific findings identified across flaky tests, coverage gaps, mock abuse, missing regression tests, missing edge cases, security tests, E2E gaps, and test environment issues.*
