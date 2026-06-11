# Test Engineer Review — Run 5 Cycle 1
Date: 2026-06-11
Reviewer: oh-my-claudecode:test-engineer
Baseline: 186 test files, 1799 tests, all passing (24 s)

---

## Methodology

Full inventory of `apps/web/src/__tests__/` (186 files, Vitest) and `apps/web/e2e/` (5 spec files, Playwright).
All four lint-gate scripts and their fixture tests reviewed.
Key security-critical source modules read in full: `session.ts`, `api-auth.ts`, `download-tokens.ts`, `gps-exif-strip.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `admin-tokens.ts`, `validation.ts`, `csv-escape.ts`, `bounded-map.ts`, `upload-paths.ts`, `password-hashing.ts`, `seo-og-url.ts`, `advisory-locks.ts`.
Both API route files under `app/api/` (download, checkout) read in full.

---

## Findings

### TEST-R5C1-01 — `verifySessionToken` has ZERO unit tests
**File:** `apps/web/src/lib/session.ts`  
**Lines:** 94–145  
**Severity:** CRITICAL  
**Confidence:** HIGH  
**Classification:** Security coverage gap

`session.ts:94–145` contains `verifySessionToken` — the entire session-authentication path: HMAC-SHA256 signature validation, `timingSafeEqual` comparison, token-age check (24 h max, negative-age clock-skew guard), DB session lookup, and expired-session deletion. The only test for `session.ts` is `session.test.ts`, which covers `hashSessionToken` (3 cases) and `generateSessionToken` format (1 case). `verifySessionToken` is never called in any test.

**Bug scenario:** A future refactor makes `timingSafeEqual` unreachable (e.g., the `signatureBuffer.length !== expectedSignatureBuffer.length` early-return branch is expanded incorrectly), enabling constant-time bypass and session forgery. No test would catch it. Similarly: the negative-age guard (`tokenAge < 0`) that blocks backdated tokens is untested — removing it ships a bypass silently.

**Suggested tests:**
- `verifySessionToken` returns null for a token with a wrong HMAC signature.
- `verifySessionToken` returns null for a token whose timestamp is more than 24 h old.
- `verifySessionToken` returns null for a token with a negative age (future timestamp).
- `verifySessionToken` returns null for a malformed token (wrong part count).
- `verifySessionToken` returns null when the DB session row is missing.
- `verifySessionToken` deletes expired DB sessions on lookup and returns null.
- `verifySessionToken` returns the session object for a valid, fresh token.

All these can be written with mocked `@/db` (same pattern as `admin-tokens.test.ts`).

---

### TEST-R5C1-02 — `BoundedMap` core logic has no unit tests
**File:** `apps/web/src/lib/bounded-map.ts`  
**Lines:** 1–142  
**Severity:** HIGH  
**Confidence:** HIGH  
**Classification:** Infrastructure coverage gap

`BoundedMap` is the eviction/expiry primitive used by all rate-limit Maps (login, account-login, search, share, checkout, OG). Its `prune()` method implements two critical behaviours: (1) collect-then-delete expired entries, and (2) hard-cap eviction of oldest entries. Neither path has a dedicated unit test. The only references in the test suite are incidental comments in `data-view-count-flush.test.ts` and `image-queue.test.ts`.

**Bug scenario:** The hard-cap eviction path (`this.map.size > this.maxKeys`) has an off-by-one risk — if the excess calculation is wrong, the Map could grow unboundedly in production (memory exhaustion) or evict too aggressively (legitimate rate-limit entries deleted, allowing brute-force). No test would catch either.

**Suggested tests (all pure, no DB):**
- `prune()` removes entries where `isExpired` returns true.
- `prune()` returns `true` when entries were removed, `false` otherwise.
- `prune()` enforces the hard cap by evicting oldest (insertion-order) entries.
- Hard cap eviction: set `maxKeys=3`, insert 5 entries, call `prune()`, assert exactly 3 remain and the 2 oldest are gone.
- `createResetAtBoundedMap` expiry: entry with `resetAt <= now` is pruned; entry with `resetAt > now` survives.
- `createWindowBoundedMap` expiry: entry older than `windowMs` is pruned; recent entry survives.

---

### TEST-R5C1-03 — `getSessionSecret` production-hardening guard not tested
**File:** `apps/web/src/lib/session.ts`  
**Lines:** 27–33  
**Severity:** HIGH  
**Confidence:** HIGH  
**Classification:** Security coverage gap

`getSessionSecret()` contains a critical production guard: when `NODE_ENV === 'production'` and `SESSION_SECRET` is absent/too short, it throws rather than falling back to the DB-stored secret (to avoid key-reuse on DB compromise). This guard is entirely untested — `session.test.ts` does not import or call `getSessionSecret`.

**Bug scenario:** The guard is accidentally inverted (e.g., `!== 'production'` becomes `=== 'production'`), causing the production instance to silently accept a DB-stored secret that could be obtained by DB-read compromise. No test catches this.

**Suggested tests (using `vi.stubEnv` / `vi.resetModules`):**
- `getSessionSecret` in production with short `SESSION_SECRET` throws with a message directing the operator to generate a 32-char secret.
- `getSessionSecret` in production with a valid `SESSION_SECRET` returns it without touching the DB.
- `getSessionSecret` in development with no env var falls through to the DB path (mock `@/db`).

---

### TEST-R5C1-04 — `isValidTokenShape` never tested as a unit
**File:** `apps/web/src/lib/download-tokens.ts`  
**Lines:** 43–52  
**Severity:** HIGH  
**Confidence:** HIGH  
**Classification:** Security coverage gap

`isValidTokenShape` is the first security gate in the download route (`D-101-05`): it short-circuits malformed tokens before any SHA-256 hashing or DB work. The existing `stripe-download-tokens.test.ts` tests `generateDownloadToken`, `hashToken`, and `verifyTokenAgainstHash` thoroughly, but never calls `isValidTokenShape` directly. The function is only reachable indirectly through `verifyTokenAgainstHash` (which calls it internally), but the boundary cases — null, undefined, too-short prefix, wrong prefix, right length but wrong charset, `dl_` plus 42 chars, `dl_` plus 44 chars — are not exercised.

**Bug scenario:** A regex change replaces `{43}` with `{43,}` (greedy), allowing arbitrarily long tokens to bypass the shape gate. The existing tests would still pass (generated tokens are exactly 46 chars), but the route would start doing unnecessary DB lookups on bloated inputs.

**Suggested tests:**
- `isValidTokenShape(null)` → false.
- `isValidTokenShape(undefined)` → false.
- `isValidTokenShape('dl_' + 'a'.repeat(42))` → false (too short).
- `isValidTokenShape('dl_' + 'a'.repeat(44))` → false (too long).
- `isValidTokenShape('xx_' + 'a'.repeat(43))` → false (wrong prefix).
- `isValidTokenShape('dl_' + '='.repeat(43))` → false (non-base64url chars).
- `isValidTokenShape('dl_' + 'a'.repeat(43))` → true.
- A freshly generated token passes `isValidTokenShape`.

---

### TEST-R5C1-05 — `PASSWORD_HASH_OPTIONS` policy constants have no unit test
**File:** `apps/web/src/lib/password-hashing.ts`  
**Lines:** 1–18  
**Severity:** HIGH  
**Confidence:** HIGH  
**Classification:** Security coverage gap

`password-hashing.ts` exports `PASSWORD_HASH_OPTIONS` with explicit `memoryCost: 65_536`, `timeCost: 3`, `parallelism: 4`, and `type: argon2id`. These are security-critical constants. No test file imports `password-hashing.ts` or asserts these values. The `admin-users.test.ts` mocks `argon2` entirely and does not verify that the real call site uses the shared options object.

**Bug scenario:** A developer changes `timeCost: 3` to `timeCost: 1` to "speed up tests", or `memoryCost` is halved for a performance reason, and no test fails. Password hashing silently weakens.

**Suggested test (5 lines):**
```ts
import { PASSWORD_HASH_OPTIONS } from '@/lib/password-hashing';
it('Argon2id work factors meet minimum security policy', () => {
    expect(PASSWORD_HASH_OPTIONS.memoryCost).toBeGreaterThanOrEqual(65_536);
    expect(PASSWORD_HASH_OPTIONS.timeCost).toBeGreaterThanOrEqual(3);
    expect(PASSWORD_HASH_OPTIONS.type).toBe(2); // argon2id
});
```

---

### TEST-R5C1-06 — Checkout route: happy-path and price-validation logic not tested
**File:** `apps/web/src/app/api/checkout/[imageId]/route.ts`  
**Lines:** 47–66, 68–218  
**Severity:** HIGH  
**Confidence:** HIGH  
**Classification:** Business-logic coverage gap

The only unit test for the checkout route is `checkout-db-error-rollback.test.ts`, which covers exactly one path: a DB error rolling back the rate-limit charge. The following paths are completely untested:
- `getTierPriceCents` strict integer validation (line 62–65): the `!/^\d+$/.test(raw)` guard that prevents a typo in the admin price field from charging a truncated price.
- The `priceCents <= 0` guard (line 132–134).
- The `!image.processed` guard (line 119–121).
- Stripe `idempotencyKey` construction (line 178).
- Successful session creation returning `{ url }`.
- Rate-limit rollback on every 4xx branch.

**Bug scenario:** The `getTierPriceCents` strict parse guard is accidentally removed (someone "simplifies" to `parseInt`), and a price setting of `"500abc"` silently charges $5.00 instead of rejecting with 0. No test catches it.

---

### TEST-R5C1-07 — `resolveOriginalUploadPath` / `assertNoLegacyPublicOriginalUploads` in `upload-paths.ts` untested
**File:** `apps/web/src/lib/upload-paths.ts`  
**Lines:** 58–100  
**Severity:** MEDIUM  
**Confidence:** HIGH  
**Classification:** Infrastructure coverage gap

`upload-paths.ts` exports `resolveOriginalUploadPath` (tries primary then legacy path), `deleteOriginalUploadFile` (deletes from both locations), and `assertNoLegacyPublicOriginalUploads` (fails production startup if originals remain in the public web root). The test suite mocks this module everywhere it appears but never tests the exported functions themselves. `resolveOriginalUploadPath` is security-adjacent: if the fallback-to-legacy logic is wrong, paid originals may not be found, causing 404s for valid download tokens (and the token is already claimed by then).

**Suggested tests (using `tmp` dirs, similar to `strip-gps-from-original.test.ts`):**
- `resolveOriginalUploadPath` returns the primary path when the file exists there.
- `resolveOriginalUploadPath` returns the legacy path when the file exists only there.
- `resolveOriginalUploadPath` returns the primary path when the file exists in neither location (graceful absent).
- `assertNoLegacyPublicOriginalUploads` does not throw when the legacy dir is absent or empty.
- `assertNoLegacyPublicOriginalUploads` warns (does not throw) when legacy files are present and `failInProduction` is false.
- `assertNoLegacyPublicOriginalUploads` throws in production mode with legacy files present.

---

### TEST-R5C1-08 — `withAdminAuth` token branch: scope mismatch (wrong scope presented) not tested
**File:** `apps/web/src/lib/api-auth.ts`  
**Lines:** 63–88  
**Severity:** MEDIUM  
**Confidence:** HIGH  
**Classification:** Security coverage gap

`api-auth-response-headers.test.ts` tests that a valid token with the required scope returns 200 with correct headers, and that an invalid token (null from `verifyToken`) yields 401. It does NOT test the case where `verifyToken` returns a non-null token but `tokenHasScope` returns false (token exists but lacks the required scope). This is line 67: `tokenHasScope(verified.scopes, options.allowTokenScope)`. If this branch were accidentally short-circuited (e.g., `||` instead of `&&`), a token with ANY scope would grant access to scope-gated routes.

**Suggested test:**
- A token verified successfully but with scopes `['lr:read']` presented to a route requiring `lr:upload` → 401.

---

### TEST-R5C1-09 — `advisory-locks.ts` lock-name constants not covered by contract test
**File:** `apps/web/src/lib/advisory-locks.ts`  
**Lines:** 1–46  
**Severity:** MEDIUM  
**Confidence:** MEDIUM  
**Classification:** Contract drift risk

The lock names in `advisory-locks.ts` (`LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, `LOCK_COLOR_PIPELINE_BACKFILL`, `getImageProcessingLockName`) are referenced by multiple consumers. The only test that reads the advisory-locks source is `admin-delete-lock-source.test.ts`, which checks that the delete action uses one global lock (not a per-target lock). There is no test that pins the actual string values of these lock names.

**Risk:** A rename of a constant (e.g., from `gallerykit_db_restore` to `gk_db_restore`) changes the MySQL advisory lock name in production. If the old application is running when the new one starts, the two instances will no longer serialise correctly. No test fails.

**Suggested test:** A simple source-read fixture asserting the exported string constants equal their documented values, e.g.:
```ts
expect(LOCK_DB_RESTORE).toBe('gallerykit_db_restore');
expect(getImageProcessingLockName(42)).toBe('gallerykit:image-processing:42');
```

---

### TEST-R5C1-10 — `e2e/public.spec.ts` is empty — no public-route e2e coverage
**File:** `apps/web/e2e/public.spec.ts`  
**Lines:** entire file  
**Severity:** MEDIUM  
**Confidence:** HIGH  
**Classification:** E2E coverage gap

`apps/web/e2e/public.spec.ts` exists but contains zero test cases (verified: `grep -n "describe\|it("` returns no output). All e2e tests are admin-workflow-gated behind `E2E_ADMIN_ENABLED=true`. There is no e2e coverage for:
- Public gallery homepage render.
- Photo viewer page load and metadata display.
- Shared-group page access.
- 404 handling on unknown routes.
- Rate-limit response on search (semantic or text).

**Risk:** A Next.js App Router configuration error, middleware routing bug, or i18n locale mismatch can break the public homepage entirely without any e2e test catching it.

---

### TEST-R5C1-11 — `e2e/origin-guard.spec.ts`: only admin flows tested, download/checkout public paths absent
**File:** `apps/web/e2e/origin-guard.spec.ts`  
**Severity:** MEDIUM  
**Confidence:** MEDIUM  
**Classification:** E2E coverage gap

The origin guard spec covers admin-route CSRF protection. The public paid-download flow (`GET /api/download/[imageId]?token=...` → interstitial → `POST` → file stream) has no e2e test. Given the R4C7 fix (moving the claim from GET to POST) was motivated by a real email-scanner scenario, an e2e regression test for this flow would be valuable.

---

### TEST-R5C1-12 — `session.test.ts` token-age boundary conditions missing
**File:** `apps/web/src/__tests__/session.test.ts` + `apps/web/src/lib/session.ts:121–126`  
**Severity:** MEDIUM  
**Confidence:** HIGH  
**Classification:** Coverage gap on auth boundary

`verifySessionToken` rejects tokens where `tokenAge > maxAge` (24 h) OR `tokenAge < 0` (future timestamp). Neither condition is tested. The `generateSessionToken` test merely checks the format of the produced token.

**Bug scenario:** The `tokenAge < 0` guard is removed (someone thinks it is "impossible"), enabling pre-dated tokens whose timestamps are far in the future to be valid indefinitely until they cross the 24 h boundary. This is also covered under TEST-R5C1-01 but worth calling out explicitly.

---

### TEST-R5C1-13 — Source-scan tests assert structure but cannot catch logic bugs in webhook `payment_intent.succeeded` handler
**File:** `apps/web/src/__tests__/stripe-webhook-source.test.ts`  
**Lines:** various  
**Severity:** MEDIUM  
**Confidence:** MEDIUM  
**Classification:** Test-type limitation / false confidence

`stripe-webhook-source.test.ts` and `cycle3-rpf-source-contracts.test.ts` through `cycle8-rpf-source-contracts.test.ts` are entirely source-scan (regex/`indexOf`) tests. They assert presence of code patterns but cannot detect:
- Wrong ordering of `db.insert(entitlements)` vs. `generateDownloadToken()` at runtime.
- The idempotency SELECT preceding the INSERT actually using the correct column (`sessionId`).
- The `metadata.imageId` parse emitting a correct integer vs. NaN on a non-numeric string.
- The email address truncation guard (255 char cap) operating on the correct field.

These are high-value paths (real money, token issuance) that would benefit from behavioural unit tests with mocked Stripe and DB (same pattern as `checkout-db-error-rollback.test.ts`).

---

### TEST-R5C1-14 — `touch-target-audit.test.ts` KNOWN_VIOLATIONS count drift risk
**File:** `apps/web/src/__tests__/touch-target-audit.test.ts`  
**Lines:** 99–230  
**Severity:** LOW  
**Confidence:** MEDIUM  
**Classification:** Fixture drift risk

The test has a stale-entry detector (lines 575–593) that fires when a `KNOWN_VIOLATIONS` entry lists more violations than actually exist (meaning the component was fixed but the count was not updated). However, the stale-detector only compares `found > allowed` as a failure and `found < allowed` as "stale warning" — it does NOT currently fail the test on stale entries, it just calls `console.warn`. This means a component fix that reduces violations does not force the developer to tighten the allowance.

**Risk:** The `KNOWN_VIOLATIONS` map silently drifts above the real violation count, masking new violations for those files (since `found <= allowed` passes).

**Suggested fix:** Promote the stale-entry warning to a test failure (`expect(stale).toHaveLength(0)`), requiring developers to update the count when they fix a violation.

---

### TEST-R5C1-15 — `csp-nonce.ts` has no tests
**File:** `apps/web/src/lib/csp-nonce.ts`  
**Severity:** LOW  
**Confidence:** HIGH  
**Classification:** Coverage gap

`csp-nonce.ts` is not referenced in any test file. As a utility for generating/extracting nonces used in the CSP header, incorrect behaviour (e.g., returning a predictable nonce, not encoding correctly) could weaken the CSP. Low severity because nonces are defence-in-depth and the CSP contract test (`content-security-policy.test.ts`) provides some indirect coverage.

---

### TEST-R5C1-16 — `password-hashing.ts` `PASSWORD_HASH_OPTIONS` not verified at call sites
**File:** `apps/web/src/__tests__/admin-users.test.ts`  
**Lines:** 45–47, 119, 131, 147  
**Severity:** LOW  
**Confidence:** HIGH  
**Classification:** Mock masking

`admin-users.test.ts` fully mocks `argon2.hash` with `vi.fn()`. This means the actual options object (`PASSWORD_HASH_OPTIONS`) passed to `argon2.hash` in production is never asserted. The mock accepts any arguments and returns `'hashed-password'`. A developer could remove the `options` argument from the `argon2.hash` call entirely and all tests would still pass.

**Suggested fix:** Assert that `argon2HashMock` was called with `expect.objectContaining({ type: argon2id, memoryCost: 65_536 })`.

---

## Summary Table

| ID | Severity | File/Module | Description |
|----|----------|-------------|-------------|
| TEST-R5C1-01 | CRITICAL | `session.ts:94–145` | `verifySessionToken` entirely untested — HMAC verify, age check, DB lookup |
| TEST-R5C1-02 | HIGH | `bounded-map.ts` | `BoundedMap.prune()` expiry and hard-cap eviction untested |
| TEST-R5C1-03 | HIGH | `session.ts:27–33` | Production SESSION_SECRET enforcement guard untested |
| TEST-R5C1-04 | HIGH | `download-tokens.ts:43–52` | `isValidTokenShape` boundary cases never tested directly |
| TEST-R5C1-05 | HIGH | `password-hashing.ts` | Argon2id work-factor constants not pinned by any test |
| TEST-R5C1-06 | HIGH | `checkout/[imageId]/route.ts` | Happy path, price validation, per-branch rate-limit rollback untested |
| TEST-R5C1-07 | MEDIUM | `upload-paths.ts:58–100` | `resolveOriginalUploadPath` / `assertNoLegacyPublicOriginalUploads` untested |
| TEST-R5C1-08 | MEDIUM | `api-auth.ts:67` | Wrong-scope token path in `withAdminAuth` not tested |
| TEST-R5C1-09 | MEDIUM | `advisory-locks.ts` | Lock-name string values not pinned |
| TEST-R5C1-10 | MEDIUM | `e2e/public.spec.ts` | Entirely empty — no public-route e2e coverage |
| TEST-R5C1-11 | MEDIUM | `e2e/` | Paid-download GET→POST flow has no e2e test |
| TEST-R5C1-12 | MEDIUM | `session.ts:121–126` | Token age boundary (>24h, <0) not tested |
| TEST-R5C1-13 | MEDIUM | Stripe webhook tests | Source-scan tests give false confidence on webhook logic |
| TEST-R5C1-14 | LOW | `touch-target-audit.test.ts` | Stale KNOWN_VIOLATIONS entries only warn, not fail |
| TEST-R5C1-15 | LOW | `csp-nonce.ts` | No tests |
| TEST-R5C1-16 | LOW | `admin-users.test.ts` | Mock masks PASSWORD_HASH_OPTIONS not being passed to argon2 |

## What is Well-Covered (Positive)

- GPS EXIF stripping: thorough including JPEG trailer detection (SEC-R4C10-01), ExtendedXMP, WebP, AVIF, TIFF.
- CSV escape: full Unicode bidi / zero-width / formula-injection coverage.
- Validation layer: `containsUnicodeFormatting`, `isValidTopicAlias`, `isValidTagName` — all codepoint classes.
- Download token crypto: `generateDownloadToken`, `hashToken`, `verifyTokenAgainstHash` — all boundary cases.
- Admin token system: `verifyToken` (mocked DB), scope enforcement, `tokenHashesEqual` constant-time.
- Auth rate-limit: dual-bucket (IP + account) logic, rollback, window reset.
- Privacy field separation: symmetric guard + timeline mirror (SENSITIVE_KEYS contract).
- Lint gates: all four scripts have fixture-style tests covering both pass and fail branches.
- `withAdminAuth` response headers: both token and cookie branches, `has()` guard.
- Stripe webhook source-contract: structural patterns locked at multiple cycle checkpoints.
- Session worker: `generateSessionToken` format, `hashSessionToken` determinism.
- Touch-target audit: multi-line normalizer, `Badge asChild`, native `select`.
