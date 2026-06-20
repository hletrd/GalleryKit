# Test Engineer Review — Run 7 Cycle 6

**Reviewer:** test-engineer (oh-my-claudecode)
**Date:** 2026-06-20
**HEAD:** e855e6ee (cycle-5 AGG-R7C5-01 commit)
**Scope:** NCLX matrix/transfer spec-map value correctness; cycle-5 fix verification; high-bar new-finding scan

---

## Result: 0 new actionable findings — truthful zero

---

## Cycle-5 Fix Verification

AGG-R7C5-01 is intact. Both new tests are present in `apps/web/src/__tests__/color-detection.test.ts` and pass:

- Line 327: `it('maps nclx matrix=0 to identity', ...)` — asserts `matrixCoefficients === 'identity'`
- Line 332: `it('maps nclx matrix=9 to bt2020-ncl', ...)` — asserts `matrixCoefficients === 'bt2020-ncl'`

All 48 tests in `color-detection.test.ts` pass (vitest run, 3.50s):

```
Test Files  1 passed (1)
     Tests  48 passed (48)
```

---

## Spec-Map Value Audit (ITU-T H.273 cross-check)

Every asserted enum string in `detectColorSignals` tests was verified against ITU-T H.273 Tables 2, 3, and 4, and the in-source annotations in `color-detection.ts`.

### NCLX_PRIMARIES_MAP (H.273 Table 2)

| Code | Asserted | Spec | Status |
|------|----------|------|--------|
| 1 | `bt709` | BT.709 | CORRECT |
| 9 | `bt2020` | BT.2020 | CORRECT |
| 11 | `dci-p3` | SMPTE EG 432-1 (DCI-P3) | CORRECT |
| 12 | `p3-d65` | Display P3 / P3-D65 | CORRECT |

### NCLX_TRANSFER_MAP (H.273 Table 3)

| Code | Asserted | Spec | Status |
|------|----------|------|--------|
| 1 | `srgb` | BT.709 (approximated as sRGB — documented) | CORRECT |
| 4 | `gamma22` | BT.470M (NTSC, gamma 2.2) | CORRECT |
| 5 | `gamma28` | BT.470BG (PAL/SECAM, gamma 2.8) | CORRECT (AGG-R7C2-01) |
| 6 | `gamma22` | SMPTE 170M (same family) | CORRECT |
| 7 | `gamma22` | SMPTE 240M (approximated) | CORRECT |
| 8 | `linear` | Linear | CORRECT |
| 11 | `srgb` | IEC 61966-2-4 xvYCC (BT.709 curve; approximated as srgb) | CORRECT |
| 13 | `srgb` | sRGB IEC 61966-2-1 | CORRECT |
| 14 | `gamma24` | BT.2020 10-bit (BT.1886 / gamma 2.4) | CORRECT |
| 15 | `gamma24` | BT.2020 12-bit (BT.1886 / gamma 2.4) | CORRECT |
| 16 | `pq` | SMPTE ST 2084 (PQ) | CORRECT |
| 17 | `gamma26` | SMPTE ST 428-1 (DCI-P3 gamma 2.6) | CORRECT |
| 18 | `hlg` | ARIB STD-B67 (HLG) | CORRECT |

### NCLX_MATRIX_MAP (H.273 Table 4)

| Code | Asserted | Spec | Status |
|------|----------|------|--------|
| 0 | `identity` | Identity / GBR | CORRECT |
| 1 | `bt709` | BT.709 | CORRECT |
| 8 | `ycgco` | YCgCo | CORRECT (AGG-R7C1-01) |
| 9 | `bt2020-ncl` | BT.2020 NCL | CORRECT |
| 10 | `bt2020-cl` | BT.2020 CL | CORRECT |

All 5 NCLX_MATRIX_MAP entries are value-pinned on the NCLX detection path as of AGG-R7C5-01. No entry is wrong.

---

## Observation: Two Misleading Comments (Not Actionable)

In the `parseCicpFromHeif` describe block (which tests the raw ISOBMFF walker, not enum mapping):

- **Line 519**: comment reads `// BT.2020, PQ, BT.2020-ncl` for `makeColrNclx(9, 13, 9)` — transfer code 13 is sRGB (IEC 61966-2-1), not PQ (PQ is code 16). The assertion is `expect(result!.transferCharacteristics).toBe(13)` — a raw integer round-trip assertion that is **correct**. The misleading label is in the comment only.

- **Line 537**: comment reads `// prof then P3/HLG` for `makeColrNclx(12, 14, 0)` — transfer code 14 is gamma24 (BT.2020 10-bit / BT.1886), not HLG (HLG is code 18). The assertion is `expect(result!.transferCharacteristics).toBe(14)` — again a correct raw integer assertion.

These are misleading inline comments in the raw-parser test block. They do NOT constitute wrong-value pins because `parseCicpFromHeif` returns raw integers (`CicpTriplet`), not mapped enum strings — the comment mislabels do not influence what is actually asserted. The `detectColorSignals` describe block has separate, correctly labeled dedicated tests for transfer=13→`srgb` (line 286) and transfer=14→`gamma24` (line 342). These comment errors are **not actionable findings** per the high bar: no assertion is wrong, no regression scenario exists. They are noted here for documentation fidelity only.

---

## Deferred Register (unchanged)

- TE-R7C2-02: Stripe webhook behavioral test
- TE-R7C2-03: Semantic malformed-row route test
- TE-R7C2-04: logAuditEvent truncation test
- TE-R7C2-05: Embeddings action test

No new entries.

---

## Summary

**0 new actionable findings.** All spec-map values in `NCLX_PRIMARIES_MAP`, `NCLX_TRANSFER_MAP`, and `NCLX_MATRIX_MAP` are correct per ITU-T H.273. The cycle-5 AGG-R7C5-01 fix (matrix codes 0 and 9 pinned on the NCLX path) is intact and passes. The NCLX matrix/transfer map pin class remains COMPLETE/EXHAUSTED. Truthful zero.
