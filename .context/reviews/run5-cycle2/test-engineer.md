# Test Engineer Review — Run 5 Cycle 2
**Date:** 2026-06-12
**Reviewer lane:** TEST-ENGINEER
**Scope:** Critique cycle-1 new tests + full test surface sweep + e2e audit + flakiness audit

---

## 0. Suppression index

Items already planned in plan-315 items 17–22 are suppressed from this report:
- Item 17: upload-paths.ts tests
- Item 18: withAdminAuth wrong-scope branch
- Item 19: pin advisory-lock names (partially — see TEST-R5C2-11 below)
- Item 20: minimum public e2e specs
- Item 21: paid-download GET→POST claim e2e
- Item 22: Stripe webhook behavioral tests

Items in plan-316 (doc-only) and plan-317 (deferred) are also suppressed.

---

## 1. Cycle-1 new test critique

### session-verify.test.ts

**Overall quality: GOOD with one isolation risk.**

`getSessionSecret` has module-level mutable state: `cachedSessionSecret` (line 13) and `sessionSecretPromise` (line 14). Both are never reset between test cases. The test uses `vi.resetModules()` in `afterEach` and `vi.doMock` before each dynamic import — this pattern is correct and does clear the module registry, but only if every `await import('@/lib/session')` is called AFTER the mock is registered in the same `beforeEach`/test body. The `getSessionSecret` describe block does this correctly.

**Risk:** The module-level `cachedSessionSecret` will be populated by test (3) ("production + valid 64-hex secret") and if `vi.resetModules()` is skipped or the module is re-used without re-import, test (4) will short-circuit to the cached value and never hit the DB branch. The current structure avoids this because `resetModules` + dynamic import is done per test. No bug today, but the pattern is fragile — a future test added without a dynamic import after `beforeEach` will silently test the cached path.

**Missing branch:** `getSessionSecret` has a path where the DB INSERT IGNORE races and the re-fetch (`finalSetting`) also returns null — throwing "Session secret persistence failed". This branch (lines 69–72) has no test case. Failure class: silent crash on first login in a multi-process cold-start race.

**Missing branch:** `generateSessionToken` is never directly tested. Its HMAC-format output is tested indirectly through `verifySessionToken` but the function's own structure (timestamp, random bytes, HMAC) has no unit test.

---

### bounded-map.test.ts

**Overall quality: EXCELLENT.**

All six categories covered with good boundary cases. The `createWindowBoundedMap` boundary-condition test at exactly `windowMs` (not `>`) is particularly precise. No issues.

---

### download-token-shape.test.ts

**Overall quality: GOOD with one assertion weakness.**

The test at line 106–113 uses a 46-character body string built from `'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm01234-_'` (46 chars) and then slices to 43. The comment says `body.length >= 43` but doesn't assert the slice is exactly 43 — it relies on `isValidTokenShape` validating this. This is fine because the real validation is tested, but the fixture construction is slightly fragile (if the template string is edited to < 43 chars, `body.slice(0,43)` silently produces a shorter string).

No high-priority issues.

---

### password-hashing-policy.test.ts

**Overall quality: GOOD.**

Both the exact-pin suite and the minimum-floor suite are present. The duplication between "exact" and "minimum" tests is intentional and defensible. No issues.

---

### checkout-route.test.ts

**CRITICAL FINDING: unknown-IP idempotency gap not covered (TEST-R5C2-01, HIGH).**

The checkout route (line 178) builds `idempotencyKey = checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}`. When `getClientIp()` returns `'unknown'` (no TRUST_PROXY, mismatched X-Forwarded-For), the key becomes `checkout-42-unknown-<minute>`. Two simultaneous buyers from different IPs both get the key `checkout-42-unknown-<minute>` and Stripe treats them as the same checkout session — one buyer gets the other's session URL. This is plan-315 item 6 (TRC-R5C1-16), but the test added in this cycle (checkout-route.test.ts) mocks `getClientIp` to always return `'203.0.113.9'` (line 46) and never exercises the `'unknown'` branch. The plan says to extend these tests, but the extension was not added.

**Mock fidelity gap:** The mock chain `selectMock → from → where → limit → async` (lines 82–97) uses a call-counter approach that dispatches first call = image row, second call = settings row. This is fragile: if the route changes to issue queries in a different order (e.g., settings first for caching), the mock silently returns wrong data for both calls. The mock should use SQL-content inspection or separate `mockImplementationOnce` calls with clear semantics.

---

### retry-failed-image-auth.test.ts

**Overall quality: GOOD.**

Both branches (origin check fails → early return; isAdmin false → error) are covered. Mock shape is correct — db shape mirrors actual usage. No issues.

One minor note: the test imports `retryFailedImage` after all vi.mock calls, which is correct. However `dbSelectMock` is set up as `vi.fn()` but the function body when isAdmin passes is not tested — there is no "happy path" test (admin + image found + retry succeeds). The test only covers the auth gate, not the actual retry logic. This is scope-appropriate for a gate test, but it means the retry-logic branches inside `retryFailedImage` (image not found, already processed, enqueue fails) are untested.

---

### save-original-unlink-on-detection-failure.test.ts

**Overall quality: GOOD.**

Uses real filesystem via `fs.mkdtemp`, which is appropriate. The "resolves normally and leaves file on disk" case is a good positive control. The `detectColorSignals` return value in the success case (lines 96–104) matches the real `ColorSignals` interface shape.

**Possible brittleness:** The mock for `upload-paths` uses a getter pattern (`get UPLOAD_DIR_ORIGINAL() { return uploadOriginalDir; }`) with a lazy closure. This is correct but non-obvious — if `uploadOriginalDir` is read before `beforeAll` completes, it will be undefined. The test guards against this because `import` of `saveOriginalAndGetMetadata` is at module level (after `vi.mock` setup) but `uploadOriginalDir` is only set in `beforeAll`. Since Vitest runs module-level imports before `beforeAll`, there is a window where `uploadOriginalDir` is `undefined`. The getter closes over the outer variable, so by the time a test body runs, `uploadOriginalDir` is set — the pattern is correct but requires careful reading to verify.

---

### admin-backfill-runner-batching.test.ts

**FLAKINESS RISK: raw setTimeout waits (TEST-R5C2-02, HIGH).**

All three tests use `await new Promise((r) => setTimeout(r, 500))` (lines 181, 193, 233) to wait for the async backfill to complete. The backfill runs in a detached async task after `triggerAdminBackfill()` returns `{ status: 'queued' }`. The 500ms wall-clock sleep is the only synchronization barrier.

On a loaded CI runner or a system with high I/O latency (mocked `db.execute` does async work via `processImageFormats` mock), 500ms may not be sufficient. If the backfill processes 150 rows with `await queue.onIdle()` between batches, and the per-job mock calls are slow, the assertions can fail with 0 batches observed. This is a genuine flakiness risk — not a fake-timer issue (the test doesn't use `vi.useFakeTimers`) but a wall-clock race. The fix is to return a promise from `triggerAdminBackfill` that resolves when the work is done, or to expose an `onIdle`-equivalent for testing.

**Mock dispatch ambiguity:** The `buildExecuteMock` in test (a) and (b) uses a shared `batchIndex` counter to decide whether a given `db.execute` call is a COUNT query, a SELECT batch query, or an UPDATE from `reprocessOne`. The comment acknowledges this ("we can't distinguish by call index alone") but the dispatch logic is fragile: since `processImageFormats` is mocked to return immediately, UPDATE calls from `reprocessOne` may interleave with SELECT calls if the PQueue concurrency allows overlap. The test sets no explicit PQueue concurrency.

---

### photo-title-stub-prefix-strip.test.ts

**Overall quality: EXCELLENT.**

Clean, behavior-driven tests. The mid-string non-strip test (line 71) correctly verifies regex anchoring. No issues.

---

### semantic-search-mode-validator.test.ts

**Overall quality: GOOD but narrow.**

Only tests `semantic_search_mode` key. The `isValidSettingValue` function handles many other keys (avif_effort, image_sizes, etc.) and the test adds nothing for those. Scope is appropriate for the specific CRT-R5C1-01 fix, but the test name "gallery-config-shared.test.ts" already exists and covers `isValidSettingValue` more broadly — the new test is additive and non-overlapping.

---

## 2. Full test surface inventory and coverage map

### Tested source modules (lib/)

action-guards.ts, action-result.ts, admin-backfill-runner.ts, admin-tokens.ts, advisory-locks.ts (partial — LOCK_ADMIN_DELETE only), analytics-data.ts (via analytics.test.ts), analytics.ts, api-auth.ts, atom-feed.ts, audit.ts, auth-rate-limit.ts, avif-support.ts (probe), backup-filename.ts, base56.ts, blur-data-url.ts, bounded-map.ts, bulk-edit-types.ts (via bulk-update-images.test.ts), caption-generator.ts (ALT_TEXT_STUB_PREFIX only — generateCaption untested), clip-embeddings.ts, clip-inference.ts (stub only), clipboard.ts, color-detection.ts, color-pipeline-decisions.ts, color-primaries.ts, constants.ts (via locale-path.test.ts), content-security-policy.ts, csv-escape.ts, data-timeline.ts, data.ts, db-restore.ts, download-filename.ts, download-interstitial.ts, download-tokens.ts, error-shell.ts, exif-datetime.ts, feed-conditional.ts, gain-map-detection.ts, gallery-config-shared.ts, gps-exif-strip.ts, hdr-filenames.ts, icc-chromaticity.ts, icc-extractor.ts, image-queue.ts, image-types.ts (via process-image tests), image-url.ts, image-zoom-math.ts, ime.ts, license-tiers.ts, locale-path.ts, mysql-cli-ssl.ts, mysql-datetime.ts, og-photo-fetch.ts (source contract), password-hashing.ts (constants only), photo-title.ts, process-image.ts, queue-shutdown.ts, rate-limit.ts, request-origin.ts, restore-maintenance.ts, revalidation.ts, safe-json-ld.ts, sanitize.ts, seo-og-url.ts, serve-upload.ts, session.ts, settings-hash.ts, smart-collections.ts, sql-restore-scan.ts, storage/local.ts, stripe.ts (source contract only), sw-cache.ts, tag-records.ts, tag-slugs.ts, theme.ts, upload-filenames.ts, upload-limits.ts, upload-paths.ts (NO direct tests — plan-315 item 17), upload-tracker.ts, upload-tracker-state.ts, use-display-capability.ts, validation.ts

### Untested or minimally tested source modules (lib/)

| Module | Tested? | Notes |
|---|---|---|
| `caption-generator.ts` | PARTIAL | Only `ALT_TEXT_STUB_PREFIX` constant imported; `generateCaption` logic, error-handling, input shape, DB write entirely untested |
| `csp-nonce.ts` | NO | Pure utility but affects CSP header generation |
| `gallery-config.ts` | NO direct tests | `getGalleryConfig` tested only through mocks in other tests; the actual resolver logic, env-var override paths, and admin_settings merge untested |
| `process-topic-image.ts` | NO direct tests | `processTopicImage`, `deleteTopicImage`, `cleanOrphanedTopicTempFiles` all mocked-out in other tests but never unit-tested |
| `upload-processing-contract-lock.ts` | NO | `acquireUploadProcessingContractLock` always mocked, never tested |
| `utils.ts` | NO direct tests | `countCodePoints` (used in validation.ts length checks) untested as a standalone function |

### Untested app/actions modules

| Module | Notes |
|---|---|
| `actions/collections.ts` | Smart-collection actions tested via smart-collections.test.ts (source contract) but no behavioral unit tests |
| `actions/embeddings.ts` | No behavioral tests |
| `actions/settings.ts` (full mutation) | `saveSettings`, `validateSettings`, individual setting save paths tested only by source contracts; the full action flow (auth → validate → DB write → hash-update) has no integration test |

---

## 3. Test findings — NEW (not in suppression list)

---

### TEST-R5C2-01 — checkout-route.test.ts: unknown-IP idempotency branch not tested
**File:** `apps/web/src/__tests__/checkout-route.test.ts`
**Severity:** HIGH
**Confidence:** confirmed

`getClientIp` is hardcoded to `'203.0.113.9'` in the mock (line 46). The `'unknown'` return path — which causes all concurrent buyers without TRUST_PROXY configured to share the idempotency key `checkout-{imageId}-unknown-{minute}` — has no test. This is the exact defect TRC-R5C1-16 describes (plan-315 item 6 calls for extending these tests). The checkout route was added this cycle but the extension was omitted.

**Bug class:** Two simultaneous buyers on a deployment without TRUST_PROXY configured receive the same Stripe checkout session URL. First buyer to complete pays; second buyer's payment is potentially attributed to the wrong session.

**Suggested test:**
```typescript
it('(7) unknown IP → idempotency key contains "unknown" and is unique per call', async () => {
  // Mock getClientIp to return 'unknown'
  // Two POST calls to same imageId in same minute must each create a Stripe session
  // Key must contain 'unknown' and a unique UUID component
});
```

---

### TEST-R5C2-02 — admin-backfill-runner-batching.test.ts: raw setTimeout synchronization
**File:** `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:181,193,233`
**Severity:** HIGH
**Confidence:** confirmed

All three tests synchronize with the detached async backfill task using `await new Promise((r) => setTimeout(r, 500))`. This is a wall-clock sleep with no deterministic completion guarantee. On a loaded CI runner processing 100-150 mock rows through a PQueue (even with mocked Sharp), 500ms can be insufficient. The tests will pass locally but fail intermittently in CI.

**Bug class:** False negative in CI — a real regression in batching is masked by the test failing for the wrong reason (timing), or a passing CI run gives false confidence because the assertions ran before the work completed.

**Fix:** `triggerAdminBackfill` should return a `Promise<{ status: string; completion: Promise<void> }>` or expose a `getRunningBackfillPromise()` for tests, allowing deterministic `await completion` instead of a sleep. Alternatively, use a `vitest` fake timer with `vi.runAllTimersAsync()` after mocking the PQueue's `onIdle`.

---

### TEST-R5C2-03 — session-verify.test.ts: module-level cache not explicitly reset
**File:** `apps/web/src/__tests__/session-verify.test.ts:46-68`
**Severity:** MEDIUM
**Confidence:** confirmed

`cachedSessionSecret` and `sessionSecretPromise` are module-level variables in `session.ts`. The test relies on `vi.resetModules()` in `afterEach` to produce a fresh module on each `await import('@/lib/session')`. This works today, but:
1. The `getSessionSecret` describe block does NOT call `vi.resetModules()` in `beforeEach` — it only does so in `afterEach`. If a test throws before `afterEach` runs, the module cache is left polluted for subsequent tests.
2. The DB-fallback test (case 4) uses `NODE_ENV=test` — if `cachedSessionSecret` is already set (e.g., from a leaked state from a prior test or test-file run order), the DB branch is never reached and the test passes vacuously.

**Bug class:** Test isolation failure produces false-passing tests. A future refactor that breaks the DB fallback path won't be caught.

**Fix:** Add `vi.resetModules()` to `beforeEach` in the `getSessionSecret` describe block, not only `afterEach`.

---

### TEST-R5C2-04 — sw-cache.test.ts: wall-clock sleep for timestamp ordering
**File:** `apps/web/src/__tests__/sw-cache.test.ts:191`
**Severity:** MEDIUM
**Confidence:** confirmed

```javascript
await new Promise((r) => setTimeout(r, 2));
```
The test "updates timestamp on re-insert" relies on 2ms of real wall-clock time elapsing between two `recordAndEvict` calls to verify that the second timestamp is >= the first. On a heavily loaded CI system, if the Node.js event loop is delayed, this can produce `first === second` (same millisecond timestamp), causing the test to pass vacuously (`>=` instead of `>`). Conversely, if the test runner has fake timers accidentally active, the delay never elapses.

**Fix:** Use `vi.useFakeTimers()` and `vi.advanceTimersByTime(1)` between calls, or use `vi.setSystemTime(Date.now() + 10)` to guarantee the timestamp advances. If `sw-cache.ts` uses `Date.now()` for timestamps, fake timers are the correct tool.

---

### TEST-R5C2-05 — caption-generator.ts: generateCaption logic entirely untested
**File:** `apps/web/src/lib/caption-generator.ts`
**Severity:** HIGH
**Confidence:** confirmed

`generateCaption(input: CaptionInput): Promise<string>` contains:
- The stub `generateCaptionStub` building the `[AUTO] Photo taken with {camera_model}` string
- Error handling (catch block — what happens on caption stub throw?)
- The exported `ALT_TEXT_STUB_PREFIX` constant (tested only as an import in photo-title-stub-prefix-strip.test.ts)

No test exercises `generateCaption(input)` directly. The only test coverage is that `ALT_TEXT_STUB_PREFIX` is importable. The full caption generation path — including the fallback when `camera_model` is empty/null, the `catch` block behavior, and the prefix attachment — has zero behavioral tests.

**Bug class:** Any regression in caption generation (wrong prefix, wrong fallback, swallowed exception) will reach production undetected. The caption feeds into `alt_text_suggested`, which feeds `getConcisePhotoAltText`, which feeds page `<title>`, OG meta, and photo viewer. A broken caption stub produces wrong accessibility text sitewide.

**Suggested test (new file `__tests__/caption-generator.test.ts`):**
```typescript
it('produces [AUTO] prefix + camera model when model is present')
it('produces [AUTO] Photo fallback when camera_model is empty')
it('resolves even if stub throws')
it('prefix matches ALT_TEXT_STUB_PREFIX constant')
```

---

### TEST-R5C2-06 — advisory-locks.ts: only LOCK_ADMIN_DELETE pinned; 5 other lock names unguarded
**File:** `apps/web/src/__tests__/admin-delete-lock-source.test.ts:10`
**Severity:** MEDIUM
**Confidence:** confirmed

`admin-delete-lock-source.test.ts` only pins `LOCK_ADMIN_DELETE = 'gallerykit_admin_delete'`. The other exported constants (`LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_COLOR_PIPELINE_BACKFILL`) and the `getImageProcessingLockName` function are documented in CLAUDE.md as critical (server-scoped, shared across tenants) but have no fixture test pinning their exact string values. Plan-315 item 19 calls for this test. It is listed in the suppression index above.

**Note for plan:** This is a suppressed item per plan-315 item 19. Reporting for completeness — the `admin-delete-lock-source.test.ts` only partially satisfies the intent. The new test should cover all 5 constants + `getImageProcessingLockName`.

---

### TEST-R5C2-07 — migration-journal.test.ts: not yet created
**File:** `apps/web/src/__tests__/migration-journal.test.ts` (does not exist)
**Severity:** HIGH
**Confidence:** confirmed

Plan-315 item 14 calls for a fixture test asserting (1) `when` timestamps strictly increase for idx > 7, and (2) every journal `tag` has a matching `.sql` file and vice versa. This test does not exist as of the current HEAD. Without it, the "burned once" failure mode (stale `when` timestamp causing drizzle to silently skip migrations) can recur — the first time a developer adds a migration with a non-monotonic `when`, the production deploy silently skips it and `npm test` passes.

**Bug class:** Silent schema drift in production. The CLAUDE.md documents this as a real incident that caused months of the color/HDR columns being absent.

---

### TEST-R5C2-08 — process-topic-image.ts: no unit tests for topic image processing
**File:** `apps/web/src/lib/process-topic-image.ts`
**Severity:** MEDIUM
**Confidence:** confirmed

`processTopicImage` (saves and resizes a topic cover image), `deleteTopicImage` (unlinks old topic image files), and `cleanOrphanedTopicTempFiles` (removes `.tmp` files left by crash) have no unit tests. They are always mocked in consuming tests. The actual Sharp pipeline, path construction, temp file cleanup logic, and error handling are exercised only in production.

**Bug class:** A regression in topic image processing (wrong output path, uncaught Sharp error, temp file leak) would be invisible to the test suite.

---

### TEST-R5C2-09 — gallery-config.ts resolver: no unit tests for actual getGalleryConfig logic
**File:** `apps/web/src/lib/gallery-config.ts`
**Severity:** MEDIUM
**Confidence:** confirmed

`getGalleryConfig` reads from `admin_settings` DB rows and applies defaults from `GALLERY_DEFAULTS`. It is the central config resolver used by the image queue, serve-upload, backfill, and upload actions. Every test that calls this function mocks it out. The actual merge logic (DB override wins; unknown keys ignored; type coercion of strings to numbers/booleans; env-var `QUEUE_CONCURRENCY` override) has no unit test.

**Bug class:** A bug in the merge/coercion logic (e.g., a number setting reading as NaN, a boolean setting coerced wrong) affects the entire pipeline but is invisible to tests.

---

### TEST-R5C2-10 — e2e: /s/[key] shared-link page has no e2e coverage
**File:** `apps/web/e2e/public.spec.ts`
**Severity:** MEDIUM
**Confidence:** confirmed

The public e2e suite covers: homepage (`/`), search dialog, photo viewer (`/p/[id]`), heading hierarchy, and shared-group page (`/g/[key]`). The `/s/[key]` shared-link route (the simpler single-image or single-file share route, distinct from shared groups) has no e2e test at all. Additionally, there is no e2e test for:
- An unknown route returning a 404 page
- The locale prefix routes (`/ko/` vs `/en/`) rendering correctly for non-homepage paths

**Bug class:** A regression in shared-link rendering (broken server component, wrong DB query, 500 error) would only be caught by users.

---

### TEST-R5C2-11 — e2e: admin login redirect only asserts URL, not actual login mechanism
**File:** `apps/web/e2e/admin.spec.ts:14-18`
**Severity:** LOW
**Confidence:** confirmed

The "protected admin routes redirect to login" test checks that `/admin/dashboard` redirects to `/admin` and that the username placeholder is visible. It does NOT attempt a login and verify failure (wrong password → error message) or verify that the session cookie is set after correct login. The `loginAsAdmin` helper (used in subsequent tests) is opt-in (`adminE2EEnabled`). The non-admin path (no E2E credentials configured) only tests the redirect, not the full login/auth cycle.

---

### TEST-R5C2-12 — download route: GET interstitial path has source-contract coverage only
**File:** `apps/web/src/__tests__/download-route-method-contract.test.ts`
**Severity:** MEDIUM
**Confidence:** confirmed

The download route's GET handler builds and returns a localized HTML interstitial page. The existing `download-route-method-contract.test.ts` uses source-text scanning to verify the GET path calls `validateDownloadRequest` and contains no DB writes. But there are no behavioral tests for:
- GET with a valid token → returns 200 HTML with correct Content-Type, CSP header, form action attribute
- GET with expired token → returns 410
- GET with refunded token → returns 410
- GET HTML content: contains the correct localized strings (title, button text)
- GET returns `X-Robots-Tag: noindex, nofollow` (important for privacy)

**Bug class:** A regression in the interstitial HTML (broken CSP, wrong form action, missing X-Robots-Tag) would expose download links to search indexing or allow clickjacking.

---

### TEST-R5C2-13 — checkout-route.test.ts: mock select chain is order-dependent and brittle
**File:** `apps/web/src/__tests__/checkout-route.test.ts:82-97`
**Severity:** LOW
**Confidence:** confirmed

The `buildSelectChain` helper uses a call-counter (`callCount`) to return different data for the first vs. second `db.select().from().where().limit()` call. This assumes the checkout route always issues: (1) image SELECT, (2) settings SELECT, in that fixed order. If the route is refactored to cache the settings lookup or change query order, the mock will silently serve wrong data for both calls — e.g., the image query returns a settings row, causing the route to 404 or 400 for a wrong reason, and the test still passes (or fails for the wrong reason).

**Fix:** Use `mockImplementationOnce` pairs with explicit labels, or use route-specific DB mock shapes keyed by table name.

---

### TEST-R5C2-14 — utils.ts countCodePoints: no standalone unit test
**File:** `apps/web/src/lib/utils.ts`
**Severity:** LOW
**Confidence:** confirmed

`countCodePoints(str: string): number` is used by `isValidTopicAlias`, `isValidTagName`, and `isValidTagSlug` for max-length enforcement with supplementary characters. It is tested indirectly through `validation.test.ts` but has no standalone test for the emoji/CJK surrogate-pair counting behavior. A regression in this function (e.g., a TypeScript upgrade changes string iteration) could silently cause valid long-CJK aliases to be rejected.

---

### TEST-R5C2-15 — admin-backfill-runner-batching.test.ts: asserting on async side-effects via shared mutable array
**File:** `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:130-163`
**Severity:** MEDIUM
**Confidence:** likely

The `buildExecuteMock` function returns a `batchSizes` array that is mutated by the mock's async callbacks. The test then asserts on this array after the 500ms sleep. Because `batchSizes.push(batch.length)` runs inside the mock implementation (which runs inside the PQueue processing loop), the array mutation is concurrent with the test body. If the 500ms sleep ends before all `db.execute` mock calls have resolved (possible under high load), `batchSizes` will have fewer entries than expected, producing a false failure rather than a real one.

This is a variant of TEST-R5C2-02 but specifically about the assertion mechanism, not just the timing wait.

---

### TEST-R5C2-16 — session-verify.test.ts: `cache()` wrapper means verifySessionToken may be deduped across tests
**File:** `apps/web/src/__tests__/session-verify.test.ts`, `apps/web/src/lib/session.ts:94`
**Severity:** MEDIUM
**Confidence:** likely

`verifySessionToken` is wrapped in React's `cache()`:
```typescript
export const verifySessionToken = cache(async function verifySessionToken(...) {...});
```
React's `cache()` deduplicates calls within a single React render tree (server request context). In a Vitest environment, the deduplication cache may persist between test cases if the module is not re-imported (because `vi.resetModules()` is only in `afterEach`, not `beforeEach`). This means test (8) ("valid fresh token") could receive a cached null from test (6) ("valid signature but no DB row") if both use the same token string.

The test mitigates this partially by generating a new token in each test (`makeToken(TEST_SECRET)` with a fresh `Date.now()` timestamp). However if two tests happen to call `makeToken` at the exact same millisecond, the tokens will be identical and `cache()` will return the first result.

**Fix:** Either call `vi.resetModules()` in `beforeEach` (before the mock setup), or use unique tokens per test (e.g., pass a unique `randomHex` option to `makeToken`).

---

## 4. Coverage gaps: untested source modules (full sweep)

| Source file | Coverage | Risk | Notes |
|---|---|---|---|
| `lib/caption-generator.ts` | NO behavioral | HIGH | `generateCaption` logic, error path, prefix application all untested |
| `lib/gallery-config.ts` | NO unit | HIGH | Config resolver merge/coercion logic only tested via mocks in other tests |
| `lib/process-topic-image.ts` | NO unit | MEDIUM | Topic image Sharp pipeline untested |
| `lib/upload-processing-contract-lock.ts` | NO unit | MEDIUM | Lock acquire/release contract only tested via integration via images.ts mocks |
| `lib/csp-nonce.ts` | NO | LOW | Pure nonce generator; low risk |
| `lib/utils.ts` (countCodePoints) | INDIRECT | LOW | Tested via validation.test.ts but not standalone |
| `actions/embeddings.ts` | NO | LOW | Stub-only CLIP embeddings; risk is low until ONNX ships |
| `actions/collections.ts` | SOURCE CONTRACT | MEDIUM | Smart collection CREATE/UPDATE/DELETE mutations untested behaviorally |

---

## 5. Flakiness audit

### Confirmed flaky risks

| ID | File | Lines | Mechanism | Risk |
|---|---|---|---|---|
| TEST-R5C2-02 | admin-backfill-runner-batching.test.ts | 181,193,233 | 500ms wall-clock sleep for async completion | HIGH — CI-flaky |
| TEST-R5C2-04 | sw-cache.test.ts | 191 | 2ms wall-clock sleep for timestamp ordering | MEDIUM — rare but possible |
| TEST-R5C2-15 | admin-backfill-runner-batching.test.ts | 130-163 | Async mutation of shared `batchSizes` array | MEDIUM |

### Clean patterns (no issues)

- `admin-backfill-runner-leak.test.ts` uses `setImmediate` (not `setTimeout`) to yield the event loop — this is deterministic; no flakiness risk.
- `bounded-map.test.ts` uses `vi.useFakeTimers()` + `vi.setSystemTime()` correctly — no real time dependency.
- `session-verify.test.ts` `vi.stubEnv` + dynamic import pattern is correct.
- `checkout-route.test.ts` has no timing dependencies.

---

## 6. E2E gap analysis

### Current e2e coverage (public.spec.ts + admin.spec.ts)

| Journey | Covered |
|---|---|
| Homepage loads, photos visible | YES |
| Locale switch (EN↔KO) | YES |
| Search dialog open/focus/close | YES |
| Search matches topic labels and aliases | YES |
| Photo viewer `/p/[id]` opens, h1 count | YES |
| Lightbox opens/closes | YES |
| Heading hierarchy h1→h2→h3 | YES |
| Shared group `/g/[key]` renders and navigates | YES |
| Admin redirect to login when unauthenticated | YES |
| Admin login and navigation (opt-in) | YES |
| Admin GPS toggle (opt-in) | YES |
| Admin topic create/delete (opt-in) | YES |
| Shared link `/s/[key]` | **NO** |
| Unknown route → 404 | **NO** |
| Paid download interstitial GET | **NO** |
| Paid download POST claim (plan-315 item 21) | **NO** |
| Admin upload workflow (opt-in) | **NO** |
| Admin settings save/restore | **NO** |
| Rate-limit shape on public endpoints | **NO** |

---

## 7. Summary coverage map by directory

| Directory | Files | Unit-tested | Notes |
|---|---|---|---|
| `src/lib/` | 82 | ~72 (88%) | caption-generator, gallery-config, process-topic-image, upload-processing-contract-lock, csp-nonce lack unit tests |
| `src/app/actions/` | 14 | ~9 (64%) | embeddings, collections (behavioral), settings (behavioral) lack unit tests |
| `src/app/api/admin/**/route.ts` | ~12 | ~8 (67%) | lint:api-auth covers auth; behavioral coverage varies |
| `src/app/api/download/[imageId]/route.ts` | 1 | SOURCE CONTRACT | GET handler behavior untested |
| `src/app/api/checkout/[imageId]/route.ts` | 1 | PARTIAL | Unknown-IP branch missing |
| `src/app/api/stripe/webhook/route.ts` | 1 | SOURCE CONTRACT | Behavioral tests in plan-315 item 22 |
| `e2e/` | 5 | 2 active | /s/ route, 404, paid-download uncovered |

---

## 8. Prioritized action items (new findings only)

| ID | Severity | Action |
|---|---|---|
| TEST-R5C2-01 | HIGH | Add unknown-IP idempotency test to checkout-route.test.ts |
| TEST-R5C2-02 | HIGH | Replace 500ms sleeps in admin-backfill-runner-batching.test.ts with deterministic completion signal |
| TEST-R5C2-05 | HIGH | Add caption-generator.test.ts (generateCaption behavioral tests) |
| TEST-R5C2-07 | HIGH | Add migration-journal.test.ts (plan-315 item 14, not yet created) |
| TEST-R5C2-03 | MEDIUM | Add vi.resetModules() to beforeEach in getSessionSecret describe block |
| TEST-R5C2-04 | MEDIUM | Replace 2ms sleep in sw-cache.test.ts with fake timers |
| TEST-R5C2-08 | MEDIUM | Add process-topic-image.test.ts (Sharp pipeline, temp file cleanup) |
| TEST-R5C2-09 | MEDIUM | Add gallery-config.test.ts (resolver merge, coercion, env-var override) |
| TEST-R5C2-10 | MEDIUM | Add /s/[key] and 404 e2e specs |
| TEST-R5C2-12 | MEDIUM | Add download route GET handler behavioral tests |
| TEST-R5C2-15 | MEDIUM | Fix async side-effect assertion pattern in batching test |
| TEST-R5C2-16 | MEDIUM | Ensure unique tokens per session-verify test to prevent cache() dedup |
| TEST-R5C2-13 | LOW | Replace order-dependent select mock chain in checkout-route.test.ts |
| TEST-R5C2-14 | LOW | Add standalone countCodePoints unit tests |

---

## 9. Test run status

**196 test files, 1881 tests — all PASSED (exit 0)**
Command: `npm test --workspace=apps/web` (Vitest 4.1.4)
Duration: 300.92s (transform 219.44s, import 951.43s, tests 170.47s)

All cycle-1 new tests pass cleanly. The flakiness findings (TEST-R5C2-02, TEST-R5C2-04, TEST-R5C2-15) are latent risks identified via static analysis — they did not manifest on this run, which is consistent with their classification as CI-load-dependent races rather than deterministic failures.
