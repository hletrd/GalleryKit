# Test Engineer Report — Run 7 Cycle 5

**Date:** 2026-06-20
**Scope:** NCLX matrix-coefficient pin completeness on the `detectFromNclx` path in `color-detection.test.ts`
**Cycle-4 fix verification:** intact (see below)

---

## Cycle-4 Fix Verification (AGG-R7C4-01 — confirmed intact)

The matrix=1→'bt709' pin added by AGG-R7C4-01 is present and correct at
`apps/web/src/__tests__/color-detection.test.ts:313-316`:

```typescript
it('maps nclx matrix=1 to bt709', async () => {
    const signals = await detectFromNclx(1, 1, 1);
    expect(signals.matrixCoefficients).toBe('bt709');
```

The motivating comment at lines 307-312 correctly describes the original gap
(a code-1↔9 swap would go undetected on the NCLX path) and references the
sibling matrix=8 and matrix=10 tests. This fix is intact and has not drifted.

---

## NCLX Map Pin-Status Matrix (NCLX Path Only)

### NCLX_PRIMARIES_MAP

All primary codes exercised via `detectFromNclx` assert `colorPrimaries` directly
in each test. No gap identified on the primaries map.

| Code | Value | Asserted on NCLX path |
|------|-------|----------------------|
| 1 | `'bt709'` | Yes — line 149 (via separate path) |
| 9 | `'bt2020'` | Yes — lines 172, 179, 324, 330, 336 |
| 11 | `'dci-p3'` | Yes — lines 186, 200 |
| 12 | `'display-p3'` | Yes — lines 232, 252, 272, 287, 294 |

### NCLX_TRANSFER_MAP

All transfer codes exercised via `detectFromNclx` assert `transferFunction` in
each test. No gap identified on the transfer map.

| Code | Value | Asserted on NCLX path |
|------|-------|----------------------|
| 1 | `'srgb'` | Yes (multiple tests) |
| 2 | `'unknown'` | Yes — lines 240, 252, 272 |
| 4 | `'gamma22'` | Yes — line 210 |
| 5 | `'gamma28'` | Yes — line 219 |
| 6 | `'srgb'` | Yes — line 281 |
| 7 | `'gamma22'` | Yes — line 225 |
| 8 | `'linear'` | Yes — line 194 |
| 11 | `'srgb'` | Yes — line 294 |
| 13 | `'srgb'` | Yes — lines 232, 287 |
| 14 | `'gamma24'` | Yes — line 324 |
| 15 | `'gamma24'` | Yes — line 330 |
| 16 | `'pq'` | Yes — line 172 |
| 17 | `'gamma26'` | Yes — line 200 |
| 18 | `'hlg'` | Yes — line 179 |

### NCLX_MATRIX_MAP

This is where the gap exists. Three codes are pinned on the NCLX path;
two are not.

| Code | Value | Asserted on NCLX path | Note |
|------|-------|----------------------|------|
| 0 | `'identity'` | **NO** | Passed as matrix=0 at line 232 (`detectFromNclx(12,13,0)`) but that test asserts `colorPrimaries`/`transferFunction` only — `matrixCoefficients` not checked. Asserted at lines 63/72/90/99/108/257 but all via the ICC-name path, not the pure NCLX path. |
| 1 | `'bt709'` | Yes — line 315 (AGG-R7C4-01) | Pinned in cycle 4. |
| 8 | `'ycgco'` | Yes — line 303 (AGG-R7C1-02) | Pinned in cycle 1. |
| 9 | `'bt2020-ncl'` | **NO** | Passed as matrix=9 at lines 172/179/324/330 but each test asserts `transferFunction`/`colorPrimaries`/`isHdr` only — `matrixCoefficients` not asserted. Asserted at line 81 (ICC-name path: "Rec.2020 ICC") and as raw integer at parseCicpFromHeif line 507 — never as the mapped enum on the pure NCLX path. |
| 10 | `'bt2020-cl'` | Yes — line 337 (R9-LOW) | Pinned in cycle 4/run-9. |

**Summary:** NCLX matrix path pin set = {1, 8, 10}. Codes **0** and **9** are missing.

---

## Finding TE-R7C5-01

**Title:** NCLX matrix codes 0 and 9 unpinned on the pure NCLX detection path
**Severity:** LOW
**Confidence:** HIGH
**Field:** `matrix_coefficients` (admin-only, in `_PrivacySensitiveKeys`, never delivered to public, encoder never branches on it)

### Location

`apps/web/src/__tests__/color-detection.test.ts` — near lines 301-337 (the existing
matrix=8/1/10 pin block).

### Unpinned Invariants

1. `NCLX_MATRIX_MAP[0] = 'identity'` (`color-detection.ts:215`)
   - Line 232: `detectFromNclx(12, 13, 0)` passes matrix=0 but the test body
     asserts only `colorPrimaries` and `transferFunction`. `matrixCoefficients` is
     never checked on this call.
   - All other `'identity'` assertions (lines 63/72/90/99/108/257) use an ICC
     buffer (`icc:` option), exercising the ICC-name code path, not `detectFromNclx`.

2. `NCLX_MATRIX_MAP[9] = 'bt2020-ncl'` (`color-detection.ts:217`)
   - Lines 172, 179, 324, 330: `detectFromNclx(9, 16|18|14|15, 9)` each assert
     `transferFunction`, `colorPrimaries`, and `isHdr` but never `matrixCoefficients`.
   - Line 81 asserts `'bt2020-ncl'` but on the ICC-name path ("Rec.2020" buffer).
   - `parseCicpFromHeif` tests (lines 507) verify the raw integer `9` in the CICP
     parse layer, not the enum mapping.

### Regression Class

A wrong-mapping edit in `NCLX_MATRIX_MAP` — e.g. swapping entries 0 and 9, or
typoing `'bt2020-ncl'` to `'bt2020-cl'` for code 9 — would survive the full test
suite. This is the same class as:
- YCgCo mislabel (caught cycle 1, AGG-R7C1-02, matrix=8)
- gamma28 mislabel (caught cycle 2, AGG-R7C2-01, transfer=5)
- bt709 mislabel (caught cycle 4, AGG-R7C4-01, matrix=1)

AGG-R7C4-01's motivating note was "a code-1↔9 swap would go undetected." It
closed the matrix=1 side (code-1→bt709 now pinned) but left the matrix=9 side
open: a code-9→bt709 (or code-9→bt2020-cl) mislabel on the NCLX path is still
undetectable. Code-0 has the identical gap.

### Severity Rationale

LOW because `matrix_coefficients` is:
- admin-only (`_PrivacySensitiveKeys` — never in `publicSelectFields`)
- display-only in the Color Details audit accordion/pip — no encoder branch depends on it
- zero runtime risk to image delivery or public viewers

The fix is additive (two new it-blocks, zero source changes) and completes the
sweep AGG-R7C4-01 only half-finished.

### Fix (additive tests only — no source change)

Insert near line 337 (after the existing matrix=10 test), or adjacent to the
matrix=1 test block at lines 313-316:

```typescript
// TE-R7C5-01: complete the NCLX matrix-path pin set started by AGG-R7C4-01.
// matrix codes 1/8/10 are pinned on the NCLX path; 0 and 9 were exercised only
// with matrix passed-but-not-asserted (line 232) or asserted via the ICC-name
// path (line 81) — so a 9->1 swap (the dual of the code-1<->9 swap AGG-R7C4-01
// guarded) and a code-0 mislabel would go undetected on the NCLX path.
it('maps nclx matrix=0 to identity', async () => {
    const signals = await detectFromNclx(1, 1, 0);
    expect(signals.matrixCoefficients).toBe('identity');
});
it('maps nclx matrix=9 to bt2020-ncl', async () => {
    const signals = await detectFromNclx(9, 1, 9);
    expect(signals.matrixCoefficients).toBe('bt2020-ncl');
});
```

These calls are safe: `detectFromNclx(1, 1, 0)` uses primaries=1 (bt709) and
transfer=1 (srgb) — both are already verified by existing tests on adjacent lines,
so the only new coverage is the `matrixCoefficients` assertion. Similarly
`detectFromNclx(9, 1, 9)` is well-formed (bt2020 primaries, srgb transfer) and
the `matrixCoefficients` assertion is the only new pin.

---

## Carried Deferrals (unchanged from prior cycles, not re-filed as new)

These were first documented in cycles 2-3 and remain deferred by design. No
change in status.

| ID | File | Description | Severity |
|----|------|-------------|----------|
| TE-R7C2-02 | `color-detection.test.ts` | ICC chromaticity path (`icc-chromaticity.ts`) has no unit tests for the XYZ→xy conversion math; covered only indirectly via integration-level `detectColorSignals` calls | LOW |
| TE-R7C2-03 | `color-detection.test.ts` | Gain-map detection path (`gain-map-detection.ts`) is tested as a unit but `detectColorSignals` integration tests don't exercise the `has_gain_map=true` combined-signals path | LOW |
| TE-R7C2-04 | `color-detection.test.ts` | NCLX walker depth/size bounding (max box depth 5, max scan 1 MB) has no adversarial fuzz fixture | LOW |
| TE-R7C2-05 | `icc-chromaticity.ts` | Medium-confidence chromaticity match (ΔE ≤ 0.015) is untested; only high-confidence (ΔE ≤ 0.005) path exercised in existing tests | LOW |

---

## Test Health

**Cycle-4 fix:** INTACT
**New actionable findings this cycle:** 1 (TE-R7C5-01, LOW)
**Carried deferrals:** 4 (TE-R7C2-02 through TE-R7C2-05, LOW, unchanged)
**Source changes required:** none — fix is additive tests only
