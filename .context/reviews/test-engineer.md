# Test-Engineer Review — GalleryKit Test Suite (Cycle 6)

> **Date:** 2026-06-25
> **HEAD:** d24f2a6d
> **Scope:** `apps/web/src/__tests__/` (225 files), `apps/web/e2e/` (7 files), `apps/web/scripts/` (26 files)
> **Test Runner:** Vitest 4.1.9
> **Current Status:** 225 test files passed, 2 skipped, 2064 total tests, 236s duration

---

## 1. Executive Summary

The GalleryKit test suite continues to be one of the most comprehensive test surfaces encountered. Since the last review (2026-06-24), **6 new tests were added** covering previously untested modules (`analytics.test.ts`, `api-auth-response-headers.test.ts`, `upload-tracker.test.ts`, `restore-maintenance.test.ts`, `queue-shutdown.test.ts`, `db-pool-connection-handler.test.ts`). The codebase now achieves approximately **98.2% source-file coverage** with only 4 uncovered source files (all infrastructure/config) and 19 uncovered scripts (26.9% script coverage).

**Test Health:** HEALTHY with targeted gaps

**Key Improvements Since Last Review:**
- `lib/analytics.ts` — now has comprehensive tests for `extractTldPlusOne`, `sanitizeReferrerHost`, `isBot`, `lookupCountry` (R4C4/R4C5 trailing-dot fixes covered)
- `lib/api-auth.ts` — now has response-header tests for both cookie and PAT token branches (R4C3 SEC-R4C3-04), including wrong-scope token rejection
- `lib/upload-tracker.ts` — now has quota settlement tests (all 7 edge cases: full rollback, partial success, negative clamp, missing entry)
- `lib/restore-maintenance.ts` — now has state management tests (activation, overlap, cleanup callback)
- `lib/queue-shutdown.ts` — now has drain tests (pause/clear/idle, concurrent call deduplication)
- `db/index.ts` — now has structural assertions for pool connection init (C4-C1 Promise.race timeout pattern)

**Critical Gaps Remaining:**
- `lib/audit.ts` — still NO direct tests for `logAuditEvent()` or `purgeOldAuditLog()` (retention guard at R4C6 COR-R4C6-10 is untested)
- `lib/clip-inference.ts` — still NO tests for stub determinism (pure functions, easy to test)
- `lib/clip-model.ts` — still NO functional tests for real encoder (justified by model weight size, but a lightweight load test would help)
- `app/actions/auth.ts` — still NO direct unit tests for login/logout actions (most critical security gap)
- `image-queue-bootstrap.test.ts` — CONFIRMED FLAKY (2 tests timeout under full-suite load, NOT fixed)
- New code since last review introduces ~15 untested paths across rate-limiting, queue, shutdown, and processing

---

## 2. Coverage Gap Analysis

### 2.1 Uncovered Source Files (4 files, 98.2% coverage)

| File | Risk | Why Uncovered | Suggested Test |
|------|------|---------------|----------------|
| `src/proxy.ts` | **Medium** | Next.js middleware; hard to unit test | Integration test for middleware auth redirect; or mock `NextRequest`/`NextResponse` |
| `src/instrumentation.ts` | Low | OpenTelemetry bootstrap; infrastructure | Verify `register()` exports correct OTEL config shape; test SIGTERM/SIGINT exit codes (C4-A3/A4) |
| `src/db/seed.ts` | Low | One-time seed script | Test that seed SQL produces expected schema state |
| `src/i18n/request.ts` | Low | next-intl plumbing | Verify locale resolution logic with mock headers/cookies |

**Confidence: High** — these are genuinely low-risk infrastructure files. The proxy middleware is the only one with security implications, but E2E tests cover the auth redirect path.

**Note:** `src/types/leaflet-defaulticon-compatibility.d.ts` was removed from the list (it is a type declaration with no runtime code).

### 2.2 Uncovered Scripts (19 of 26, 26.9% coverage)

Scripts with NO test coverage (unchanged from last review):

| Script | Risk | Why Test | Suggested Approach |
|--------|------|----------|------------------|
| `scripts/init-db.ts` | **High** | DB initialization; wrong SQL = broken deploy | Unit test: verify SQL execution order, error handling |
| `scripts/seed-admin.ts` | **High** | Creates first admin; wrong hash = lockout | Test Argon2 hash generation, validation of required env vars |
| `scripts/backfill-clip-embeddings.ts` | **Medium** | CLIP backfill; runs in production | Test CLI arg parsing, production mode gating, error paths |
| `scripts/backfill-color-pipeline.ts` | **Medium** | Color pipeline backfill; has advisory lock | Test advisory lock acquisition, batching logic, column set (already covered by `backfill-color-pipeline.test.ts` for the in-app runner, but NOT the sidecar script) |
| `scripts/build-sw.ts` | **Medium** | SW version stamping; stale version = cache issues | Test git-SHA + pipeline-version concatenation, template replacement |
| `scripts/download-clip-models.ts` | **Medium** | Model weight download; offline failure path | Test URL construction, retry logic, path validation |
| `scripts/migrate.js` | **Medium** | Schema migration; skipped migrations = data loss | Test journal monotonicity check, hash validation, reconcile logic (partially covered by `migrate-reconcile-coverage.test.ts` and `migration-journal.test.ts`) |
| `scripts/check-action-origin.ts` | Low | Lint scanner; tested via fixture tests | Already covered by `check-action-origin.test.ts` |
| `scripts/check-api-auth.ts` | Low | Lint scanner; tested via fixture tests | Already covered by `check-api-auth.test.ts` |
| `scripts/check-public-route-rate-limit.ts` | Low | Lint scanner; tested via fixture tests | Already covered by `check-public-route-rate-limit.test.ts` |
| `scripts/seed-e2e.ts` | Low | E2E fixture seeding | Test fixture data generation, idempotency |
| `scripts/run-e2e-server.mjs` | Low | E2E server runner | N/A — test infrastructure |
| `scripts/prepare-next-typegen.mjs` | Low | Type generation prep | N/A — build tooling |
| `scripts/check-js-scripts.mjs` | Low | JS script checker | N/A — build tooling |
| `scripts/ensure-site-config.mjs` | Low | Site config validation | N/A — build tooling |
| `scripts/generate-pwa-icons.ts` | Low | PWA icon generation | N/A — build tooling |
| `scripts/entrypoint.sh` | Low | Docker entrypoint | N/A — shell script |
| `scripts/mysql-connection-options.js` | Low | MySQL connection helper | N/A — config plumbing |
| `scripts/migrate-*.ts` (5 files) | Low | One-off migrations | N/A — historical |
| `scripts/clip-model-manifest.ts` | Low | Model manifest builder | N/A — build tooling |

**Confidence: High** — the 7 high/medium risk scripts above are genuine gaps. The lint scanners are already well-covered by their fixture tests.

### 2.3 Component-Level Coverage Gaps

While the touch-target audit and a11y contracts scan component source, the following components have NO runtime behavior tests:

| Component | Risk | What's Missing |
|-----------|------|----------------|
| `components/image-zoom.tsx` | Low | Mouse/touch gesture math tested in `image-zoom-math.test.ts`, but no integration test for the React component lifecycle |
| `components/histogram.tsx` | Low | Canvas rendering logic; tested indirectly via `histogram.test.ts` but no pixel-level assertions |
| `components/map/map-client.tsx` | Low | Leaflet integration; no tests for marker clustering or tile loading |
| `components/search.tsx` | Medium | Complex client-side search UI; no component-level tests for IME composition, debounce, or result rendering |
| `components/upload-dropzone.tsx` | Medium | File drop handling, drag states; only wiring tests exist (`upload-dropzone-topic-wiring.test.ts`) |
| `components/lightbox.tsx` | Medium | Keyboard navigation, slideshow timing, preload logic; only source-contract tests exist |
| `components/photo-viewer.tsx` | Medium | Blur placeholder rendering, color details accordion; only wiring tests exist |
| `components/admin-user-manager.tsx` | Low | Admin CRUD; no component-level tests |
| `components/image-manager.tsx` | Low | Bulk operations, table sorting; no component-level tests |

**Confidence: Medium** — these are React components that are covered by E2E tests, but unit/component tests would catch regressions faster.

### 2.4 Server Action Coverage Gaps

Server actions are covered by the lint gates and some unit tests, but the following have NO dedicated unit tests:

| Action File | Risk | Tested By | Gap |
|-------------|------|-----------|-----|
| `app/actions/admin-backfill.ts` | Medium | `admin-backfill-runner-*.test.ts` (8 files) | The action wrapper itself (auth, parameter validation) is not directly tested |
| `app/actions/admin-users.ts` | **High** | `admin-users.test.ts` | Actually HAS tests — OK |
| `app/actions/collections.ts` | Medium | `smart-collections.test.ts` | Actually HAS tests — OK |
| `app/actions/embeddings.ts` | Medium | `clip-embeddings.test.ts`, `clip-semantic-integration.test.ts` | Actually HAS tests — OK |
| `app/actions/lr-tokens.ts` | Medium | `admin-tokens.test.ts`, `lr-tokens-action.test.ts` | Actually HAS tests — OK |
| `app/actions/seo.ts` | Low | `seo-actions.test.ts` | Actually HAS tests — OK |
| `app/actions/settings.ts` | Medium | `settings-hash.test.ts`, `settings-image-sizes-lock.test.ts` | The action itself (not just its helpers) lacks direct tests |
| `app/actions/sharing.ts` | Medium | `sharing-source-contracts.test.ts` | Only source-contract tests; no runtime behavior tests |
| `app/actions/tags.ts` | Medium | `tags-actions.test.ts` | Actually HAS tests — OK |
| `app/actions/topics.ts` | Medium | `topics-actions.test.ts` | Actually HAS tests — OK |
| `app/actions/auth.ts` | **High** | `session.test.ts`, `auth-rate-limit.test.ts` | Login/logout actions themselves not directly tested (only helpers) |
| `app/actions/images.ts` | **High** | `images-actions.test.ts` | Has tests but `retryFailedImage` restore-maintenance guard (AGG-08) and localized error are NOT tested |
| `app/actions/public.ts` | Medium | `public-actions.test.ts` | Analytics `console.warn` on failure (new since last review) is NOT tested |

**Confidence: High** — `app/actions/auth.ts` remains the most critical gap. The session token generation is tested, but the actual login action (password verification, session creation, cookie setting) has no unit test. Additionally, `retryFailedImage` now has a restore-maintenance guard that is untested.

---

## 3. New Untested Code Paths (Since 2026-06-24)

The following code changes were committed since the last review and introduce new untested paths:

### 3.1 Security & Rate Limiting

#### `lib/rate-limit.ts` — Division-by-zero guard (SEC3-01)

**Change:** `getRateLimitBucketStart` now uses `Math.max(1, Math.floor(windowMs / 1000))` to prevent division by zero when `windowMs < 1000`.

**Missing tests:**
- `getRateLimitBucketStart(windowMs = 0)` — should not throw, should return valid bucket start
- `getRateLimitBucketStart(windowMs = 500)` — should use `Math.max(1, ...)` floor
- `getRateLimitBucketStart(windowMs = -1)` — should handle negative values gracefully

**Confidence: High** — This is a security-critical fix that needs test coverage.

#### `app/api/search/semantic/route.ts` — Rate-limit rollback removed (AGG-12)

**Change:** After expensive embedding computation or DB scan failures, `rollbackSemanticAttempt(ip)` is no longer called. The rate-limit budget is consumed fairly; refunding would amplify DoS cost.

**Missing tests:**
- Verify that failed embedding/DB errors do NOT refund the rate-limit token
- Verify that pre-DB validation failures (same-origin, maintenance, content-type, body size) DO still rollback

**Confidence: High** — This is a security posture change that needs explicit test coverage to prevent regression.

#### `app/api/search/similar/[id]/route.ts` — ID validation hardened (AGG-20)

**Change:** Added regex `!/^+$/.test(idStr)` guard before `parseInt` to reject non-numeric IDs.

**Missing tests:**
- Non-numeric `id` param (e.g., `abc`, `12abc`, `0x1A`, `1.5`) → 400
- Empty string `id` → 400
- Zero or negative numeric `id` (`0`, `-1`) → 400
- Very large `id` (`999999999999999999999`) → 400 (overflow)

**Confidence: High** — Simple tests that should be added.

### 3.2 Queue & Image Processing

#### `lib/image-queue.ts` — Boolean return and claim retry fixes (BUG-1, BUG-2, SEC3-02)

**Change:** `enqueueImageProcessing` now returns `boolean`. Claim retry removes job from `state.enqueued` before scheduling retry. `claimRetryScheduled` reset on successful claim.

**Missing tests:**
- `enqueueImageProcessing` returns `true` when enqueued, `false` when rejected (shutdown/maintenance/invalid/permanently-failed)
- Claim retry path: job claimed by another worker, removed from `enqueued`, then succeeds on retry
- `claimRetryScheduled` is reset to `false` after successful claim

**Confidence: High** — These are bug fixes that need regression tests.

#### `lib/queue-shutdown.ts` — Bootstrap timer cleanup (C4-C3)

**Change:** New `bootstrapRetryTimer` field; `drainProcessingQueueForShutdown` clears this timer.

**Missing tests:**
- A bootstrap retry timer armed before shutdown is cleared during drain (prevents event loop keep-alive)
- Timer is cleared BEFORE `queue.pause()` is called

**Confidence: High** — The existing `queue-shutdown.test.ts` does NOT test the `bootstrapRetryTimer` path. The mock state object in the test lacks this field.

#### `lib/process-image.ts` — Wide-gamut temp file cleanup (BUG-4, TR-C4-02)

**Change:** Added try/catch around wide-gamut downscale intermediate creation. If `sharp().toFile()` throws, the temp file is unlinked before re-throwing.

**Missing tests:**
- Mock `sharp().toFile()` to throw and verify `fs.unlink(tmpPath)` is called
- Verify the original error is re-thrown (not swallowed)
- Verify temp file does NOT exist after the error

**Confidence: High** — This is a resource leak fix that needs a regression test.

### 3.3 Server Actions

#### `app/actions/images.ts` — Restore maintenance guard (AGG-08)

**Change:** `retryFailedImage` now calls `getRestoreMaintenanceMessage()` at the top and returns early if restore is in progress. Localized error for "not found" state.

**Missing tests:**
- `retryFailedImage` during active restore maintenance → returns maintenance message, does not query DB
- `retryFailedImage` with non-existent image ID → returns localized `t('imageNotInFailedState')` error

**Confidence: High** — These are new guards that need explicit test coverage.

#### `app/actions/topics.ts` — Topic image cleanup on conflict (BUG-10)

**Change:** Removed `imageFilename = null` after `deleteTopicImage(imageFilename)` on route-segment conflict.

**Missing tests:**
- Verify topic image file is deleted when slug conflicts with route segment
- Verify no null assignment masks the cleanup error

**Confidence: Medium** — The test would need to mock `deleteTopicImage` and verify it's called.

#### `app/actions/public.ts` — Analytics log severity (BUG-5, BUG-6)

**Change:** Three analytics `record*View` functions changed from `console.debug` to `console.warn` on failure.

**Missing tests:**
- Verify `console.warn` is called on analytics write failures
- Verify `console.debug` is NOT called on analytics write failures

**Confidence: Medium** — Simple behavioral test.

### 3.4 Database & Infrastructure

#### `db/index.ts` — Connection init timeout (C4-C1)

**Change:** `poolConnection.getConnection` now races the init query against a 10-second timeout. On timeout, the connection is released and an error is thrown.

**Missing tests:**
- Mock init query hanging >10s and verify connection is released and error thrown
- Verify `poolConnection.query` and `poolConnection.execute` route through the initialized connection path
- Verify the `Symbol.for('gallerykit.db.connectionInit')` property is set and awaited

**Confidence: High** — The existing `db-pool-connection-handler.test.ts` is a SOURCE-SCAN test (reads the file and asserts regex matches), NOT a runtime test. It does NOT verify the timeout behavior actually works.

#### `instrumentation.ts` — Exit code and signal handling (C4-A3, C4-A4)

**Change:** Shutdown exits with code `1` on timeout. Repeated SIGTERM/SIGINT handled via `process.on` with `shutdownInProgress` guard.

**Missing tests:**
- Shutdown timeout exits with code 1 (not 0)
- Repeated SIGTERM during shutdown is ignored (does not call `gracefulShutdown` again)
- `shutdownInProgress` flag prevents concurrent shutdown attempts

**Confidence: Medium** — Testing process signal handlers is difficult in Vitest. May need to spawn a subprocess.

### 3.5 Semantic Search / CLIP

#### `lib/clip-embeddings.ts` — Scan limit reduced (AGG-13)

**Change:** `SEMANTIC_SCAN_LIMIT` changed from `5000` to `2000`.

**Missing tests:**
- Verify `SEMANTIC_SCAN_LIMIT` is exactly `2000`
- Verify semantic search queries use `limit(SEMANTIC_SCAN_LIMIT)`

**Confidence: Low** — This is a constant change; a source-scan test would suffice.

### 3.6 Revalidation & JSON-LD

#### `lib/revalidation.ts` — Error handling

**Change:** `revalidateLocalizedPaths` now wraps `revalidatePath` in try/catch and logs warnings instead of throwing.

**Missing tests:**
- `revalidatePath` failures are caught and logged, not thrown
- Multiple locales: failure in one locale does not prevent revalidation of others

**Confidence: Medium** — Would need to mock `revalidatePath` to throw.

#### `lib/safe-json-ld.ts` — XSS hardening

**Change:** Added `.replace(/>/g, '\\u003e')` to escape `>` characters in addition to `<`.

**Missing tests:**
- Verify `>` is escaped in JSON-LD output
- Verify `<` is still escaped
- Verify nested `>` and `<` are both escaped

**Confidence: Low** — Simple string replacement test.

---

## 4. Tests That Don't Actually Verify Behavior (False Confidence)

### 4.1 Source-Scan Tests (Pattern Matching, Not Runtime)

These tests read source files and assert regex matches. They are valuable for catching regressions but do NOT verify runtime behavior:

| Test File | Lines | What It Actually Tests | Risk |
|-----------|-------|------------------------|------|
| `a11y-us-p15.test.ts` | 1-91 | Source contains `aria-live="polite"`, `href="#main-content"`, etc. | **Medium** — A source pattern could exist but be in a dead code branch, commented out, or rendered conditionally in a way that violates the contract at runtime |
| `sw-template-contract.test.ts` | 1-169 | Source contains specific JS patterns in `sw.template.js` | **Medium** — Template could be correct but the generated `sw.js` could be stale (the test DOES check generated `sw.js` at lines 153-157, which is good) |
| `client-server-only-boundary.test.ts` | 1-500 | AST walk for `'use client'` → `server-only` import closure | **Low** — This is actually a strong test; AST-based, not regex |
| `touch-target-audit.test.ts` | 1-1244 | Regex scan for sub-44px Tailwind classes | **Low** — Very comprehensive with multi-line normalizer; catches real issues |
| `check-action-origin.test.ts` | 1-443 | Fixture-based scanner tests | **Low** — Tests the scanner logic, not the actual action files; but the scanner IS the lint gate |
| `check-api-auth.test.ts` | 1-124 | Fixture-based scanner tests | **Low** — Same as above |
| `check-public-route-rate-limit.test.ts` | 1-268 | Fixture-based scanner tests | **Low** — Same as above |
| `color-details-section-delivered.test.ts` | 1-50 | Source contains `isAdmin && isHdr` | **Medium** — The condition could be present but incorrectly parenthesized or short-circuited |
| `lightbox-color-pip-hdr.test.ts` | 1-50 | Source contains `isAdmin && isHdr` | **Medium** — Same as above |
| `photo-viewer-no-hdr-download.test.ts` | 1-50 | Source contains conditional download logic | **Medium** — Source pattern doesn't prove runtime behavior |
| `db-pool-connection-handler.test.ts` | 1-73 | Source contains `Promise.race`, `Symbol.for`, `.catch()` | **Medium** — This is a NEW source-scan test. It verifies the code PATTERN exists but does NOT test that the timeout actually fires, that the connection is released, or that the error is thrown |

**Confidence: High** — These are legitimate concerns. The source-scan tests are "lint tests" — they verify code structure, not runtime behavior. They should be complemented by runtime tests where possible.

### 4.2 Tests That Could Pass Even If Code Is Broken

| Test File | Issue | How It Could Pass Broken |
|-----------|-------|--------------------------|
| `process-image-blur-wiring.test.ts` | Tests that `blurDataUrl` flows through the pipeline | If the blur generation produces an invalid data URL but the consumer accepts it, the test passes |
| `images-action-blur-wiring.test.ts` | Tests blur data URL wiring in upload action | Same as above — tests the wire, not the data validity |
| `upload-processing-contract-lock.test.ts` | Tests that the lock is acquired | If the lock acquisition fails silently (returns a no-op release), the test may pass |
| `restore-upload-lock.test.ts` | Tests upload lock during restore | Same silent-failure concern |
| `data-tag-names-sql.test.ts` | Tests SQL alias pattern | If the SQL compiles but returns wrong results at runtime, the test passes |
| `privacy-fields.test.ts` | Tests field key lists | If `publicSelectFields` omits a field at runtime due to a spread operator bug, the test passes because it checks the static array |
| `settings-hash.test.ts` | Tests hash computation | If the hash algorithm changes but the test fixture is updated to match, the test passes without catching the change |
| `serve-upload-settings-debounce.test.ts` | Tests settings hash caching | If the cache never invalidates (always returns stale), the test may pass if it only checks the first call |
| `db-pool-connection-handler.test.ts` | Tests source patterns | If the `Promise.race` timeout is set to 10s but the init query actually hangs forever (bug in the race logic), the test passes because it only checks the pattern exists |

**Confidence: Medium** — These tests verify contracts and wiring, which is valuable. But they don't test the "what if this breaks" scenarios.

---

## 5. Flaky Tests and Race Conditions

### 5.1 Known Flaky Tests (Fixed or Mitigated)

| Test File | Flakiness | Root Cause | Fix Applied | Status |
|-----------|-----------|------------|-------------|--------|
| `client-server-only-boundary.test.ts` | Timeout under CI load | Full src-tree walk without caching; redundant file reads | Added `readCache` + `importSpecCache` + explicit 60s timeout | **Fixed** (AGG-R8-01) |
| `process-image-color-roundtrip.test.ts` | Sharp/AVIF encode variability | Pixel values shift with encoder quantization | Generous tolerance (~25 codes) + conditional 10-bit probe | **Mitigated** |
| `serve-upload.test.ts` | Cold module import timeout | First import of `next/server` + `@/db` graph takes 10s+ | `beforeAll` warm-up with 120s timeout + `vi.resetModules()` per test | **Fixed** (TEST-R4C1-07) |
| `admin-backfill-runner-*.test.ts` | Timer-based async timing | `setTimeout`/`setInterval` in runner | `vi.useFakeTimers()` + explicit timer advancement | **Fixed** |
| `image-queue.test.ts` | Fake timer leakage | `vi.useFakeTimers()` not cleaned up | `vi.useRealTimers()` in `finally` block | **Fixed** |

### 5.2 CONFIRMED FLAKY — `image-queue-bootstrap.test.ts` (NOT FIXED)

| Test File | Flakiness | Root Cause | Fix Status |
|-----------|-----------|------------|------------|
| `image-queue-bootstrap.test.ts` | 2 tests timeout at 15000ms under full-suite load | `vi.doMock` with `vi.resetModules()` is slow under parallel load. The continuation test uses `vi.waitFor` with 20s timeout but still fails when CPU is contended by sharp/clip/db transitive import graphs. | **NOT FIXED** |

**Specific failing tests:**
- "caps each bootstrap pass and schedules a continuation for large backlogs" (line 131)
- "continues scanning after the previous batch cursor so later rows are not starved" (line 153)

**Root cause analysis:** The test comment (AGG-C4-01) acknowledges the flake but the timeout increase was insufficient. Under full-suite load, the `vi.doMock` + `vi.resetModules()` pattern for 500 mock objects is CPU-intensive. The `vi.waitFor` with 20s timeout races against the test runner's own 15s default timeout.

**Recommended fixes:**
1. Use `vi.useFakeTimers()` for ALL bootstrap tests (the third test uses this and passes reliably)
2. Isolate the file to serial execution (`describe.sequential`)
3. Increase timeout to 30s+ or mark as `test.skip` under CI
4. Reduce the batch size in tests from 500 to 50 (the behavior is the same, less mock overhead)

**Confidence: HIGH** — Verified by running the full test suite. The isolated test passes (3 passed, 1.69s) but fails under full-suite load.

### 5.3 Potential Remaining Flaky Patterns

| Test File | Risk | Why |
|-----------|------|-----|
| `process-image-color-roundtrip.test.ts` | Low-High | Depends on `sharp` version, libvips, libheif availability. The 10-bit probe (`canUseHighBitdepthAvif`) is environment-dependent. On a CI runner without libheif 10-bit support, the test takes the 8-bit fallback path, which is tested but the 10-bit path is NOT tested on such runners. |
| `clip-semantic-integration.test.ts` | Medium | ONNX runtime model loading is non-deterministic in timing; may timeout on slow runners |
| `e2e/admin.spec.ts` | Medium | Upload workflow depends on external file system and image processing queue; 30s timeout may be tight under load |
| `e2e/public.spec.ts` | Low | Search tests depend on seeded data; if seed data is missing, tests skip gracefully |
| `db-pool-connection-handler.test.ts` | Medium | MySQL connection tests may fail if no DB is running; the test may mock the connection but real integration is untested |
| `rate-limit-db.test.ts` | Medium | DB-backed rate limit tests depend on MySQL being available; may fail in CI if DB is not ready |

**Confidence: Medium** — The known flakes have been addressed. The remaining concerns are environment-dependent.

### 5.4 Race Conditions in Test Code

| Location | Issue | Risk |
|----------|-------|------|
| `process-image-color-roundtrip.test.ts:35-46` | `afterAll` cleans up files by `generatedIds` list, but if a test fails mid-run, the list may be incomplete | Low — `force: true` on `fs.rm` handles missing files |
| `serve-upload.test.ts:40-38` | `vi.resetModules()` between tests with shared `uploadRoot` env var | Low — env var is reset in `afterEach` |
| `admin-backfill-runner-batching.test.ts` | Multiple `vi.useFakeTimers()` calls without checking if already fake | Low — Vitest handles nested fake timers |
| `image-queue.test.ts:112-140` | Fake timers + async task execution; `task!()` is called without checking if `queueAddMock` has the right call | Low — the test explicitly advances through 3 attempts |
| `image-queue-bootstrap.test.ts:131-186` | `vi.waitFor` with 20s timeout may race against test runner's 15s default timeout | **Medium** — This is the confirmed flaky pattern |

**Confidence: Medium** — The `image-queue-bootstrap.test.ts` race is the most concerning.

---

## 6. Missing Edge Case Tests

### 6.1 Input Validation Edge Cases

| Function/File | Missing Edge Cases | Risk |
|---------------|-------------------|------|
| `uploadImages` in `actions/images.ts` | Empty FormData, null topic, extremely large tag string (>10KB), Unicode bidi in filename | **Medium** — The tag validation tests exist but filename validation is minimal |
| `searchImagesAction` in `actions/public.ts` | SQL injection in search query (the test uses `` but not other control chars), 1000-char query | Low — LIKE wildcards are escaped |
| `createTopic` in `actions/topics.ts` | Slug collision with existing route segment, emoji in label, 500-char label | Medium — Only basic slug validation is tested |
| `deleteImage` in `actions/images.ts` | Delete while processing (race), delete non-existent image ID | Medium — Race is handled by queue but not tested |
| `updateImage` in `actions/images.ts` | Concurrent edits, stale data, XSS in title/description | Medium — Unicode formatting chars are stripped but not tested |
| `logAuditEvent` in `lib/audit.ts` | Extremely long message, null userId, DB write failure, circular metadata | **Medium** — Audit is best-effort but the truncation logic (C3L-CR-01, C14-AGG-01) is untested |
| `clampSemanticTopK` in `api/search/semantic/route.ts` | Boolean input (`true`), array input (`[5]`), object input, `NaN`, `Infinity`, negative number | Low — The typeof guard handles most of these |

### 6.2 Color/HDR Pipeline Edge Cases

| Scenario | Missing Test | Risk |
|----------|-------------|------|
| NCLX box with invalid/malformed size field | `parseCicpFromHeif` tests have bounded box sizes but not overflow/underflow | Low |
| ICC profile with >256 tags (bounds check) | `extractIccProfileName` caps tagCount but no test for the cap trigger | Low |
| HEIF file with multiple `colr` boxes (first vs last wins) | Tests exist for `prof` then `nclx` but not `nclx` then `prof` | Low |
| 16-bit PNG with no ICC (wide-gamut detection from pixel values only) | No test for PNG without ICC | Low |
| HDR source with `allow_hdr_ingest=true` but SDR-only delivery pipeline | Tests exist for rejection and acceptance, but not for the warning message content | Low |
| Custom monitor ICC profile (Eizo CG2700X) with chromaticity match | Tests exist for AdobeRGB chromaticity but not for other presets (sRGB, P3, Rec.2020) | Low |
| `force_srgb_derivatives=true` with wide-gamut source + 10-bit AVIF | Tests exist for 8-bit derivatives but not the 10-bit AVIF path with force_srgb | Low |

### 6.3 Database Edge Cases

| Scenario | Missing Test | Risk |
|----------|-------------|------|
| Connection pool exhaustion under load | `db-pool-connection-handler.test.ts` tests basic connection but not queue limit | Medium |
| Advisory lock timeout/interruption | `advisory-locks.test.ts` tests acquisition but not timeout | Low |
| Transaction rollback on error | No explicit test for Drizzle transaction rollback | Medium |
| Deadlock between concurrent topic renames | `topics-actions.test.ts` tests slug rename but not concurrent rename | Low |
| `image_views` table with 10M+ rows (retention performance) | `view-retention.test.ts` tests the DELETE query but not at scale | Low |
| `image_embeddings` table with null/invalid embedding bytes | `clip-embedding-column-roundtrip.test.ts` tests valid bytes but not corruption | Low |
| Connection init timeout (C4-C1) | No runtime test for the 10s timeout firing | **Medium** |

### 6.4 Security Edge Cases

| Scenario | Missing Test | Risk |
|----------|-------------|------|
| Session token replay after logout | `session.test.ts` tests token format but not replay detection | **Medium** |
| Session fixation on login | No test for session ID regeneration on login | **Medium** |
| Rate limit bypass via X-Forwarded-For spoofing | `auth-rate-limit.test.ts` tests IP extraction but not spoofing | **Medium** |
| CSRF via `fetch()` with `credentials: 'include'` from attacker origin | `origin-guard.spec.ts` tests API routes but not server actions | **High** — Server actions are the main attack surface |
| Path traversal via null byte (`\x00`) in upload filename | `upload-paths.test.ts` tests `SAFE_SEGMENT` but not null byte | **Medium** |
| Symlink attack via relative path in upload | `serve-upload.test.ts` tests symlink rejection but `uploadImages` does not test symlink rejection on the original file | **Medium** |
| ReDoS in regex-based validators | No tests for catastrophic backtracking in `validation.ts` regexes | Low |
| Semantic search rate-limit NOT refunded after expensive work (AGG-12) | No test verifies the rollback is skipped after embedding/DB work | **High** |
| Similar-photo route with non-numeric ID (AGG-20) | No test for `abc`, `12abc`, empty string | **Medium** |

---

## 7. Missing Error Path Tests

### 7.1 Server Action Error Paths

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
| `changePassword` | Old password verification fails (rate limit should still increment) | Partially — `auth-rate-limit-rollback.test.ts` tests rollback but not the specific action |
| `retryFailedImage` | Restore maintenance active → returns maintenance message | **NO** (new since last review) |
| `retryFailedImage` | Image not found → returns localized error | **NO** (new since last review) |

### 7.2 Image Processing Error Paths

| Error Path | Tested? |
|-----------|---------|
| `processImageFormats` throws after partial derivative creation (orphan cleanup) | Partially — `image-queue-permanent-failure-cleanup.test.ts` tests queue cleanup but not the specific orphan scenario |
| Sharp `limitInputPixels` rejection (decompression bomb) | NO |
| AVIF encode fails at 10-bit, falls back to 8-bit (encode-time rejection) | NO — the `canUseHighBitdepthAvif` probe tests pre-encode, but not encode-time failure |
| WebP/JPEG encode produces 0-byte file | NO |
| EXIF extraction throws on malformed file | NO |
| ICC profile parsing throws on truncated buffer | NO |
| Color detection throws on unsupported format | NO |
| Wide-gamut downscale throws, temp file cleanup (BUG-4) | **NO** (new since last review) |

### 7.3 API Route Error Paths

| Route | Error Path | Tested? |
|-------|-----------|---------|
| `/api/og/photo/[id]` | Image ID not found | NO |
| `/api/og/photo/[id]` | Satori render throws | NO |
| `/api/og/photo/[id]` | Output exceeds `OG_PHOTO_MAX_BYTES` | NO |
| `/api/admin/db/download` | File not found | NO |
| `/api/admin/db/download` | File is a directory (path traversal) | NO |
| `/api/admin/lr/upload` | Invalid PAT token | Partially — `admin-tokens.test.ts` tests token validation but not the route |
| `/api/search/semantic` | Model not loaded (503) | Partially — `semantic-route-production.test.ts` tests the 503 path |
| `/api/search/semantic` | Embedding generation fails | NO — AGG-12: no rollback, but no test either |
| `/api/search/semantic` | DB scan fails | NO — AGG-12: no rollback, but no test either |
| `/api/search/semantic` | Content-Type sub-type rejection (`json-patch`) | NO |
| `/api/search/semantic` | Chunked transfer encoding rejection | NO |
| `/api/search/semantic` | Body size > 8192 bytes | NO |
| `/api/search/similar/[id]` | Non-numeric ID | **NO** (new since last review) |
| `/api/search/similar/[id]` | Target embedding not found | Partially — tested via route but not explicitly |
| `/app/uploads/[...path]` | File outside upload root (symlink) | Partially — `serve-upload.test.ts` tests this |
| `/app/uploads/[...path]` | File is a directory | NO |

---

## 8. Missing Integration Tests

### 8.1 End-to-End Gaps

| Scenario | E2E Coverage | Risk |
|----------|-------------|------|
| Semantic search full flow (query → results → click) | NO | **High** — No `E2E_SEMANTIC_KEY` env var, no seeded semantic search data |
| Smart collections (create → view → delete) | NO | Medium — Only unit tests exist |
| Timeline / year-in-review pages | NO | Medium — `timeline/page.tsx` and `year/[year]/page.tsx` have no E2E |
| On-this-day widget | NO | Low — `on-this-day-widget.tsx` has no E2E |
| Photo map (geolocation display) | NO | Medium — `map/page.tsx` has no E2E |
| Admin analytics dashboard | NO | Medium — `analytics-client.tsx` has no E2E |
| Admin token management (create → use → revoke) | NO | Medium — `tokens/page.tsx` has no E2E |
| Lightroom Classic publish plugin upload | NO | **High** — `/api/admin/lr/upload` has no E2E |
| CSV export | NO | Medium — No E2E for the export/download flow |
| DB backup download | NO | Medium — Only unit test for `hasPlausibleSqlDumpHeader` |
| DB restore (full flow) | NO | **High** — Critical operation with no E2E |
| Theme switching (dark/light/system) | NO | Low — `theme-provider.tsx` has no E2E |
| Service worker registration and cache behavior | NO | **Medium** — `sw-cache.test.ts` is unit-only; no browser E2E for SW |
| Offline mode (HTML fallback) | NO | **Medium** — No E2E for the offline fallback |
| Image derivative cache invalidation (ETag change) | NO | Medium — `serve-upload.test.ts` tests 304 but not the full browser cache flow |
| Shared link (`/s/[key]`) with valid key | Partial | Medium — Skips when `E2E_SHARE_KEY` is not set |
| Bulk image operations (select all, delete, tag) | NO | Medium — `image-manager.tsx` bulk operations untested |
| Password change flow | NO | Medium — `password/page.tsx` has no E2E |
| Admin user creation/deletion | Partial | Medium — `admin-users.test.ts` has unit tests but no E2E |

### 8.2 API Integration Tests

| API Surface | Tested? | Gap |
|-------------|---------|-----|
| Full upload → process → view flow | Partial | E2E tests upload but not the processing queue completion |
| Full delete → cleanup → revalidation flow | NO | No test verifies that deleting an image removes all derivatives and updates the UI |
| Topic rename → URL redirect → cache invalidation | NO | No integration test for the full rename flow |
| Settings change → ETag invalidation → backfill trigger | NO | No test for the full settings-change pipeline |
| CLIP embedding generation → semantic search → result display | Partial | `clip-semantic-integration.test.ts` tests the integration but not the full HTTP route |
| Semantic search → NO rollback on failure (AGG-12) | **NO** | No integration test verifies the rate-limit is NOT refunded after embedding/DB failure |
| Similar photos → non-numeric ID rejection (AGG-20) | **NO** | No integration test for the regex validation |

---

## 9. Test Fixture Issues

### 9.1 Fixtures That May Not Match Reality

| Fixture/Test | Issue | Risk |
|-------------|-------|------|
| `images-actions.test.ts` | Mocks `saveOriginalAndGetMetadata` with synthetic metadata; the real function may return different shapes | Low — the mock matches the expected interface |
| `public-actions.test.ts` | Mocks `searchImages` with `[{ id: 1 }]`; real search returns full image objects with many fields | Low — tests focus on rate limiting and cursor validation |
| `color-detection.test.ts` | Uses synthetic ICC buffers with minimal structure; real ICC profiles are much larger and more complex | Low — the parser handles variable-length structures |
| `process-image-color-roundtrip.test.ts` | Uses synthetic JPEGs with `sharp().withIccProfile('p3')`; real P3 photos may have different ICC structures | Low — the test verifies the pipeline's handling of the profile, not the profile itself |
| `db-restore.test.ts` | `hasPlausibleSqlDumpHeader` tests with short strings; real dumps are multi-MB | Low — the function only checks the first few bytes |
| `clip-embeddings.test.ts` | Uses mock embeddings; real jina-clip-v2 embeddings are 512-dimensional float32 | Low — tests focus on the column encoding, not the model |
| `e2e/fixtures/e2e-landscape.jpg` | Single fixture image; does not test portrait, panorama, RAW, HDR, or wide-gamut sources | Medium — E2E upload only tests one image type |
| `e2e/fixtures/e2e-portrait.jpg` | Added recently (portrait orientation) | Low — still only 2 fixture images |

### 9.2 Mock Accuracy Concerns

| Mock | What It Masks | Risk |
|------|--------------|------|
| `vi.mock('next/headers')` in `public-actions.test.ts` | Returns a simple mock; real `headers()` may behave differently with edge cases | Low |
| `vi.mock('@/db')` in `images-actions.test.ts` | Simplified `select().from().where().limit()` chain; real Drizzle queries may have different behavior | Low |
| `vi.mock('p-queue')` in `image-queue.test.ts` | Mock `PQueue` with simplified `add()`; real PQueue has concurrency limits, priority, etc. | Low |
| `vi.mock('@/lib/process-image')` in `image-queue.test.ts` | `processImageFormats` is a no-op mock; real function may throw or hang | Medium — the queue's error handling around `processImageFormats` is not tested |
| `vi.mock('next-intl/server')` in `images-actions.test.ts` | `getTranslations` returns identity function; real i18n may have different interpolation | Low |
| `vi.mock('@/db')` in `image-queue-bootstrap.test.ts` | Simplified mock chain; the `gt` mock is not verified to produce correct SQL | Low |

---

## 10. Missing Property-Based / Fuzz Tests

### 10.1 Areas That Would Benefit from Fuzzing

| Function | Property to Test | Fuzz Input |
|----------|-----------------|------------|
| `sanitizeForOg` in `lib/og-sanitize.ts` | Output never contains bidi chars or C0 controls | Random strings with Unicode bidi, C0, ZW chars |
| `isValidTagName` in `lib/validation.ts` | Valid tags pass, invalid tags fail | Random Unicode strings |
| `normalizeImageListCursor` in `lib/data.ts` | Invalid cursors always return null | Random JSON objects |
| `extractIccProfileName` in `lib/icc-extractor.ts` | Never throws on any Buffer input | Random Buffers of varying sizes |
| `parseCicpFromHeif` in `lib/color-detection.ts` | Never throws on any Buffer input | Random Buffers, truncated ISOBMFF files |
| `hasPlausibleSqlDumpHeader` in `lib/db-restore.ts` | Never accepts non-SQL binary data | Random binary data |
| `getTagSlug` in `lib/tag-records.ts` | Output is always a valid slug (no leading/trailing hyphen, no empty) | Random Unicode strings |
| `hashSessionToken` in `lib/session.ts` | Always produces 64-char hex, always deterministic | Random strings |
| `generateSessionToken` in `lib/session.ts` | Format is always `timestamp:random:signature` | Multiple invocations |
| `resolveColorPipelineDecision` in `lib/process-image.ts` | All ICC names map to valid decisions | All known ICC profile names + random strings |
| `verifyAvifNclxInBuffer` in `lib/process-image.ts` | Invalid buffers return `{ ok: false }` | Random Buffers |
| `verifyWebpIccInBuffer` in `lib/process-image.ts` | Invalid buffers return `{ ok: false }` | Random Buffers |
| `isAdminRoute` / `isImageDerivative` in `lib/sw-cache.ts` | Correct classification for all URLs | Random URLs with path manipulation |
| `recordAndEvict` in `lib/sw-cache.ts` | Total size never exceeds cap | Random sequences of add/remove operations |
| `deterministicEmbedding` in `lib/clip-inference.ts` | Always produces 512-dim Float32Array in [-1, 1] | Random seed strings |
| `clampSemanticTopK` in `api/search/semantic/route.ts` | Always returns integer in [1, SEMANTIC_TOP_K_MAX] | Random inputs (number, string, boolean, null, undefined, object, array) |
| `extractTldPlusOne` in `lib/analytics.ts` | Never throws, always returns non-empty string | Random host strings |
| `sanitizeReferrerHost` in `lib/analytics.ts` | Never throws, always returns 'direct', 'self', or valid TLD+1 | Random URL strings |

**Confidence: High** — These are all pure functions or stateless validators that are ideal candidates for property-based testing. The `fast-check` library would integrate well with the existing Vitest setup.

---

## 11. E2E Test Gaps

### 11.1 Playwright E2E Coverage Summary

| Spec File | Tests | Coverage |
|-----------|-------|----------|
| `admin.spec.ts` | 6 tests (1 always, 5 opt-in) | Login, navigation, settings toggle, topic CRUD, upload, wrong password |
| `public.spec.ts` | 8 tests | Homepage, locale switch, search, lightbox, heading hierarchy, 404, shared group |
| `origin-guard.spec.ts` | 4 tests | Cross-origin API rejection (authenticated + unauthenticated) |
| `test-fixtures.spec.ts` | 4 tests | Mobile nav, desktop nav, mobile info sheet, keyboard focus nav |
| `nav-visual-check.spec.ts` | Unknown | Visual regression (not examined) |
| `helpers.ts` | N/A | Login helper, cookie creation, image processing wait |

### 11.2 Critical E2E Gaps

| Feature | Priority | Why Missing |
|---------|----------|-------------|
| Semantic search | **High** | No seeded data, no env var for semantic key |
| Smart collections | **High** | No seeded collection data |
| Admin analytics | Medium | No seeded analytics data |
| Lightroom Classic publish | **High** | No E2E for the `/api/admin/lr/upload` route |
| DB restore | **High** | Critical operation; only unit-tested |
| CSV export | Medium | No E2E for the export flow |
| Theme switching | Low | Visual-only feature |
| Service worker offline mode | **Medium** | No test for the offline HTML fallback |
| Image cache revalidation | Medium | No test for the SW stale-while-revalidate flow |
| Bulk image operations | Medium | No E2E for select-all, bulk delete, bulk tag |
| Password change | Medium | No E2E for the password change flow |
| Admin token CRUD | Medium | No E2E for token creation/revocation |
| Timeline / year-in-review | Medium | No E2E for these public pages |
| Photo map | Medium | No E2E for the map page |
| On-this-day widget | Low | No E2E for the widget |
| Shared single-photo link (`/s/[key]`) | Medium | Skips when `E2E_SHARE_KEY` is not set |
| Similar photos | **Medium** | No E2E for the `/api/search/similar/[id]` route |

---

## 12. Commonly Missed Test Issues (Final Sweep)

### 12.1 Tests That Verify Implementation Details Instead of Behavior

| Test | Issue | Recommendation |
|------|-------|----------------|
| `image-queue.test.ts:87-108` | Tests that `pruneRetryMaps` uses a specific code pattern (collect-then-delete) | This is a source-scan test disguised as a unit test. It verifies the implementation, not the behavior. Better: test that the map never exceeds `MAX_RETRY_MAP_SIZE` regardless of implementation. |
| `sw-template-contract.test.ts` | Tests that specific strings exist in the template | These are valuable contract tests but should be complemented by runtime tests of the actual SW behavior in a browser. |
| `client-server-only-boundary.test.ts` | Tests AST structure | This is actually a strong architectural test; keep it but add a runtime test that builds the client bundle and verifies it doesn't throw. |
| `db-pool-connection-handler.test.ts` | Tests source patterns (Promise.race, Symbol.for) | This is a source-scan test. Add a runtime test that mocks the pool connection and verifies the timeout fires. |

### 12.2 Tests With Weak Assertions

| Test | Weak Assertion | Stronger Alternative |
|------|---------------|---------------------|
| `session.test.ts:5-9` | `hashSessionToken('test-token')` has length 64 | Also assert it's a valid hex string, and test with empty string, unicode, very long input |
| `session.test.ts:24-43` | Token format is `timestamp:random:signature` | Also assert timestamp is within reasonable range, random is unique across calls, signature verifies with HMAC |
| `base56.test.ts` | (Assumed) Encode/decode round-trip | Also test that output contains only allowed chars, never produces ambiguous pairs (0/O, 1/I/l) |
| `backup-filename.test.ts` | (Assumed) Filename format | Also test that filename is unique across calls, contains no path traversal |
| `download-filename.test.ts` | (Assumed) Filename format | Also test with special chars in title, very long titles |
| `analytics.test.ts:178-188` | `lookupCountry` returns 'XX' for null/undefined/private IP | Also test that the geoLookup cache is reset between tests (already done via `vi.resetModules()`), test IPv6 addresses |

### 12.3 Missing Test for "Happy Path" Variations

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

### 12.4 Missing Performance Tests

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

### 12.5 Missing Accessibility Tests

| Test | Why |
|------|-----|
| Keyboard navigation through lightbox | Arrow keys, Escape, Tab trapping |
| Screen reader announcement of search results | `aria-live` region updates |
| Focus management after modal close | Focus returns to trigger element |
| Color contrast of admin UI | WCAG AA compliance for all text |
| Reduced motion preference | All animations respect `prefers-reduced-motion` |
| Touch target sizes on mobile | Already covered by `touch-target-audit.test.ts` |

---

## 13. Recommendations by Priority

### 13.1 Critical (Do Next)

1. **Fix `image-queue-bootstrap.test.ts` flakiness** — Two tests timeout under full-suite load. Use `vi.useFakeTimers()` for all tests, isolate to serial execution, or reduce batch size from 500 to 50.

2. **Add unit tests for `app/actions/auth.ts`** — The login/logout actions are the most security-critical untested code. Test: password verification, session creation, cookie attributes, rate limit integration, error paths.

3. **Add tests for `lib/audit.ts`** — `logAuditEvent()` metadata truncation (C3L-CR-01, C14-AGG-01) and `purgeOldAuditLog()` retention guard (R4C6 COR-R4C6-10) are safety-critical and untested.

4. **Add regression tests for new code since last review:**
   - `rate-limit.ts`: `getRateLimitBucketStart` with `windowMs = 0` (SEC3-01)
   - `semantic/route.ts`: Verify rate-limit is NOT refunded after embedding/DB failure (AGG-12)
   - `similar/[id]/route.ts`: Non-numeric ID rejection (AGG-20)
   - `image-queue.ts`: `enqueueImageProcessing` return values, claim retry stuck-job (BUG-1, BUG-2)
   - `queue-shutdown.ts`: Bootstrap timer cleared on shutdown (C4-C3)
   - `process-image.ts`: Temp file cleanup on downscale throw (BUG-4)
   - `actions/images.ts`: `retryFailedImage` restore-maintenance guard (AGG-08)

5. **Add property-based tests for input validators** — Use `fast-check` to fuzz `sanitizeForOg`, `isValidTagName`, `normalizeImageListCursor`, `extractIccProfileName`, `parseCicpFromHeif`, `clampSemanticTopK`.

### 13.2 High (Do Soon)

6. **Add E2E for semantic search** — Seed semantic search data and add `E2E_SEMANTIC_KEY` to CI. Test the full query → results → click flow.

7. **Add E2E for smart collections** — Seed a smart collection and test creation, viewing, and deletion.

8. **Add tests for `scripts/init-db.ts` and `scripts/seed-admin.ts`** — These are deployment-critical scripts. Test the SQL execution, error handling, and idempotency.

9. **Add unit tests for `proxy.ts` middleware** — Mock `NextRequest`/`NextResponse` and test auth redirect, locale routing, and admin-render marker.

10. **Add error path tests for `uploadImages`** — Test DB failure mid-batch, disk full, Sharp failure, null metadata.

11. **Add CSRF test for server actions** — Verify that `requireSameOriginAdmin` rejects cross-origin `fetch()` calls to server actions, not just API routes.

12. **Add tests for `lib/clip-inference.ts`** — Stub determinism, value range, dimension correctness (simple pure functions).

### 13.3 Medium (Do When Convenient)

13. **Add component-level tests for `search.tsx`, `lightbox.tsx`, `photo-viewer.tsx`** — Use React Testing Library to test user interactions.

14. **Add E2E for timeline, year-in-review, map pages** — These are public pages with no E2E coverage.

15. **Add E2E for admin analytics, token management, password change** — These are admin features with no E2E.

16. **Add tests for `scripts/build-sw.ts`** — Verify SW version stamping and template replacement.

17. **Add performance tests for key queries** — Ensure `getImagesLite`, `searchImages`, `getImagesForFeed` don't degrade with large datasets.

18. **Add runtime test for `db/index.ts` timeout** — Mock the init query to hang and verify the 10s timeout fires and the connection is released.

### 13.4 Low (Nice to Have)

19. **Add visual regression tests for key pages** — Homepage, photo page, admin dashboard.

20. **Add offline mode E2E** — Test the service worker offline fallback.

21. **Add tests for `scripts/download-clip-models.ts`** — Test retry logic and path validation.

22. **Add tests for theme switching** — Verify dark/light/system preference persistence.

23. **Add load tests for concurrent uploads** — Ensure the upload processing contract lock serializes correctly.

24. **Add tests for `instrumentation.ts` signal handling** — Test SIGTERM/SIGINT exit codes and repeated signal handling.

---

## 14. Final Assessment

### Test Suite Health Score

| Category | Score | Notes |
|----------|-------|-------|
| Unit test coverage | 9.5/10 | 98.2% source file coverage, excellent helper/lib coverage; new tests added for analytics, api-auth, upload-tracker, restore-maintenance, queue-shutdown |
| Integration test coverage | 7/10 | Good for color pipeline, auth rate limiting, data layer; gaps in server actions |
| E2E test coverage | 5/10 | Basic homepage, search, lightbox, admin login; many features untested |
| Security test coverage | 8/10 | Excellent lint gates, rate limit tests, origin guard; gap in server action CSRF and semantic search rollback posture |
| Accessibility test coverage | 7/10 | Good source-contract tests, touch-target audit; missing runtime a11y tests |
| Performance test coverage | 3/10 | No performance tests at all |
| Error path coverage | 5/10 | Many happy paths tested, but error paths are sparse |
| Flakiness | 8/10 | Known flakes fixed; `image-queue-bootstrap.test.ts` remains flaky under full-suite load |
| Test maintainability | 9/10 | Excellent documentation, clear naming, good use of mocks |
| **Overall** | **7.5/10** | **Strong foundation with targeted gaps in E2E, error paths, and operational scripts** |

### Risk Heat Map

| Risk Area | Current Coverage | Gap Severity | Recommended Action |
|-----------|-----------------|------------|-------------------|
| Authentication (login/logout) | Partial (helpers tested, actions not) | **High** | Unit test `app/actions/auth.ts` |
| Server action CSRF protection | Partial (API routes tested, actions not) | **High** | E2E test cross-origin server action calls |
| Semantic search rate-limit posture (AGG-12) | Partial (rollback removed, not tested) | **High** | Add test verifying NO rollback after expensive work |
| Similar-photo ID validation (AGG-20) | None | **High** | Add test for non-numeric ID rejection |
| `image-queue-bootstrap.test.ts` | Flaky under load | **High** | Fix fake timers or isolate to serial execution |
| Audit log retention guard | None | **High** | Test `purgeOldAuditLog` negative/non-finite input |
| Semantic search | None (E2E) | **High** | Add E2E with seeded data |
| Smart collections | None (E2E) | **High** | Add E2E with seeded data |
| DB init/seed scripts | None | **High** | Unit test script logic |
| Image processing error paths | Partial | Medium | Add error path tests |
| Upload race conditions | Partial | Medium | Add concurrent upload tests |
| Service worker runtime | None | Medium | Add E2E for SW behavior |
| Admin analytics | None (E2E) | Medium | Add E2E |
| Lightroom publish | None (E2E) | Medium | Add E2E |
| Timeline/year-in-review | None (E2E) | Low | Add E2E |
| Performance | None | Low | Add benchmark tests |
| Clip stub determinism | None | Low | Test `embedImageStub`/`embedTextStub` |
| Clip real encoder | None | Medium | Consider lightweight load test |

---

## 15. Addendum: Previously Untested Modules — Status Update

| Module | Prior Review Status | Current Status | Tests Added |
|--------|---------------------|----------------|-------------|
| `lib/analytics.ts` | NO TESTS (HIGH risk) | **COVERED** | `analytics.test.ts` — 14 tests for `extractTldPlusOne`, `sanitizeReferrerHost`, `isBot`, `lookupCountry` |
| `lib/api-auth.ts` | NO TESTS (HIGH risk) | **PARTIALLY COVERED** | `api-auth-response-headers.test.ts` — 5 tests for response headers on cookie/token branches, wrong-scope rejection |
| `lib/audit.ts` | NO TESTS (MEDIUM risk) | **STILL UNCOVERED** | No direct tests. `audit-retention.test.ts` tests the RETENTION concept but not `purgeOldAuditLog()` |
| `lib/upload-tracker.ts` | NO TESTS (LOW risk) | **COVERED** | `upload-tracker.test.ts` — 7 tests for quota settlement |
| `lib/restore-maintenance.ts` | NO TESTS (LOW risk) | **COVERED** | `restore-maintenance.test.ts` — 4 tests for state management |
| `lib/queue-shutdown.ts` | NO TESTS (LOW risk) | **PARTIALLY COVERED** | `queue-shutdown.test.ts` — 2 tests for drain and deduplication, but NOT the new `bootstrapRetryTimer` path (C4-C3) |
| `lib/clip-inference.ts` | NO TESTS (LOW risk) | **STILL UNCOVERED** | No tests for stub determinism |
| `lib/clip-model.ts` | NO TESTS (MEDIUM-HIGH risk) | **STILL UNCOVERED** | `clip-model-contract.test.ts` and `clip-model-manifest.test.ts` are source-scan tests, not functional |
| `lib/data.ts` | NO DIRECT TESTS (HIGH risk) | **STILL UNCOVERED** | Only fixture-style SQL contract tests exist |
| `lib/process-image.ts` | PARTIALLY COVERED | **PARTIALLY COVERED** | Color pipeline well-tested; new temp-file cleanup path (BUG-4) untested |
| `image-queue-bootstrap.test.ts` | NOT LISTED (FLAKY) | **CONFIRMED FLAKY** | 2 tests timeout under full-suite load; NOT fixed |

---

*Review completed. Verification: `npm test` (225 passed, 2 skipped, 0 failed, 236s); `npm run typecheck` (pass); isolated bootstrap test (3 passed, 1.69s). 16 new untested code paths identified from post-review commits, 1 confirmed flaky test, 4 previously untested modules now covered.*
