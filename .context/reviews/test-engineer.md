# Test Engineer Review — Cycle 14

**Date:** 2026-06-27
**HEAD after cycle-13 fixes:** HEAD at cycle-13 convergence (2071 tests pass, 4 skip)
**Scope:** Test coverage gaps on correctness-critical and security-critical paths following the cycle-13 fix set.

---

## Severity / Priority Table

| ID | Severity | Category | File | Description |
|----|----------|----------|------|-------------|
| TE-01 | **HIGH** | Real Bug (missed fix) | `src/app/api/admin/lr/upload/route.ts:180` | LR upload route still uses `stats.bfree`; cycle-13 fixed `images.ts` but missed this parallel disk-check path |
| TE-02 | **HIGH** | Broken Test Mock | `src/__tests__/images-actions.test.ts:166` | Mock supplies `{ bfree, bsize }` but production code reads `stats.bavail`; test passes via NaN arithmetic, regression to `bfree` undetectable |
| TE-03 | **MEDIUM** | Missing regression test | `src/lib/data.ts:794-798` | No test locks `getImagesForFeed` emitting `author_name: sql\`NULL\``; reversion to the `adminUsers.username` join bypasses all CI gates |
| TE-04 | **MEDIUM** | Missing test | `src/lib/auth-rate-limit.ts:107-120` | `getPasswordChangeRateLimitEntry` copy contract entirely untested; the cycle-13 `{ ...entry }` fix has no assertion that would fail on revert |
| TE-05 | LOW | Missing test | `src/components/color-details-section.tsx:227-229` | `hasColorDetails` now guards `transfer_function`/`is_hdr` behind `isAdmin &&`; no source-inspection assertion locks the new guard expression |
| TE-06 | LOW | Not unit-testable | `apps/web/Dockerfile:CMD` | Docker CMD `exec` fix (AGG-R13-01) cannot be validated by Vitest; correct by code inspection only |
| TE-07 | LOW | Deferred carry-over | `src/__tests__/db-pool-connection-handler.test.ts` | `clearTimeout`/`unref` in `finally` around `Promise.race` (cycle-12 AGG-R12-04) not asserted; deferred per cycle-13 plan |

---

## Findings

### TE-01 — HIGH — Real Bug: LR upload route still uses `stats.bfree` (cycle-13 fix was incomplete)

**File:** `apps/web/src/app/api/admin/lr/upload/route.ts:180`

**What was changed in cycle-13:** `apps/web/src/app/actions/images.ts` had `stats.bfree * stats.bsize` corrected to `stats.bavail * stats.bsize` (AGG-R13-04). The rationale: `bfree` counts the ~5% root-reserved blocks the non-root `node` process cannot allocate, so the 1 GiB pre-check can pass while writable space is below the threshold.

**What was missed:** The Lightroom Classic upload route at `apps/web/src/app/api/admin/lr/upload/route.ts` has an identical disk-space pre-check (introduced in parallel with the one in `images.ts`). It still reads `stats.bfree`:

```typescript
// route.ts:179-180
const stats = await statfs(UPLOAD_DIR_ORIGINAL);
const freeBytes = stats.bfree * stats.bsize;  // BUG: should be stats.bavail
```

This is an identical root-reserved-block bug on the Lightroom publish path. An admin using Lightroom Classic publish to a gallery within ~5% of full receives a false "disk is OK" signal from the pre-check, then gets an opaque 500/ENOSPC at the actual file write rather than the intended 507 response.

**Why no CI gate caught it:** `lr-upload-hdr-gate.test.ts:195-203` checks that `statfs` is imported and called before the save, but never asserts `bavail` vs `bfree`. No test makes this distinction.

**Fix required (not just a test):** Change `route.ts:180` to `stats.bavail * stats.bsize`, mirroring `images.ts`.

**Regression test to add (source-inspection, matching the existing lr-upload test style):**
```typescript
it('uses stats.bavail (not stats.bfree) in the disk-space pre-check', () => {
    expect(LR_SRC).toContain('stats.bavail');
    expect(LR_SRC).not.toMatch(/stats\.bfree\b/);
});
```

**Confidence:** High. Confirmed by direct source comparison of the two parallel code paths.

---

### TE-02 — HIGH — Broken test mock: `images-actions.test.ts` provides `bfree` but code reads `bavail`

**File:** `apps/web/src/__tests__/images-actions.test.ts:166`

**Current `beforeEach` mock:**
```javascript
statfsMock.mockResolvedValue({ bfree: 2_000_000, bsize: 1024 });
```

**Production code reads (`images.ts:211`):**
```javascript
const freeBytes = stats.bavail * stats.bsize;
```

Since the mock provides no `bavail` key, `stats.bavail` is `undefined`. `undefined * 1024 = NaN`. The threshold check `if (freeBytes < 1024 * 1024 * 1024)` evaluates to `false` when `freeBytes` is `NaN` — NaN comparisons always return false in JavaScript. The disk check passes accidentally, not because the fix was validated.

**Regression not caught:** Reverting `images.ts` back to `stats.bfree` would still satisfy all existing tests because the mock provides `bfree: 2_000_000` which gives `2_000_000 * 1024 = 2 GB > 1 GB threshold` — check passes either way. Additionally, there is no test that verifies the `insufficientDiskSpace` error is returned when `bavail` is *below* the threshold; the existing failure test at line 311 only exercises the `catch` branch (when `statfs` rejects entirely, not when it resolves with low `bavail`).

**Tests to add:**
1. Update the mock to `{ bavail: 2_000_000, bsize: 1024 }` so tests reflect what the code actually reads.
2. Add a below-threshold test:
```typescript
it('returns insufficientDiskSpace when bavail * bsize is below 1 GiB', async () => {
    statfsMock.mockResolvedValue({ bavail: 500_000, bsize: 1024 }); // ~488 MiB < 1 GiB
    const formData = new FormData();
    formData.append('files', new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
    formData.set('topic', 'travel');
    formData.set('tags', '');
    await expect(uploadImages(formData)).resolves.toEqual({ error: 'insufficientDiskSpace' });
    expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
});
```

**Confidence:** High. The mock/code field-name mismatch is direct and confirmed.

---

### TE-03 — MEDIUM — Feed username disclosure fix has no regression test

**File:** `apps/web/src/lib/data.ts:794-798`

**What was fixed (cycle-13 AGG-R13-07):** `getImagesForFeed` previously joined `adminUsers` and selected `adminUsers.username` as `author_name`, exposing the admin login credential on the unauthenticated `GET /feed.xml`. The fix emits `author_name: sql<string | null>\`NULL\`` instead, dropping the `adminUsers` join entirely.

**Coverage gap:** No test verifies this invariant. The existing test surface covers:
- `atom-feed.test.ts`: tests `composeAtomFeed` (pure function over `AtomEntry[]`), not `getImagesForFeed`
- `feed-sized-derivative.test.ts`: source-inspects feed routes for `sizedImageFilename`, not query shape
- `privacy-fields.test.ts`: guards `publicSelectFields` schema exclusions via `_PrivacySensitiveKeys` guard, but not JOIN-derived fields in named query functions like `getImagesForFeed`

A developer reverting the join (e.g., to surface per-uploader attribution) would not be caught by any CI gate.

**Test to add (source-inspection of `data.ts`, matching project convention):**
```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DATA_SRC = readFileSync(resolve(__dirname, '../lib/data.ts'), 'utf8');

describe('getImagesForFeed — author_name privacy contract (SEC-13-01)', () => {
    it('emits a literal NULL for author_name rather than adminUsers.username', () => {
        // Confirm the NULL literal is present in the function.
        expect(DATA_SRC).toMatch(/getImagesForFeed[\s\S]{0,800}author_name:\s*sql/);
        expect(DATA_SRC).toMatch(/getImagesForFeed[\s\S]{0,800}NULL/);
    });

    it('does not join adminUsers in getImagesForFeed', () => {
        const fnMatch = /export async function getImagesForFeed[\s\S]*?^\}/m.exec(DATA_SRC);
        expect(fnMatch).not.toBeNull();
        expect(fnMatch![0]).not.toContain('adminUsers');
    });
});
```

**Confidence:** High. The fix is an untested security-relevant invariant; a source-inspection test is the appropriate regression lock for query shape.

---

### TE-04 — MEDIUM — `getPasswordChangeRateLimitEntry` copy contract untested

**File:** `apps/web/src/lib/auth-rate-limit.ts:107-120`
**Test file:** `apps/web/src/__tests__/auth-rate-limit.test.ts`

**What was fixed (cycle-13 AGG-R13-05):** `getPasswordChangeRateLimitEntry` previously returned the raw `entry` reference. The fix adds `return { ...entry };` to match the documented copy contract of `getLoginRateLimitEntry` and `getAccountLoginRateLimitEntry`.

**Coverage gap:** `auth-rate-limit.test.ts` tests `getLoginRateLimitEntry` (expired-reset path) and `getAccountLoginRateLimitEntry` (expired-reset path), but the file contains zero assertions about `getPasswordChangeRateLimitEntry` at all — neither the reset behavior nor the copy contract. The test at line 101 uses `passwordChangeRateLimit.set(...)` / `.has(...)` to exercise `clearSuccessfulPasswordAttempts`, but never calls `getPasswordChangeRateLimitEntry`.

The risk is currently lower than TE-02 because `BoundedMap.get()` already performs a shallow copy internally, making the `{ ...entry }` in the accessor redundant in practice. However: if a future backing-store swap drops `BoundedMap`'s internal copy behavior, or if someone reverts the `{ ...entry }` fix, no test fails.

**Test to add:**
```typescript
it('getPasswordChangeRateLimitEntry resets count when window expired and returns a shallow copy', () => {
    const now = Date.now();
    passwordChangeRateLimit.set('10.0.0.1', { count: 3, lastAttempt: 1 });
    const entry = getPasswordChangeRateLimitEntry('10.0.0.1', now + LOGIN_WINDOW_MS + 1);
    // Window expired: count should reset.
    expect(entry.count).toBe(0);
    // Shallow copy: mutating the returned object must not corrupt the stored bucket.
    entry.count = 99;
    expect(passwordChangeRateLimit.get('10.0.0.1')?.count).not.toBe(99);
});
```

**Confidence:** High for the gap; Medium for the immediate risk (currently safe due to `BoundedMap.get()` semantics).

---

### TE-05 — LOW — `hasColorDetails` `isAdmin` guard (cycle-13 AGG-R13-06) not test-locked

**File:** `apps/web/src/components/color-details-section.tsx:227-229`

**What was fixed:** The `hasColorDetails` gate that controls whether the Color Details accordion is shown at all was changed:
```typescript
// Before (cycle-12):
const hasColorDetails = Boolean(
    image.color_primaries || image.transfer_function || image.is_hdr || image.color_pipeline_decision,
);
// After (cycle-13):
const hasColorDetails = Boolean(
    image.color_primaries ||
    (isAdmin && image.transfer_function) ||
    (isAdmin && image.is_hdr) ||
    (isAdmin && image.color_pipeline_decision),
);
```
A corresponding `isAdmin &&` guard was also added before the `transfer_function` row render at line 402.

**Coverage gap:** `color-details-section-delivered.test.ts` checks `isAdmin && isHdr && ... hdr-badge` (AGG-M3 contract), `isAdmin && image.matrix_coefficients`, and `isAdmin && image.color_space`, but the `hasColorDetails` formula itself is not asserted as a pattern. A reversion to the pre-`isAdmin` formula for `transfer_function`/`is_hdr` would not fail any existing test.

**Tests to add (extend `color-details-section-delivered.test.ts`):**
```typescript
it('hasColorDetails gates transfer_function and is_hdr behind isAdmin', () => {
    // The &&-guarded form must be present; bare `image.transfer_function` is rejected.
    expect(SOURCE).toMatch(
        /hasColorDetails\s*=\s*Boolean\s*\([\s\S]{0,200}\(isAdmin\s*&&\s*image\.transfer_function\)/,
    );
    expect(SOURCE).toMatch(
        /hasColorDetails\s*=\s*Boolean\s*\([\s\S]{0,400}\(isAdmin\s*&&\s*image\.is_hdr\)/,
    );
});

it('renders the transfer_function row only when isAdmin is true', () => {
    expect(SOURCE).toMatch(/isAdmin\s*&&\s*image\.transfer_function\s*&&/);
});
```

**Confidence:** Medium. Currently safe (admin-only fields are `undefined` for public API responses due to `publicSelectFields`), but regression could surface `transfer_function` in the accordion if a future call site passes admin-fetched data with `isAdmin={false}`.

---

### TE-06 — LOW — Docker CMD `exec` fix not unit-testable (noted)

**File:** `apps/web/Dockerfile:CMD`

The cycle-13 AGG-R13-01 fix prepends `exec` to `CMD` so `node server.js` runs as PID 1 and receives SIGTERM directly (rather than through a shell that ignores signals). This cannot be validated by Vitest or Playwright. Correct by code inspection. Verified at deploy time by observing a clean shutdown without the 30 s SIGKILL wait. No further test action possible at the unit level.

---

### TE-07 — LOW — `clearTimeout`/`unref` in `Promise.race` `finally` block (cycle-12 AGG-R12-04) not asserted

**File:** `apps/web/src/__tests__/db-pool-connection-handler.test.ts`

The cycle-12 fix added `clearTimeout`/`unref` in a `finally` block around `Promise.race([initPromise, initTimeout])` in `db/index.ts` to prevent timer accumulation under steady query load. The test checks `Promise.race` is present but does not assert the `finally { clearTimeout(...); }` pattern. A regression dropping the `clearTimeout` call would not be caught.

This was explicitly deferred by the cycle-13 plan as "additive-nice-to-have." Confirming the deferral remains appropriate — the worst case is timer accumulation under high load, not a correctness failure. Record for a future test-hardening pass.

---

## Summary: Which Cycle-13 Fixes Have No Regression Lock

| Cycle-13 Fix | Has regression test? | Gap severity |
|---|---|---|
| `images.ts` `bavail` fix | Mock is broken (provides `bfree` only) — regression undetectable | HIGH |
| LR route disk check | Not fixed at all — this is a missed fix, not a test gap | HIGH |
| `getImagesForFeed` NULL `author_name` | No test | MEDIUM |
| `getPasswordChangeRateLimitEntry` copy | No test | MEDIUM |
| `color-details-section` `hasColorDetails` isAdmin guards | No test for the formula | LOW |
| `color-details-section` `transfer_function` render gate | No test | LOW |
| Docker CMD `exec` | Not unit-testable | N/A |

---

## Recommended Priority Order

1. **Fix TE-01 immediately** — this is a live production bug, not a test gap. The LR upload route needs `bfree` → `bavail` before the next deploy.
2. **Fix TE-02 in the same pass** — update the `beforeEach` mock to `{ bavail: ..., bsize: ... }` and add the sub-threshold assertion. The current mock makes the disk-check tests actively misleading.
3. **TE-03 next cycle** — source-inspection test for `getImagesForFeed` null-author contract (security regression lock, cheap to add).
4. **TE-04 / TE-05** — low risk but cheap; batch into the same test-hardening pass as TE-03.
