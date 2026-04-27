# Test Engineer — Cycle 1 Fresh Review (2026-04-27)

## Test Surface Inventory

66 test files in `apps/web/src/__tests__/` covering:
- Auth: `session.test.ts`, `auth-rate-limit.test.ts`, `auth-rethrow.test.ts`
- Blur data URL: `blur-data-url.test.ts`, `process-image-blur-wiring.test.ts`, `images-action-blur-wiring.test.ts`
- Data layer: `data-pagination.test.ts`, `data-tag-names-sql.test.ts`, `privacy-fields.test.ts`
- Image processing: `image-queue.test.ts`, `image-queue-bootstrap.test.ts`, `queue-shutdown.test.ts`
- Security: `check-api-auth.test.ts`, `check-action-origin.test.ts`, `touch-target-audit.test.ts`, `content-security-policy.test.ts`, `sql-restore-scan.test.ts`, `csv-escape.test.ts`, `validation.test.ts`, `sanitize.test.ts`, `request-origin.test.ts`
- Upload: `upload-dropzone.test.ts`, `upload-limits.test.ts`, `upload-tracker.test.ts`
- Rate limiting: `rate-limit.test.ts`, `og-rate-limit.test.ts`
- Server actions: `images-actions.test.ts`, `public-actions.test.ts`, `seo-actions.test.ts`, `topics-actions.test.ts`, `tags-actions.test.ts`
- E2E: `apps/web/e2e/` (Playwright)

---

## Findings

### C1-TE-01: No test for `width`/`height` fallback behavior in `saveOriginalAndGetMetadata`
**File:** `apps/web/src/lib/process-image.ts:276-277`
**Severity:** Medium | **Confidence:** High

The 2048x2048 fallback when Sharp metadata is unavailable is untested. There is no unit test that verifies this fallback behavior or its downstream impact on aspect-ratio calculations. If the fallback is triggered (rare but possible with corrupt images), the masonry grid and photo viewer would display incorrect proportions.

**Fix:** Add a test that mocks Sharp to return invalid/missing dimensions and verify the fallback values and the resulting DB insert. Alternatively, if C1-CR-03 is fixed (throw instead of fallback), add a test verifying the error is thrown.

---

### C1-TE-02: No test for `processImageFormats` base-file atomic rename fallback chain
**File:** `apps/web/src/lib/process-image.ts:437-452`
**Severity:** Low | **Confidence:** Medium

The 3-level fallback chain for atomic rename (link+rename, copy+rename, direct copy) is untested. The happy path (link+rename) is implicitly tested through integration tests, but the fallback paths are only exercised when the filesystem is broken.

**Fix:** Add a test that mocks `fs.link` and/or `fs.rename` to fail, verifying the fallback chain. Low priority since the fallback paths are only triggered on broken filesystems.

---

### C1-TE-03: No test for `flushGroupViewCounts` backoff behavior during DB outages
**File:** `apps/web/src/lib/data.ts:16-96`
**Severity:** Low | **Confidence:** Medium

The view count flush has exponential backoff logic (`consecutiveFlushFailures`, `getNextFlushInterval`) that increases the flush interval after repeated failures. This logic is untested. A test that simulates DB failures would verify:
1. Backoff increases correctly after failures
2. Backoff resets after a successful flush
3. The buffer drops increments when at capacity

**Fix:** Add a unit test for the backoff behavior with mocked DB queries.

---

### C1-TE-04: No test for `searchImages` three-query sequential search path
**File:** `apps/web/src/lib/data.ts:774-880`
**Severity:** Low | **Confidence:** Medium

The `searchImages` function runs up to 3 sequential DB queries (main, tag, alias). There are tests for the search action (`public-actions.test.ts`), but no direct test for the three-query path in `data.ts`. The tag and alias search branches are only triggered when the main query returns insufficient results, which is harder to test via the action layer.

**Fix:** Add a test for `searchImages` that specifically exercises the tag/alias search branches by mocking the main query to return fewer results than the limit.

---

### C1-TE-05: E2E tests may be fragile due to hardcoded selectors
**File:** `apps/web/e2e/` (not reviewed in detail)
**Severity:** Low | **Confidence:** Low

The Playwright E2E tests are present but were not reviewed in detail. Common concerns include hardcoded selectors that break on UI changes, missing retry/wait logic for dynamic content, and test isolation issues. These are standard E2E concerns and not specific to this codebase.

**Fix:** Low priority — E2E tests are supplementary to the extensive unit test coverage.

---

## Positive Findings

1. **Excellent test coverage** for security-critical surfaces (auth, rate limiting, blur data URL, privacy fields, CSV escaping, validation)
2. **Fixture-based lint tests** (`check-api-auth.test.ts`, `check-action-origin.test.ts`, `touch-target-audit.test.ts`) enforce architectural invariants at test time
3. **Wiring tests** for blur data URL lock the three-point validator at import + call site level
4. **SQL shape tests** (`data-tag-names-sql.test.ts`) prevent ORM query regressions
5. **Session token verification** tests cover timing-safe comparison
