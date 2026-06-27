# Test Engineer Review — Cycle 19

**Date:** 2026-06-27
**Scope:** Full inventory of `apps/web/src/__tests__/`; targeted gap analysis of 7 high-risk modules
**Test Health:** HEALTHY (gaps are non-critical; no regressions found)

---

## Summary

Cycle 19 is a comprehensive test-suite audit against the 7 modules named in the task specification. The suite is broadly healthy. The highest-risk logic (GPS stripping, smart collections, color/HDR pipeline, rate-limit mechanics, admin-backfill concurrency) all have solid behavioral coverage. Two genuine gaps were identified:

1. **`rollbackOgAttempt` has no behavioral unit test.** The analogous semantic-search rollback has five dedicated tests; the OG rollback has zero. Only a source-text grep in an unrelated test confirms the call exists.
2. **All 40+ LR upload route tests are source-text pattern matches**, not functional tests. No request is ever dispatched to the handler, no response code checked, no mock call count asserted. An inverted conditional would pass every test.

Two lower-severity gaps round out the report.

---

## Previous Cycle Carry-over

Gaps from Cycle 18 that remain open:

- **M-1 (`images.ts` topic-SELECT throw path):** source-contract test still in place; no behavioral mock harness added. Still MEDIUM.
- **M-2 (`wide-gamut-hint.tsx` render-condition integration):** still untested. Still MEDIUM.
- **L-1 (histogram AVIF-priority branch):** still untested. Still LOW.
- **L-2 (`nav-client.tsx` theme/locale focus-visible rings):** rings absent; no test for absence. Still LOW.

---

## Module Coverage Inventory

### lib/gps-exif-strip.ts — WELL COVERED

`__tests__/strip-gps-from-original.test.ts` (583 lines) covers JPEG APP1 IFD rewriting, TIFF pointer rewriting, ISOBMFF (HEIF/AVIF/HEIC) box surgery, WebP RIFF chunk removal, ExtendedXMP multi-chunk split-boundary GPS token removal, post-EOI trailer detection, and pixel-identity round-trips for each format. No gaps.

### lib/smart-collections.ts — WELL COVERED

`__tests__/smart-collections.test.ts` (328 lines) covers the column allowlist enforcement, depth-limit (`MAX_DEPTH=4`) cutoff, scalar-value enforcement on `eq`/`ne` operators, full operator matrix, LIKE wildcard escaping, `remapTopicSlugInQuery` for `eq`/`in` predicates, and the discriminated-union AST-to-Drizzle compiler across all supported column types. No gaps.

### lib/rate-limit.ts — ONE GAP (rollbackOgAttempt)

`__tests__/rate-limit.test.ts` (267 lines) covers `normalizeIp`, `getRateLimitBucketStart`, `isRateLimitExceeded`, `getClientIp` with all XFF/hop/fallback scenarios, `shouldWarnMissingTrustProxy`, `buildAccountRateLimitKey`, `pruneSearchRateLimit`, and `preIncrementShareAttempt`.

`__tests__/semantic-search-rate-limit.test.ts` (145 lines) provides the canonical rollback pattern: five dedicated behavioral tests for `rollbackSemanticAttempt` covering decrement-from-N, decrement-from-1 (delete branch), rollback of unknown IP (no-op), and repeated rollback/increment cycling.

`__tests__/og-rate-limit.test.ts` (60 lines) covers `preIncrementOgAttempt` (increment/reject/window-reset) and `pruneOgRateLimit` (expired-entry eviction). **`rollbackOgAttempt` has no entry in this file or any other test file.**

**FINDING-1 (MEDIUM): `rollbackOgAttempt` — no behavioral unit test.**

- File: `apps/web/src/lib/rate-limit.ts:261-270`
- Implementation:

```typescript
export function rollbackOgAttempt(ip: string) {
    const currentEntry = ogRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        ogRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt });
    } else {
        ogRateLimit.delete(ip);
    }
}
```

- The only test coverage is a source-text grep in `og-photo-fallback.test.ts` that confirms the function call exists in the OG photo route. No test verifies the two-branch logic:
  - count > 1 → decrement and re-set (not delete)
  - count ≤ 1 → delete the entry

- Regression risk: if the branches were swapped or the delete became unconditional, the OG rate-limit bucket would lose entries on every rollback call. On a traffic spike that triggers many rollback paths (pre-increment then 404/fallback), subsequent legitimate OG card requests would re-enter a fresh bucket and never exhaust the limit — opposite of the intended behavior. Or, if delete is skipped when it should run, phantom count entries accumulate and throttle legitimate traffic faster than intended.

- Confidence: HIGH. The coverage asymmetry with `rollbackSemanticAttempt` (5 behavioral tests vs. 0) is unambiguous.

**Proposed additions to `__tests__/og-rate-limit.test.ts`:**

```typescript
// Requires exporting resetOgRateLimitForTests from rate-limit.ts
// (same pattern as resetSemanticRateLimitForTests / resetShareRateLimitForTests)

describe('rollbackOgAttempt', () => {
    afterEach(() => resetOgRateLimitForTests());

    it('decrements count when count > 1 (does not delete entry)', () => {
        const ip = '203.0.113.20';
        const now = 1_000_000;
        preIncrementOgAttempt(ip, now);
        preIncrementOgAttempt(ip, now);
        rollbackOgAttempt(ip);
        // count should be 1; one more increment must still be within budget
        expect(preIncrementOgAttempt(ip, now)).toBe(false);
    });

    it('deletes the entry when rolling back from count 1', () => {
        const ip = '203.0.113.21';
        const now = 1_000_000;
        preIncrementOgAttempt(ip, now);
        rollbackOgAttempt(ip);
        // fresh bucket — should have full budget again
        expect(preIncrementOgAttempt(ip, now)).toBe(false);
    });

    it('is a no-op when the IP has no entry', () => {
        const ip = '203.0.113.22';
        expect(() => rollbackOgAttempt(ip)).not.toThrow();
        const now = 1_000_000;
        for (let i = 0; i < OG_MAX_REQUESTS; i++) {
            expect(preIncrementOgAttempt(ip, now)).toBe(false);
        }
        expect(preIncrementOgAttempt(ip, now)).toBe(true);
    });

    it('allows full budget after rolled-back failures', () => {
        const ip = '203.0.113.23';
        const now = 2_000_000;
        for (let i = 0; i < 5; i++) {
            preIncrementOgAttempt(ip, now);
            rollbackOgAttempt(ip);
        }
        for (let i = 0; i < OG_MAX_REQUESTS; i++) {
            expect(preIncrementOgAttempt(ip, now)).toBe(false);
        }
        expect(preIncrementOgAttempt(ip, now)).toBe(true);
    });
});
```

### lib/rate-limit.ts BoundedMap eviction — WELL COVERED

`__tests__/bounded-map.test.ts` (232 lines) covers BoundedMap expiry pruning, prune return-value, hard-cap eviction order (oldest-2 evicted, newest-3 retained), `createResetAtBoundedMap` expiry, `createWindowBoundedMap` window expiry, and overwrite semantics. No gaps.

### lib/admin-backfill-runner.ts concurrency clamp — WELL COVERED (minor edge case)

`__tests__/admin-backfill-concurrency-cap.test.ts` (94 lines) covers 8 cases: formula correctness, `floor(1)` minimum, `NaN`/negative requested values, pool-size scaling at 10/20/5, and the default pool limit.

**FINDING-4 (LOW): `POOL_CONNECTION_LIMIT ?? 10` NaN fallback unreachable in tests.**

The test mocks `POOL_CONNECTION_LIMIT: 10` so the `?? 10` defensive fallback for an undefined import binding is never triggered in any test run. If the module binding became undefined (e.g., a build-system change), the fallback would silently activate at the wrong pool size. This is a low-priority gap; the formula coverage is thorough and `?? 10` is a one-liner. No action required unless the import chain changes.

### lib/color-detection.ts NCLX/ICC precedence — WELL COVERED

`__tests__/color-detection.test.ts` covers the full NCLX transfer-function mapping (codes 1, 4, 5, 13, 14, 15, 16, 17, 18), primaries mapping (1, 9, 11, 12), matrix mapping (0, 1, 8, 9, 10), ICC name allowlist fallback, ICC chromaticity fallback, and NCLX priority over ICC. Integration tests write real AVIF files with specific CICP codes and verify round-trip parsing. No gaps.

### lib/color-pipeline-decisions.ts and process-image.ts decision matrix — WELL COVERED

`__tests__/color-pipeline-decision.test.ts` covers all ICC-name-to-decision-enum mappings and signals-only fallback. `__tests__/process-image-color-roundtrip.test.ts` covers all six encoder paths (sRGB, Display-P3, DCI-P3, Adobe-RGB, ProPhoto, Rec.2020) with real Sharp pixel-level verification, including `forceSrgbDerivatives=true` asserting AVIF remains P3-tagged while WebP/JPEG receive sRGB (line 242). No gaps.

### app/api/admin/lr/upload/route.ts — VACUOUS TESTS

**FINDING-2 (MEDIUM): All LR upload route tests are source-text contracts, not functional tests.**

- File: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts` (392 lines)

The file reads the route source at module load:

```typescript
const LR_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app/api/admin/lr/upload/route.ts'),
    'utf-8',
);
```

Every `it()` block in the file asserts `expect(LR_SRC).toMatch(...)` or `expect(LR_SRC).toContain(...)`. No test:
- creates a `Request` object and dispatches it to `POST`
- mocks `withAdminAuth`, `db`, `enqueueImageProcessing`, or `saveOriginalAndGetMetadata`
- asserts a response status code
- verifies `settleUploadTrackerClaim` call count or argument values

A test comment acknowledges this: "The route is a multipart, token-authenticated handler that is heavy to test."

Behaviors tested only by pattern-matching and therefore unverified:
- HDR gate rejection returns 422 (the conditional polarity is not exercised)
- Successful upload returns 201 with correct JSON body
- `trackerSettled` idempotency guard prevents double-settle (see FINDING-3)
- Maintenance-mode guard fires at both entry and post-save re-check
- Upload-tracker pre-increment → 429 rate-limit response

Regression risk: a logic inversion (e.g., `if (!allowHdrIngest)` → `if (allowHdrIngest)`) produces source text that still contains `allowHdrIngest` and passes all 40+ tests while unconditionally accepting PQ/HLG uploads. This is a complete behavioral blind spot.

Confidence: HIGH. The distinction between pattern-matching the source and executing the handler is unambiguous.

**FINDING-3 (LOW-MEDIUM): `trackerSettled` double-settle guard not behaviorally tested.**

- File: `apps/web/src/app/api/admin/lr/upload/route.ts:244-256` (approx.)
- The guard:

```typescript
let trackerSettled = false;
function settleTrackerToActual(success: boolean) {
    if (trackerSettled) return;  // idempotency gate
    trackerSettled = true;
    settleUploadTrackerClaim(...);
}
```

- `lr-upload-hdr-gate.test.ts:387-390` tests this as:

```typescript
it('the settle closure is idempotent (double-settle cannot steal quota)', () => {
    expect(LR_SRC).toMatch(/let\s+trackerSettled\s*=\s*false/);
    expect(LR_SRC).toMatch(/if\s*\(trackerSettled\)\s*return;/);
});
```

This confirms the guard exists in source. It cannot verify that `settleUploadTrackerClaim` is called exactly once when two code paths both reach a settle call. A future refactor that moves the guard to a different abstraction layer but accidentally drops the `if (trackerSettled) return;` early exit would pass both regex matches if any remaining variable is still named `trackerSettled`.

Address together with FINDING-2 by adding a functional test that stubs `settleUploadTrackerClaim` and asserts `.toHaveBeenCalledTimes(1)` after triggering the double-settle scenario.

---

## Flaky Test Assessment

No flaky tests identified. All potential concerns evaluated and cleared:

- `audit-retention.test.ts:57-84` uses `Date.now()` — these assertions run inside `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-06-11T00:00:00Z'))` configured in `beforeEach`. `Date.now()` returns the deterministic synthetic time. Not flaky.
- `color-detection.test.ts:159,417` uses `Date.now()` for tmpFile path uniqueness — used for filesystem paths, not assertions. Not flaky.
- `process-topic-image.test.ts:181-196` uses `Date.now()` for tmpFile uniqueness — same pattern. Not flaky.
- `lr-tokens-action.test.ts:137` constructs `new Date(Date.now() + 86_400_000)` as a future expiry fixture — comparison is relative, not against a fixed expected value. Not flaky.
- `image-queue-quiesce.test.ts:136` uses `setTimeout(() => {}, 60_000)` to populate a timer reference — vitest fake timers are active throughout the describe block. Not flaky.

---

## Vacuous Test Patterns

### Source-text contract tests — when acceptable vs. when not

Two test files grep implementation source for API call patterns: `__tests__/process-image-icc-options-lockin.test.ts` and `__tests__/lr-upload-hdr-gate.test.ts`.

For **structural invariants** (e.g., "every encode chain must call `withIccProfile()`"), source-text contracts are an acceptable canary for accidental API removal. The behavioral verification already lives in `process-image-color-roundtrip.test.ts`.

For **behavioral correctness** (e.g., "HDR upload must be rejected and return 422"), source-text contracts are vacuous. They confirm the conditional expression is present; they cannot confirm its polarity is correct. The LR upload test file falls into this category for all response-code and data-integrity claims.

Recommendation: source-text contracts are acceptable for structural/API-usage constraints. They are not acceptable for output-correctness claims. The LR upload tests should be split: keep source-text contracts for structural assertions (e.g., "`withAdminAuth` wrapper present"), add functional tests for behavioral assertions.

### Weak assertions in i18n coverage tests

`__tests__/color-pipeline-decision-i18n.test.ts:51,57` uses `expect(result).toBeTruthy()`. This passes for any non-empty string. The risk is low (display strings, not security paths), but tightening to a snapshot or `.toMatch(/\S+/)` would improve confidence.

---

## Findings Summary

| ID | Severity | Confidence | Location | Description |
|----|----------|------------|----------|-------------|
| FINDING-1 | MEDIUM | HIGH | `lib/rate-limit.ts:261-270` | `rollbackOgAttempt` has no behavioral unit test; decrement-vs-delete branch logic unverified. |
| FINDING-2 | MEDIUM | HIGH | `app/api/admin/lr/upload/route.ts` (entire route) | All 40+ LR upload tests are source-text pattern matches; no request dispatched; no response code checked. |
| FINDING-3 | LOW-MEDIUM | HIGH | `app/api/admin/lr/upload/route.ts:~244-256` | `trackerSettled` double-settle guard is source-text only; `settleUploadTrackerClaim` call-count never asserted. |
| FINDING-4 | LOW | MEDIUM | `lib/admin-backfill-runner.ts` | `POOL_CONNECTION_LIMIT ?? 10` NaN fallback unreachable in tests because mock always provides `10`. |

---

## Recommended Actions

Priority order:

1. **FINDING-1 — Add `rollbackOgAttempt` behavioral tests.** Export `resetOgRateLimitForTests` from `rate-limit.ts` (one-liner calling `ogRateLimit.clear()`). Add four tests to `og-rate-limit.test.ts` mirroring the `rollbackSemanticAttempt` pattern. No implementation changes required. Estimated effort: 45 minutes.

2. **FINDING-2 + FINDING-3 — Add a minimal functional smoke test for the LR upload route.** One happy-path test (201 response) and one rejection test (HDR gate, 422 response) would eliminate the entire class of logic-inversion regressions. The same test harness can assert `settleUploadTrackerClaim` call count. Estimated effort: 3-4 hours for the mock scaffolding; subsequent test cases are cheap once the harness exists.

3. **FINDING-4** — No urgent action. Consider adding a comment in the test file acknowledging the gap.

---

## Carry-over Gaps (unchanged from Cycle 18)

- **M-1** (`images.ts` topic-SELECT throw path): source-contract test still in place; no behavioral mock harness. MEDIUM.
- **M-2** (`wide-gamut-hint.tsx` render-condition integration): still untested. MEDIUM.
- **L-1** (histogram AVIF-priority branch): still untested. LOW.
- **L-2** (`nav-client.tsx` theme/locale focus-visible rings): rings absent; no test for absence. LOW.
