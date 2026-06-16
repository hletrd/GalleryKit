# Test Engineer Review — GalleryKit
**Cycle:** 2 / 100
**HEAD:** `8ccc8806` (branch: master)
**Date:** 2026-06-16
**Suite result:** 2145 passed, 2 skipped (CLIP weight-gate), 0 failed
**Typecheck:** PASS (0 errors, tsc + tsconfig.typecheck.json covers `__tests__/`)

---

## 1. Test Suite Inventory

**Total test files:** 231 under `apps/web/src/__tests__/`
**E2E suite:** `apps/web/e2e/` (Playwright — not exercised in this cycle, unit focus only)

### Subsystem coverage map

| Subsystem | Key test files | Status |
|---|---|---|
| GPS EXIF strip | `strip-gps-from-original.test.ts` | Excellent — JPEG/AVIF/WebP/TIFF + forensic zero-residue |
| Auth / session | `session-verify.test.ts`, `auth-rate-limit.test.ts` | Good, two gaps (see TEST-02, TEST-03) |
| Rate limiting (DB layer) | `rate-limit.test.ts` | Gap — DB functions untested (TEST-01) |
| Path traversal / serve-upload | `serve-upload.test.ts`, `serve-upload-settings-debounce.test.ts` | Good — symlink parent traversal covered |
| Privacy fields compile guard | `privacy-fields.test.ts` | Excellent — whitelist-set-difference guard |
| Migration monotonicity | `migration-journal-monotonicity.test.ts`, `migration-journal.test.ts` | Excellent — allowlisted historical inversion, post-condition predicate |
| CSV escape | `csv-escape.test.ts` | Excellent — CRLF collapse, bidi strip, ZWS, formula prefix, whitespace tolerance |
| Validation / Unicode | `validation.test.ts` | Good — bidi/invisible chars on topic alias, 69 tests |
| Image processing pipeline | `process-image-metadata.test.ts`, `process-image-blur-wiring.test.ts` | Good |
| Admin backfill runner | `admin-backfill-runner-detection-failure.test.ts`, `admin-backfill-runner-fatal-counters.test.ts`, `admin-backfill-runner-batching.test.ts`, `admin-backfill-concurrency-cap.test.ts` | Good — run-6 AGG counters, pool cap, batching |
| Color detection | `color-detection.test.ts`, `icc-chromaticity.test.ts` | Good |
| ICC extractor | Used in `color-detection.test.ts` + `og-image-icc.test.ts` | Covered indirectly |
| ETag / settings hash | `settings-hash.test.ts`, `serve-upload-settings-debounce.test.ts` | Good — stale-while-revalidate TTL covered |
| Service worker / LRU | `sw-cache.test.ts`, `sw-template-contract.test.ts` | Good |
| Analytics | `analytics.test.ts` | Good — TLD+1, bot detection, referrer sanitization |
| Stripe / checkout | `checkout-route.test.ts`, `checkout-db-error-rollback.test.ts`, `stripe-webhook-source.test.ts`, `stripe-download-tokens.test.ts` | Good — source-contract guards, idempotency, FK race |
| CLIP (dark / disabled) | `clip-embeddings.test.ts`, `clip-model-contract.test.ts`, `clip-semantic-integration.test.ts` (skip-gated), `backfill-clip-embeddings-reembed.test.ts` | Adequate for dark feature (see TEST-06) |
| Advisory locks | `restore-upload-lock.test.ts`, `upload-processing-contract-lock.test.ts` | Source-contract level only (see TEST-05) |
| Upload paths | `upload-paths.test.ts` | Good |
| Blur data URL | `process-image-blur-wiring.test.ts`, `images-action-blur-wiring.test.ts` | Good — symmetric producer/consumer contract |
| Touch-target audit | `touch-target-audit.test.ts` | Blocking gate, covers multi-line normalization |
| API auth lint | `check-api-auth.test.ts` | Fixture-based, covers all admin routes |
| Action origin lint | `check-action-origin.test.ts` | Fixture-based, covers all action files |
| Public route rate-limit lint | `check-public-route-rate-limit.test.ts` | Fixture-based |

---

## 2. Findings

### TEST-01 — DB rate-limit functions have zero unit tests
**Severity:** High
**Confidence:** High
**File:** `apps/web/src/lib/rate-limit.ts` lines 419–502
**Functions:** `incrementRateLimit`, `decrementRateLimit`, `resetRateLimit`

These three exported async functions are the only persistent rate-limit state for IP-scoped checkout, search, and public-route limiting. All higher-level tests (`smart-collection-pagination.test.ts`, `checkout-route.test.ts`, etc.) mock `rate-limit` at the module boundary and never call the real implementations.

`decrementRateLimit` has a critical transactional shape: UPDATE `GREATEST(count-1, 0)`, then DELETE WHERE `count <= 0`. If someone were to swap the UPDATE and DELETE ordering, or remove the transaction, or change `GREATEST(count-1, 0)` to `count - 1` (allowing negative counts), no test would catch it.

**Concrete regression scenario:** Removing the `GREATEST()` guard or the transaction allows the count to go negative under concurrent decrements, breaking the "rollback on navigation away from checkout" guarantee and permanently blocking subsequent checkout attempts for the IP.

**Suggested test file:** `apps/web/src/__tests__/rate-limit-db.test.ts`

Verify with mocked `db`:
1. `incrementRateLimit` calls INSERT with `onDuplicateKeyUpdate` — count increments correctly.
2. `decrementRateLimit` wraps UPDATE + DELETE in a `db.transaction()`; UPDATE uses `GREATEST(count-1, 0)`.
3. `resetRateLimit` issues DELETE matching `ip + type + bucketStart`.

---

### TEST-02 — `rollbackLoginRateLimit` (IP-scoped) is untested
**Severity:** High
**Confidence:** High
**File:** `apps/web/src/lib/auth-rate-limit.ts`
**Function:** `rollbackLoginRateLimit`

`auth-rate-limit.test.ts` directly tests `rollbackAccountLoginRateLimit` (account-scoped bucket) but has no test for `rollbackLoginRateLimit` (IP-scoped bucket). The count=1→delete transition is the path that clears the IP bucket on rollback. If a developer removes the `if (entry.count <= 1) { loginRateLimit.delete(ip) }` branch, replacing it with `entry.count--` only, the IP bucket leaks and every IP that ever had a failed login accumulates a permanent entry, tightening the effective window from 5 to 4 attempts for returning users.

**Concrete regression scenario:** Production shows that a user who failed once and then succeeded is rate-limited sooner than expected on subsequent sessions. No test would catch the missing delete.

**Suggested tests** (add to `apps/web/src/__tests__/auth-rate-limit.test.ts`):
- Record one failure → rollback → assert IP is no longer present in the in-memory map.
- Record two failures → rollback → assert count is 1, entry still present.

---

### TEST-03 — `getSessionSecret` generate-new-secret path not covered
**Severity:** Medium
**Confidence:** High
**File:** `apps/web/src/lib/session.ts`
**Function:** `getSessionSecret` (dev/test fallback branch — INSERT IGNORE + re-fetch path)

`session-verify.test.ts` mocks `findFirst` to return an existing row immediately in the dev DB-backed secret path. The INSERT IGNORE + re-fetch path — where `findFirst` returns null (empty table), the function inserts a new random secret, then re-fetches — is never exercised.

**Concrete regression scenario:** A refactor that removes the `db.insert` call and jumps straight to re-fetch would cause `getSessionSecret` to loop (if re-fetch also returns null) or throw in dev/test environments where `SESSION_SECRET` is not set. No test would catch it.

**Suggested test** (add to `apps/web/src/__tests__/session-verify.test.ts`):
Mock `findFirst` to return null on the first call (empty table) then return a value on the second call (post-insert). Assert that the insert mock was called once and the returned secret matches the re-fetched value.

---

### TEST-04 — `decrementRateLimit` transaction ordering is not asserted
**Severity:** Medium
**Confidence:** High
**File:** `apps/web/src/lib/rate-limit.ts` lines 461–501

This is a sub-aspect of TEST-01 worth flagging separately. `decrementRateLimit` uses `db.transaction()` to make the UPDATE and DELETE atomic. Without a test that calls the real function with a mock `db`, there is no assertion that a transaction is used at all. Simplifying it to two bare `db.execute` calls would introduce a race window where a concurrent read sees count=0 but the row still exists, but no test would surface the breakage.

**Suggested test:** Covered by the file proposed in TEST-01 — assert `db.transaction` is invoked and both the UPDATE and DELETE execute within its callback.

---

### TEST-05 — Advisory lock `release()` double-call idempotency is source-asserted, not behavioral
**Severity:** Low
**Confidence:** Medium
**Files:** `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/__tests__/restore-upload-lock.test.ts`

The test suite has source-contract tests asserting the lock module imports `GET_LOCK` / `RELEASE_LOCK` and that `release()` is idempotent. However, no test calls `release()` twice on a live mock and asserts that only one `RELEASE_LOCK` DB query is issued.

The risk is low (the implementation uses a `released` guard flag), but if the guard is removed in a refactor, double-release would issue a spurious `RELEASE_LOCK` query. MySQL silently handles this, so no error surfaces — but the guard's removal would go undetected.

**Suggested test:** Mock `db` / `connection`, acquire the lock, call `release()` twice, assert the mock's query method was called for `RELEASE_LOCK` exactly once.

---

### TEST-06 — CLIP dark-feature semantic search route has no source-contract guard
**Severity:** Low
**Confidence:** Medium
**File:** `apps/web/src/app/api/search/semantic/route.ts`
**Context:** CLIP is dark / disabled. Do not activate.

The `clip-semantic-integration.test.ts` suite is correctly skip-gated on model weights. The structural tests (`clip-embeddings.test.ts`, `clip-model-contract.test.ts`) cover cosine similarity, buffer roundtrip, dimension constants, and model manifest shape.

The gap: the semantic search route itself has no source-contract test equivalent to `stripe-webhook-source.test.ts`. If the `semanticSearchMode === 'disabled'` guard were accidentally removed from the route, the route would attempt to call the encoder on every public search request. No existing test would catch the guard being dropped.

**Suggested test (low priority):** Source-contract test (read `route.ts` as a string) that asserts:
1. The file checks `semanticSearchMode` before calling any embed function.
2. The disabled path returns a 404 or empty result rather than proceeding to inference.

---

## 3. Flaky Pattern Sweep

### 3a. Tests using `Date.now()` without fake timers

| File | Usage | Risk |
|---|---|---|
| `audit-retention.test.ts` | `Date.now()` in assertions | None — `vi.useFakeTimers()` + `vi.setSystemTime('2026-06-11T00:00:00Z')` in `beforeAll`, `vi.useRealTimers()` in `afterAll`. Correctly isolated. |
| `stripe-download-tokens.test.ts` lines 128–133 | Arithmetic comparison (`now + 23h < expiresAt`) | None — `expiresAt` derived from same `now` capture; comparisons are pure arithmetic. |
| `session-verify.test.ts` lines 84, 93, 144, 159 | Relative offsets (`Date.now() - 25h`, `Date.now() + 1h`) | Effectively none — 1-second margin used for expired-session test. Cannot flip unless test execution takes over 24 hours. |

No flaky time-based tests found.

### 3b. Tests using `setTimeout`/`setInterval` without fake timers

| File | Usage | Risk |
|---|---|---|
| `data-view-count-flush.test.ts` | Source-contract assertion only; reads source text | None |
| `admin-backfill-runner-batching.test.ts` | Comment notes no wall-clock sleeps (BUG-R5C2-04 fix); no timer calls in body | None |
| `lightbox-controls-contract.test.ts` | Source-contract only | None |
| `image-queue-quiesce.test.ts` line 136 | `state.bootstrapRetryTimer = setTimeout(() => {}, 60_000)` in test body without fake timers | Low — timer fires in worker background after test completes. Callback is a no-op so assertions are not affected, but the 60-second timer hangs in the worker without cleanup. Recommend `vi.useFakeTimers()` / `vi.useRealTimers()` or an explicit `clearTimeout` in `afterEach`. |

### 3c. Shared module-level mutable state in tests

The suite consistently uses `vi.resetModules()` in `beforeEach` wherever module-level singletons are relevant (`session-verify.test.ts`, `serve-upload-settings-debounce.test.ts`). No shared-state flakiness found. The pattern is applied correctly and uniformly.

### 3d. Skipped / `.only` tests

- 2 tests skipped: `clip-semantic-integration.test.ts` — correctly gated on model weights (`describe.skip` when `RUN` is false). Expected and documented.
- 0 `.only` tests in the suite.
- No `xtest`, `xdescribe`, `xit` found.

---

## 4. Verification

```
npm test --workspace=apps/web
Result: 2145 passed, 2 skipped, 0 failed

npm run typecheck --workspace=apps/web
Result: 0 errors
```

---

## 5. Summary

**Coverage:** Broadly excellent for a codebase of this complexity. 231 test files, 2145 passing tests, no failures. The security-critical surfaces (GPS strip, path traversal, privacy field guard, migration post-conditions, auth session, backfill idempotency, CSV escape, Stripe webhook) all have targeted tests that would catch regressions if the protection were removed.

**Gaps cluster in one area:** the DB-layer rate-limit functions (`incrementRateLimit`, `decrementRateLimit`, `resetRateLimit`) have zero unit tests. These are called from several public API routes and the checkout flow. The `decrementRateLimit` transactional ordering is especially correctness-critical and is invisible to the current test suite.

| Severity | Count | IDs |
|---|---|---|
| High | 2 | TEST-01, TEST-02 |
| Medium | 2 | TEST-03, TEST-04 |
| Low | 2 | TEST-05, TEST-06 |

**Top 3 one-liners:**
1. TEST-01: `incrementRateLimit` / `decrementRateLimit` / `resetRateLimit` in `apps/web/src/lib/rate-limit.ts` have zero unit tests — removing the `GREATEST()` guard or the transaction in `decrementRateLimit` would not be caught by anything.
2. TEST-02: `rollbackLoginRateLimit` (IP-scoped, `apps/web/src/lib/auth-rate-limit.ts`) is untested — the count=1→delete transition that clears the IP bucket has no coverage, so a silent removal of the delete would go undetected.
3. TEST-03: `getSessionSecret` INSERT IGNORE + re-fetch branch is never exercised in `apps/web/src/__tests__/session-verify.test.ts` — removing the insert call would cause infinite re-fetch or a throw in dev/test environments with no test to catch it.
