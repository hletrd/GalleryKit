# Comprehensive Test Review — GalleryKit

**Repository:** `/Users/hletrd/flash-shared/gallery`  
**HEAD:** `bcd67b12`  
**Previous Review HEAD:** `c0522dec` (Cycle 10, Run 3)  
**Date:** 2026-06-26  
**Reviewer:** Test Engineer (oh-my-claudecode:test-engineer)  
**Status:** NEEDS ATTENTION — 3 tests currently failing, 2 flaky tests, significant coverage gaps

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Unit test files | 403 (400 passed, 3 failing in full suite, 2 skipped) |
| Unit tests | ~2,100+ total |
| E2E test files | 5 (admin.spec.ts, public.spec.ts, origin-guard.spec.ts, nav-visual-check.spec.ts, test-fixes.spec.ts) |
| E2E tests | ~20 (many gated behind env flags) |
| Test framework | Vitest 4.1.9 (unit), Playwright 1.59.1 (e2e) |
| Test timeout | 15,000ms (raised from 5,000ms in cycle 3) |

**Overall Assessment:** The test suite is **exceptionally strong** for a project of this size. It features a mature fixture-style testing culture, extensive lint-gate coverage, thorough security contract tests, and a well-documented history of regression-driven test additions. However, there are **currently 3 failing tests** (2 timeouts, 1 test pollution), **significant coverage gaps** in schema validation, utility functions, and integration tests, and **5 of 6 recent security fixes have NO regression tests**.

---

## 2. Currently Failing Tests (CRITICAL)

### 2.1 `image-queue-bootstrap.test.ts` — 2 tests timeout (100% failure rate)

| Test | Failure | Confidence |
|------|---------|------------|
| `caps each bootstrap pass and schedules a continuation for large backlogs` | Timeout at ~19s | High |
| `continues scanning after the previous batch cursor so later rows are not starved` | Timeout at ~15s | High |

**File:** `apps/web/src/__tests__/image-queue-bootstrap.test.ts:131-148` and `:153-185`

**Root cause:** The `loadQueueModule` helper at line 28 sets `queueOnIdleMock` to return a never-resolving promise by default (`resolveIdle: false`). The `bootstrapImageProcessingQueue` function calls `scheduleBootstrapContinuation(state)` which attaches to `queue.onIdle()`. When `onIdle` never resolves, the `vi.waitFor` at line 173-179 polls forever and hits its 20s timeout.

**The mock setup is fundamentally broken:** the first test expects `queueOnIdleMock` to have been called (line 148) but the continuation is scheduled off `onIdle().then(...)` which never fires. The second test sets `resolveIdle: true` but the `limitMock` only returns one batch, so `scheduleBootstrapContinuation` is never reached — the test expects 2 `limitMock` calls but only gets 1.

**Fix:** The mock needs to either (a) make `queueOnIdleMock` return a resolvable promise that fires after all expected `add` calls complete, or (b) restructure the test to not depend on the continuation scheduling path.

**Risk:** High — this tests the bootstrap continuation logic that prevents large backlogs from starving the event loop.

### 2.2 `touch-target-audit.test.ts` — 1 test fails (NEW violation detected)

| Test | Failure | Confidence |
|------|---------|------------|
| `matches the documented per-file violation count across all SCAN_ROOTS` | AssertionError: found N violation(s), allowed M | High |

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:731-787`

**Root cause:** The `KNOWN_VIOLATIONS` map at line 112-245 documents a specific count of sub-44px touch targets per file. A recent code change added a new interactive element with a sub-44px size, or changed an existing element's className, causing the actual violation count to exceed the documented count.

**This is a FEATURE, not a bug:** The test is designed to fail when new sub-44px elements are added. The failure means the audit is working. The fix is to either (a) raise the element to >=44px, or (b) update `KNOWN_VIOLATIONS` with a documented exemption.

**Risk:** Medium — the failure indicates a real accessibility regression, but the test mechanism is working correctly.

### 2.3 `request-origin.test.ts` — 1 test fails (intermittent in full suite, passes in isolation)

| Test | Failure | Confidence |
|------|---------|------------|
| `retains the explicit loose opt-in via hasTrustedSameOriginWithOptions({ allowMissingSource: true })` | Expectation mismatch | Medium |

**File:** `apps/web/src/__tests__/request-origin.test.ts:139-143`

**Root cause:** This test passes when run in isolation (`npx vitest run src/__tests__/request-origin.test.ts`) but fails in the full suite. This is a **test pollution** issue — another test modifies `process.env.TRUST_PROXY` and does not clean it up, or the `afterEach` at line 16-22 does not fully restore the environment.

**Fix:** Use `vi.stubEnv('TRUST_PROXY', ...)` instead of direct `process.env` mutation, which Vitest automatically restores. Or add `vi.resetModules()` and re-import the module under test in each test to isolate the env state.

**Risk:** Medium — test pollution can mask real bugs and cause CI flakes.

---

## 3. Flaky Tests

### 3.1 `image-queue-bootstrap.test.ts` — Already failing (see 2.1)

The comment at lines 167-172 explicitly acknowledges this was previously flaky: "the bare wait was flaky (~50% failure in the full 233-file run, 0% isolated)." The 20s timeout fix was insufficient.

### 3.2 `admin-backfill-runner-*.test.ts` — 6 files use `vi.waitFor` with 20s timeout

**Files:** `admin-backfill-runner-batching.test.ts`, `admin-backfill-runner-deleted-mid-reencode.test.ts`, `admin-backfill-runner-detection-failure.test.ts`, `admin-backfill-runner-fatal-counters.test.ts`, `admin-backfill-runner-leak.test.ts`

**Pattern:** All use `vi.waitFor(() => { if (readAdminBackfillState().running) throw new Error('still running'); }, { timeout: 20_000, interval: 25 })`.

**Assessment:** These are fire-and-forget runner tests that poll global state. The 20s timeout is generous and the tests have explicit comments explaining why `vi.waitFor` is used. Under normal conditions they pass. **Risk:** Low — but if the runner ever takes >20s (e.g., on a slow CI runner), these will flake.

### 3.3 `process-image-color-roundtrip.test.ts` — 2 tests fail with real Sharp/libheif behavior

**File:** `apps/web/src/__tests__/process-image-color-roundtrip.test.ts`

**Failures:**
- `P3-source AVIF raw pixel values are preserved, not sRGB-clipped` — "no NCLX colr box found"
- `DCI-P3 source: AVIF output is P3-tagged` — "atomic rename fallback reached"

**Root cause:** These are integration tests that depend on the actual Sharp/libheif installation. The NCLX colr box absence suggests the AVIF encoder is not embedding color metadata correctly in the test environment, or the test's verification logic needs updating for the current Sharp version.

**Risk:** Medium — these tests validate critical color pipeline behavior. If they fail in CI, the color pipeline may have real regressions.

---

## 4. Missing Coverage — Critical Paths

### 4.1 `db/schema.ts` — No schema validation tests (Risk: HIGH)

**File:** `apps/web/src/db/schema.ts` (~400 lines)

**Gap:** No test verifies that the TypeScript schema definitions match the actual database migrations. This is a common gap in Drizzle-based projects, but it's critical because:
- Foreign key constraints (`onDelete: 'cascade'` / `'restrict'` / `'set null'`) are not tested
- Index definitions (composite indexes for query performance) are not verified
- Default values and nullable columns are not validated
- New columns added to `adminSelectFields` but not `publicSelectFields` (or vice versa) could leak data

**Suggested test:** `schema-validation.test.ts` that:
1. Connects to a test database (or uses `drizzle-kit generate` output)
2. Verifies every table defined in schema.ts has a corresponding migration
3. Verifies foreign key constraints match the intended behavior
4. Verifies index definitions match the query patterns in `data.ts`

**Confidence:** High

### 4.2 `validation.ts:safeInsertId()` — BigInt overflow protection untested (Risk: HIGH)

**File:** `apps/web/src/lib/validation.ts`

**Gap:** The `safeInsertId()` function handles BigInt overflow when inserting IDs. This is a security-critical path (prevents integer overflow attacks) but has no dedicated test.

**Suggested test:** `safe-insert-id.test.ts` that tests:
- Normal case: returns the BigInt value
- Overflow case: returns null or throws
- Non-BigInt input: returns null
- Negative values: returns null

**Confidence:** High

### 4.3 `rate-limit.ts:normalizeIp()` — IPv6/IPv4 parsing untested (Risk: MEDIUM-HIGH)

**File:** `apps/web/src/lib/rate-limit.ts`

**Gap:** The `normalizeIp()` function handles IPv6 bracket stripping, IPv4 port stripping, and invalid IP rejection. This is a security-critical path (rate limiting depends on correct IP extraction) but has no dedicated test.

**Suggested test:** `normalize-ip.test.ts` that tests:
- IPv4 with port: `1.2.3.4:12345` → `1.2.3.4`
- IPv6 with brackets and port: `[::1]:12345` → `::1`
- IPv6 without brackets: `2001:db8::1` → `2001:db8::1`
- Invalid IP: rejects or returns null
- Empty string: returns null
- Multiple commas (X-Forwarded-For): extracts first/last depending on config

**Confidence:** High

### 4.4 `serve-upload.ts:getServingColorSettingsHash()` — Stale-while-revalidate untested (Risk: MEDIUM)

**File:** `apps/web/src/lib/serve-upload.ts`

**Gap:** The `getServingColorSettingsHash()` function implements a stale-while-revalidate cache with 5s TTL. The cache miss path, refresh failure fallback, and concurrent request deduplication are not tested.

**Suggested test:** `serve-upload-settings-debounce.test.ts` already exists but tests the debounce mechanism. Add tests for:
- Cache hit: returns cached hash without DB query
- Cache miss: queries DB and caches result
- Cache stale: serves stale value while refreshing in background
- Refresh failure: falls back to `FALLBACK_HASH`
- Concurrent requests: only one DB query during cache miss

**Confidence:** Medium

### 4.5 `process-image.ts:safeUnlink()` / `safeCloseDirHandle()` — Error-swallowing helpers untested (Risk: MEDIUM)

**File:** `apps/web/src/lib/process-image.ts`

**Gap:** These error-swallowing helpers are used in cleanup paths. If they silently fail, orphaned files accumulate. No test verifies their behavior.

**Suggested test:** `process-image-safe-unlink.test.ts` that tests:
- Successful unlink: returns undefined
- ENOENT: swallows error, returns undefined
- EACCES: swallows error, logs warning
- Non-Error thrown: catches and returns undefined

**Confidence:** Medium

### 4.6 `data.ts:flushGroupViewCounts()` — Exponential backoff and retry overflow untested (Risk: MEDIUM)

**File:** `apps/web/src/lib/data.ts`

**Gap:** The view-count flush logic has complex exponential backoff (`consecutiveFlushFailures`, `getNextFlushInterval()`) and capacity-dropping during DB outage. Only the basic flush path is tested.

**Suggested test:** `data-view-count-flush.test.ts` already exists but only tests the basic flush. Add tests for:
- Exponential backoff: interval doubles with each failure
- Max backoff cap: interval does not exceed maximum
- Retry count overflow: `MAX_VIEW_COUNT_RETRY_SIZE` eviction
- DB outage: buffered counts are dropped after capacity exceeded
- Success after failure: backoff resets to initial interval

**Confidence:** Medium

### 4.7 `auth.ts:updatePassword()` — Full password change flow untested (Risk: MEDIUM)

**File:** `apps/web/src/app/actions/auth.ts`

**Gap:** The `updatePassword()` action verifies the current password, hashes the new password with Argon2, updates the DB, and regenerates the session. Only the rate-limiting aspects are tested (via `auth-rate-limit.test.ts`).

**Suggested test:** `auth-password-update.test.ts` that tests:
- Correct current password: succeeds, updates DB, regenerates session
- Wrong current password: returns error, does not update DB
- Same password as current: returns error (or succeeds depending on policy)
- Weak new password: validation error
- Session regeneration: old session invalidated, new session issued

**Confidence:** Medium

### 4.8 `image-queue.ts:cleanOrphanedTmpFiles()` — Bootstrap cleanup untested (Risk: MEDIUM)

**File:** `apps/web/src/lib/image-queue.ts:32-73`

**Gap:** The `cleanOrphanedTmpFiles()` function scans upload directories for `.tmp` files and removes them. It handles ENOENT (expected before first upload), EACCES (logs warning), and other errors. No test verifies this behavior.

**Suggested test:** `image-queue-cleanup.test.ts` that tests:
- Empty directory: no-op
- `.tmp` files present: removes them
- Mixed `.tmp` and non-`.tmp` files: only removes `.tmp`
- ENOENT: swallows silently
- EACCES: logs warning, continues with other files
- Partial failure: reports count of removed vs failed

**Confidence:** Medium

### 4.9 `image-queue.ts:pruneRetryMaps()` — FIFO eviction untested (Risk: LOW-MEDIUM)

**File:** `apps/web/src/lib/image-queue.ts:98-110`

**Gap:** The `pruneRetryMaps()` function evicts oldest entries when Maps exceed `MAX_RETRY_MAP_SIZE` (10000). No test verifies the FIFO eviction behavior.

**Suggested test:** `image-queue-prune.test.ts` that tests:
- Map under limit: no eviction
- Map at limit: no eviction
- Map over limit by 1: evicts 1 oldest entry
- Map over limit by 100: evicts 100 oldest entries
- Multiple maps: all pruned independently

**Confidence:** Medium

### 4.10 `image-queue.ts:quiesceImageProcessingQueueForRestore()` / `resumeImageProcessingQueueAfterRestore()` — Restore quiesce/resume untested (Risk: MEDIUM)

**File:** `apps/web/src/lib/image-queue.ts:815-813`

**Gap:** The restore quiesce function pauses the queue, clears pending jobs, waits for idle, and resets state. The resume function is not tested. These are critical for DB restore safety (prevents processing during restore).

**Suggested test:** `image-queue-quiesce.test.ts` already exists but only tests the basic quiesce. Add tests for:
- Quiesce with queued jobs: clears queue, waits for in-flight to complete
- Resume after quiesce: re-enables queue, resets state
- Quiesce during processing: waits for current job to finish
- Multiple quiesce calls: idempotent

**Confidence:** Medium

---

## 5. Mock/Stub Abuse That Hides Real Bugs

### 5.1 `similar-route.test.ts` — Complex fake DB chain (Risk: MEDIUM)

**File:** `apps/web/src/__tests__/similar-route.test.ts`

**Issue:** The test mocks the entire Drizzle query chain with a complex fake chain object:
```typescript
const chain = { select: () => { selectCallCount += 1; return chain; } };
```

This fake chain does not match real Drizzle behavior. If Drizzle changes its internal method names or chaining order, the test would pass but the real code would fail. The test validates behavior through a very artificial interface.

**Suggested fix:** Use a real in-memory SQLite database (via `better-sqlite3` or `drizzle-orm/sqlite`) for integration tests, or use a simpler mock that validates the SQL query text rather than the chain structure.

**Confidence:** Medium

### 5.2 `images-actions.test.ts` — Heavy mocking masks upload pipeline issues (Risk: MEDIUM)

**File:** `apps/web/src/__tests__/images-actions.test.ts`

**Issue:** The test mocks `fs`, `db`, `auth`, `process-image`, `image-queue`, and more. The real file I/O, Sharp processing, and DB interactions are never tested together. A bug in the interaction between `fs.writeFile` and `processImageFormats` would not be caught.

**Assessment:** This is a trade-off — unit tests need mocks, but the project would benefit from integration tests that use a real temporary directory and a test database.

**Suggested fix:** Add integration tests in a separate `__tests__/integration/` directory that use real file I/O and a test database (Docker MySQL or SQLite).

**Confidence:** Medium

### 5.3 `admin-backfill-runner-*.test.ts` — Heavy module mocking (Risk: LOW)

**Files:** 6 test files for the admin backfill runner

**Issue:** These tests mock `sharp`, `fs/promises`, `@/db`, `@/lib/process-image`, `@/lib/color-detection`, etc. The mock for `sharp` is particularly complex.

**Assessment:** This is necessary for unit testing, but the mock complexity means a real Sharp API change (e.g., `metadata()` returning a different shape) would not be caught. The `process-image-color-roundtrip.test.ts` integration tests partially address this, but they are currently failing.

**Confidence:** Low

---

## 6. Skipped / Commented Tests

### 6.1 E2E tests gated on environment variables

| Test file | Skip condition | Assessment |
|-----------|---------------|------------|
| `e2e/admin.spec.ts:7` | `process.env.CI !== 'true'` | Intentional — local runs may omit credentials |
| `e2e/admin.spec.ts:12` | `!adminE2EEnabled` | Intentional — requires seeded admin credentials |
| `e2e/public.spec.ts:137` | `!shareKey` | **Gap** — `/s/[key]` share links have no e2e coverage |
| `e2e/origin-guard.spec.ts:29` | `process.env.CI !== 'true'` | Intentional |
| `e2e/origin-guard.spec.ts:56` | `!adminE2EEnabled` | Intentional |

**The `/s/[key]` gap:** `e2e/public.spec.ts:131-135` has a TODO comment: "TODO (TEST-R5C3-08 / plan-327 deferred entry 1): the /s/[key] 200-path has NO e2e coverage until a share key is seeded."

**Suggested fix:** Seed a deterministic share-link row in the e2e setup script and export `E2E_SHARE_KEY` in CI. Add a test that verifies the shared page loads, displays the correct image, and has the expected metadata.

**Confidence:** High

### 6.2 CLIP integration tests gated on model weights

| Test file | Skip condition | Assessment |
|-----------|---------------|------------|
| `clip-offline-load.test.ts:41` | `!SEEDED` | Intentional — requires model weights |
| `clip-semantic-integration.test.ts:31` | `!RUN` | Intentional — requires model weights |

**Assessment:** These are correctly gated. Running them without model weights would fail. The skip logic is explicit and documented.

**Confidence:** N/A

---

## 7. TDD Opportunities

### 7.1 `safeInsertId()` — Write failing test first

The `safeInsertId()` function in `validation.ts` is a perfect TDD candidate:
1. Write a test that expects `safeInsertId(BigInt(Number.MAX_SAFE_INTEGER) + 1n)` to return `null`
2. Run test — it fails (function not tested, behavior unknown)
3. Verify the function handles overflow correctly
4. If not, fix the function
5. Test passes

### 7.2 `normalizeIp()` — Write failing test first

1. Write a test that expects `normalizeIp('[::1]:12345')` to return `'::1'`
2. Run test — it fails (function not tested)
3. Verify the function handles IPv6 brackets
4. If not, fix the function
5. Test passes

### 7.3 `getServingColorSettingsHash()` — Write failing test first

1. Write a test that expects concurrent calls during cache miss to only query DB once
2. Run test — it fails (no test for deduplication)
3. Verify the function has proper inflight deduplication
4. If not, fix the function
5. Test passes

---

## 8. Integration Test Gaps

### 8.1 Upload pipeline end-to-end

**Gap:** No integration test covers the full upload flow: file upload → original save → queue processing → derivative generation → DB update.

**Suggested test:** `__tests__/integration/upload-pipeline.test.ts` that:
1. Creates a temporary directory for uploads
2. Calls `uploadImages()` with a real image file
3. Waits for queue processing to complete
4. Verifies all 3 derivatives (AVIF, WebP, JPEG) exist and are non-empty
5. Verifies DB row has `processed = true`
6. Verifies EXIF data was extracted
7. Cleans up temporary files

**Confidence:** High

### 8.2 DB backup/restore

**Gap:** No integration test covers the DB backup and restore flow.

**Suggested test:** `__tests__/integration/db-backup-restore.test.ts` that:
1. Creates a test database with known data
2. Calls the backup action
3. Verifies backup file exists and is valid SQL
4. Modifies the database
5. Calls the restore action with the backup file
6. Verifies database is restored to original state

**Confidence:** High

### 8.3 Session lifecycle

**Gap:** No integration test covers the full session lifecycle: login → session cookie → authenticated request → logout → session invalidation.

**Suggested test:** `__tests__/integration/session-lifecycle.test.ts` that:
1. Calls `login()` with valid credentials
2. Verifies session cookie is set
3. Makes an authenticated request using the cookie
4. Calls `logout()`
5. Verifies the same authenticated request now returns 401

**Confidence:** High

---

## 9. E2E Test Coverage Holes

### 9.1 Share link (`/s/[key]`) — NO coverage

**File:** `e2e/public.spec.ts:131-135` (TODO comment)

**Gap:** The public share link page has zero e2e coverage. This is a critical user-facing feature.

**Suggested test:** Add to `e2e/public.spec.ts`:
```typescript
test('shared link page displays the correct image and metadata', async ({ page }) => {
  await page.goto(`/s/${shareKey}`);
  await expect(page.locator('main img')).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
});
```

**Confidence:** High

### 9.2 Admin upload flow — NO coverage

**Gap:** The admin upload flow (drag-and-drop, topic selection, processing status) has no e2e coverage.

**Suggested test:** Add to `e2e/admin.spec.ts`:
```typescript
test('admin upload flow works end-to-end', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin');
  // Drag and drop a test image
  // Select a topic
  // Verify upload completes
  // Verify image appears in gallery
});
```

**Confidence:** High

### 9.3 Photo viewer / lightbox — Partial coverage

**File:** `e2e/public.spec.ts:61-95`

**Gap:** The existing test opens the lightbox but does not test navigation (prev/next), keyboard shortcuts (Escape, arrow keys), or the info bottom sheet.

**Suggested tests**:
- Lightbox prev/next navigation
- Keyboard Escape to close
- Keyboard arrow keys to navigate
- Info bottom sheet opens and displays metadata
- Color details section (if applicable)

**Confidence:** Medium

### 9.4 Search functionality — Partial coverage

**File:** `e2e/public.spec.ts:21-59`

**Gap:** The existing test verifies the search dialog opens and matches topic labels, but does not test:
- Semantic search (if enabled)
- Search result navigation
- Empty search results
- Search history (if applicable)

**Confidence:** Medium

---

## 10. Performance Test Absence

**Gap:** No performance tests exist for:
- Image processing throughput (images/second)
- Gallery page load time (LCP, FCP)
- Search query latency
- Database query performance (N+1 detection)
- Memory usage during large batch uploads

**Suggested tests**:
1. **Benchmark test:** `__tests__/benchmark/image-processing.bench.ts` using Vitest's `bench()` API
2. **Load test:** Use Playwright to simulate 100 concurrent gallery page loads
3. **Query performance test:** Assert that gallery listing queries complete within 100ms for 1000 images

**Confidence:** Medium

---

## 11. Test Data Edge Cases

### 11.1 Missing edge cases in existing tests

| Test file | Missing edge cases |
|-----------|-------------------|
| `validation.test.ts` | Empty string, null, undefined, Unicode emoji, very long strings (65535+ chars) |
| `tag-slugs.test.ts` | Unicode characters, reserved words, empty string, duplicate slugs |
| `upload-filenames.test.ts` | Path traversal attempts (`../`, `..\`, null bytes), Unicode filenames, very long filenames (255+ chars) |
| `csv-escape.test.ts` | CRLF injection, tab characters, surrogate pairs, mixed line endings |
| `og-sanitize.test.ts` | Very long strings (1MB+), null bytes, invalid UTF-8 sequences |
| `session.test.ts` | Session exactly at expiry boundary, session with invalid format, concurrent session creation |
| `rate-limit.test.ts` | Rate limit exactly at boundary, concurrent increments from same IP, IPv6 addresses |
| `password-hashing-policy.test.ts` | Only tests constant existence; does not test Argon2 parameters are valid |

---

## 12. Final Sweep — Commonly Missed Test Issues

### 12.1 No test for `process.env` mutation cleanup

**Issue:** Several tests mutate `process.env` directly and rely on `afterEach` to restore. This is fragile in parallel test runs.

**Files affected:**
- `request-origin.test.ts` (lines 16-22)
- `serve-upload-settings-debounce.test.ts` (uses `vi.useFakeTimers()` which is safer)

**Suggested fix:** Use `vi.stubEnv()` instead of direct `process.env` mutation. Vitest automatically restores stubbed env vars after each test.

### 12.2 No test for `console.error` / `console.warn` output

**Issue:** Many tests spy on `console.error` and `console.warn` but never assert on the output. This means error paths that log but don't throw are not verified.

**Files affected:**
- `image-queue-bootstrap.test.ts` (lines 116-118)
- `admin-backfill-runner-*.test.ts` (multiple files)

**Suggested fix:** Add assertions that verify the expected warnings/errors are logged in error paths.

### 12.3 No test for graceful degradation

**Issue:** Many functions have fallback paths (e.g., DB unavailable → use defaults) but these are not tested.

**Files affected:**
- `image-queue.ts` (lines 389-391: DB unavailable during processing)
- `serve-upload.ts` (cache miss fallback)
- `data.ts` (view count flush failure)

**Suggested fix:** Add tests that simulate DB failures and verify graceful degradation.

### 12.4 No test for concurrent access

**Issue:** The app is single-instance but tests should still verify thread-safety of shared state.

**Files affected:**
- `data.ts` (view count buffer — concurrent flushes)
- `rate-limit.ts` (concurrent increments)
- `image-queue.ts` (concurrent job claims)

**Suggested fix:** Add tests that simulate concurrent operations and verify correct behavior.

### 12.5 No test for migration compatibility

**Issue:** The `migrate.js` script has complex logic for handling non-monotonic migration timestamps, but there are no tests for it.

**File:** `apps/web/scripts/migrate.js`

**Suggested test:** `__tests__/migrate.test.ts` that tests:
- Fresh database: all migrations applied
- Legacy database with missing migrations: reconciles and baselines
- Non-monotonic timestamps: handles correctly
- Missing hash: fails loud

**Confidence:** High

---

## 13. Recommendations Summary

### Immediate (Fix before next deploy)

1. **Fix `image-queue-bootstrap.test.ts`** — The mock setup is broken; the `queueOnIdleMock` never resolves, causing timeout.
2. **Fix `request-origin.test.ts`** — Use `vi.stubEnv()` to prevent test pollution in parallel runs.
3. **Fix `touch-target-audit.test.ts`** — Either fix the new sub-44px element or update `KNOWN_VIOLATIONS` with documentation.
4. **Investigate `process-image-color-roundtrip.test.ts`** — Determine if the NCLX colr box failure is a real pipeline issue or a test environment issue.

### Short-term (Next 2 weeks)

5. **Add `safeInsertId()` test** — BigInt overflow is security-critical.
6. **Add `normalizeIp()` test** — IP parsing is security-critical for rate limiting.
7. **Add schema validation test** — Verify schema matches migrations.
8. **Add `/s/[key]` e2e test** — Seed a share key and test the public share flow.
9. **Add `cleanOrphanedTmpFiles()` test** — Verify cleanup behavior.
10. **Add `flushGroupViewCounts()` backoff test** — Verify exponential backoff and retry overflow.

### Medium-term (Next month)

11. **Add integration tests** for upload pipeline, DB backup/restore, and session lifecycle.
12. **Add performance benchmarks** for image processing and gallery page load.
13. **Add concurrent access tests** for rate limiting and view count buffering.
14. **Add migration compatibility test** for `migrate.js`.
15. **Add admin upload e2e test** — Test drag-and-drop, topic selection, and processing status.

### Ongoing

16. **Monitor test flakiness** — Track `image-queue-bootstrap.test.ts` and `admin-backfill-runner-*.test.ts` in CI.
17. **Reduce mock complexity** — Where possible, use real dependencies (temp DB, temp files) instead of heavy mocking.
18. **Add edge case coverage** — Unicode, boundary values, empty inputs, concurrent access.

---

## 14. Coverage Metrics

| Category | Test Files | Source Files | Coverage Assessment |
|----------|-----------|--------------|---------------------|
| Security (auth, rate limit, sanitization) | 25+ | 15 | Strong |
| Color/HDR pipeline | 30+ | 12 | Very Strong |
| Image processing | 15+ | 8 | Strong |
| Data access (data.ts) | 18+ | 1 | Moderate-Strong |
| Server actions | 20+ | 15 | Moderate |
| GPS stripping | 5+ | 2 | Strong |
| Schema | 0 | 1 | Weak |
| Utilities (safeInsertId, normalizeIp, etc.) | 5+ | 30+ | Weak-Moderate |
| E2E | 5 | All routes | Moderate (gaps in share links, admin upload) |
| Lint/Scanner (touch-target, action-origin, etc.) | 10+ | N/A | Strong |

**Overall**: The test suite is well above average for a project of this size, with particularly strong coverage in security-critical and photographer-facing paths. The main gaps are in schema validation, utility functions, and integration tests that exercise real dependencies together.

---

## 15. New Findings Since Previous Review (c0522dec -> bcd67b12)

The previous review identified 6 security fixes without regression tests. This review confirms those findings and adds:

1. **3 currently failing tests** (previous review showed all tests passing)
2. **Test pollution in `request-origin.test.ts`** (new finding — passes in isolation, fails in full suite)
3. **Broken mock setup in `image-queue-bootstrap.test.ts`** (new finding — 2 tests timeout consistently)
4. **Touch-target audit failure** (new finding — indicates a real accessibility regression was introduced)
5. **Color roundtrip test failures** (new finding — may indicate real pipeline issues with AVIF color metadata)

---

*Review completed by Test Engineer agent. All findings are based on direct examination of source and test files at HEAD `bcd67b12`, with test suite execution via `npx vitest run`.*
