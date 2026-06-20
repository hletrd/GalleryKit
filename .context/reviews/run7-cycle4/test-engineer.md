# Test Engineer Review — Run 7 Cycle 4

**Reviewer:** test-engineer
**HEAD:** 25bb2794
**Delta base:** c6eff919 (run-7 cycle-3)
**Suite state:** 2237 passed / 4 skipped (238 test files)

---

## 1. Cycle-3 Fix Verification

### Fix 1 — AGG-R7C3-01: color-detection.ts comment clarification

**Nature of change:** Comment-only. Two NCLX_TRANSFER_MAP entries revised:
- Entry `11` (xvYCC): comment reworded to clarify it uses the BT.709 curve extended to negative R'G'B', approximated as `'srgb'`. **Mapped value unchanged** (`'srgb'`).
- Entries `14`/`15` (BT.2020 10/12-bit SDR): comment corrected to distinguish the BT.2020 *transfer* from the BT.2020-NCL *matrix* coefficient. **Mapped values unchanged** (`'gamma24'`).

**Test pin status: CORRECTLY PINNED.**

`color-detection.test.ts` pins all three values with behavioral round-trip tests:
- Line 293: `'maps nclx transfer=11 to srgb (xvYCC)'` — asserts `transferFunction = 'srgb'`.
- Line 311: `'maps nclx transfer=14 to gamma24 (BT.2020 10-bit / BT.1886)'` — asserts `transferFunction = 'gamma24'`.
- Line 317: `'maps nclx transfer=15 to gamma24 (BT.2020 12-bit / BT.1886)'` — asserts `transferFunction = 'gamma24'`.

All three pass in the fresh run above (60 tests, 0 failures).

### Fix 2 — AGG-R7C3-02: settings-hash.ts compile-time guard

**Nature of change:** Added `_ColorKeysAreSettingKeys` type alias + const assignment that enforces every entry in `COLOR_IMPACTING_KEYS` is a valid `GallerySettingKey` at `tsc` time. No runtime logic changed.

**Test pin status: CORRECTLY COVERED.**

The guard is a compile-time-only invariant; it has no runtime representation and therefore needs no runtime test. Coverage is provided by:
1. `npm run typecheck` (passes clean as of HEAD — verified above).
2. `settings-hash.test.ts` behaviorally pins all 9 `COLOR_IMPACTING_KEYS` individually (`differs when X changes` tests, lines 48–100), ensuring none can be silently dropped from the hash computation without a test failure.

The `getColorSettingsHash` round-trip test (line 108) confirms the config-→-raw-string mapping for all 9 keys in a single fixture call.

---

## 2. Exhaustive Wrong-Value Pin Sweep

Reviewed every `toBe`/`toEqual`/`toContain` assertion against color enum values across all test files. No wrong-value pins found.

**Full NCLX_TRANSFER_MAP coverage (all 12 mapped keys tested):**

| Code | Value | Asserted in test |
|------|-------|-----------------|
| 1 | `srgb` | Line 186 (implicit via detectFromNclx(11,1,1)) + line 302 |
| 4 | `gamma22` | Line 209 |
| 5 | `gamma28` | Line 218 (corrected in run-7 cycle-2 AGG-R7C2-01) |
| 6 | `gamma22` | Line 280 |
| 7 | `gamma22` | Line 224 |
| 8 | `linear` | Line 193 |
| 11 | `srgb` | Line 293 |
| 13 | `srgb` | Line 286 |
| 14 | `gamma24` | Line 311 |
| 15 | `gamma24` | Line 317 |
| 16 | `pq` | Line 171 |
| 17 | `gamma26` | Line 199 |
| 18 | `hlg` | Line 178 |

**Full NCLX_PRIMARIES_MAP coverage (all 4 mapped keys tested):**

| Code | Value | Asserted in test |
|------|-------|-----------------|
| 1 | `bt709` | Line 186 (via detectFromNclx, implicit) |
| 9 | `bt2020` | Lines 172–183 |
| 11 | `dci-p3` | Line 185 |
| 12 | `p3-d65` | Line 231 |

**Full NCLX_MATRIX_MAP coverage (all 5 mapped keys tested):**

| Code | Value | Asserted in test |
|------|-------|-----------------|
| 0 | `identity` | Lines 63, 72, 90, 99, 108, 257 |
| 1 | `bt709` | Used in detectFromNclx(11,1,1) but matrixCoefficients NOT asserted (see Section 3) |
| 8 | `ycgco` | Line 301 (corrected in run-7 cycle-1 AGG-R7C1-01) |
| 9 | `bt2020-ncl` | Line 81 (ICC name path), line 495 (parseCicpFromHeif raw) |
| 10 | `bt2020-cl` | Line 323 |

**humanize-transfer-function-i18n.test.ts:** All transfer enum values including `gamma28` (BT.470BG label, not "System M") correctly asserted in Korean locale at line 83. No wrong-value pins.

**color-details-section-delivered.test.ts:** String literals `'ycgco'`, `'bt2020-ncl'`, `'bt2020-cl'` asserted at lines 101–104 match the source enum values. No wrong-value pins.

---

## 3. New Test Gaps

### TE-R7C4-01 — NCLX matrix=1 (`bt709`) output not asserted

**File:** `apps/web/src/__tests__/color-detection.test.ts`
**Invariant:** `NCLX_MATRIX_MAP[1] = 'bt709'` in `color-detection.ts:216`. The only test that passes `matrix=1` to `detectFromNclx` is the primaries=11 test at line 185, which asserts `colorPrimaries` and `transferFunction` but NOT `matrixCoefficients`. A future typo changing `NCLX_MATRIX_MAP[1]` from `'bt709'` to some other value would go undetected.

**Regression scenario:** Refactor accidentally swaps matrix codes 1 and 9 (bt709 ↔ bt2020-ncl). The bt2020-ncl value IS asserted (line 81), but via the ICC-name path, not the NCLX path. A HEIF/AVIF with NCLX matrix=1 would silently emit the wrong `matrixCoefficients` in the DB.

**Suggested test:**
```typescript
it('maps nclx matrix=1 to bt709', async () => {
    const signals = await detectFromNclx(1, 1, 1);
    expect(signals.matrixCoefficients).toBe('bt709');
});
```

**Risk:** Low. NCLX matrix=1 is the BT.709 matrix coefficient and is rarely used in modern HEIF/AVIF streams (most sRGB content omits NCLX entirely; BT.2020 content uses matrix 9). The missing assertion is an audit-display-only field (admin-only `matrixCoefficients`), not a byte-delivery invariant.
**Confidence:** H (the gap is real; the risk is low).

---

## 4. Deferred Items Confirmation

All four previously deferred items (TE-R7C2-02 through TE-R7C2-05) remain unchanged — no new application logic was added in cycle-3, so no exit criterion was met. They carry forward as-is.

MED-R7C2-01 (histogram clip) and REJ-R7C3-01 (indexSize) not re-filed.

---

## 5. Verdict

**Cycle-3 fixes correctly pinned: YES** (comment-only change; values unchanged; existing behavioral tests unchanged and passing).

**Wrong-value pins found: 0** (exhaustive sweep of all NCLX map entries and color enum assertions).

**New genuine gaps: 1** (TE-R7C4-01, Low risk — NCLX matrix=1 output unasserted).

This is a converging run. The one new finding is minor and requires a single 4-line test to close.

---

## Verification

```
Test Files  2 passed (2)        [color-detection, settings-hash]
      Tests  60 passed (60)
Test Files  238 passed | 2 skipped (240)   [full suite]
      Tests  2237 passed | 4 skipped (2241)
```
