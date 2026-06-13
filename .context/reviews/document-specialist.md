# Document-Specialist Review — Cycle 6 (run-9 cycle-3)

**NEW findings: 1 genuine documentation omission. All prior 35+ claims re-confirmed accurate.**

---

## Summary

Cycle 5 landed 6 code/test fixes (plan-339 Items 1–6 all marked DONE). This review re-checked every cycle-5-touched doc claim against HEAD and found one genuine omission introduced by the AGG-C5-02 fix. All other claims verified accurate.

---

## FINDING 1 — GENUINE OMISSION (LOW)

### CLAUDE.md line 512: `<select>` touch-target description omits the `(?<!max-)` lookbehind added by AGG-C5-02

**Doc location:** `CLAUDE.md:512`

**Current doc text:**
> native `<select className="...h-8/h-9/h-10...">` literals, `cn()` composites, and sub-44 arbitrary `min-h-[NNpx]` values — hand-styled selects sit outside the shadcn `SelectTrigger` primitive's built-in `min-h-11` floor (R4C16 DES-R4C16-04).

**Code at HEAD:** `apps/web/src/__tests__/touch-target-audit.test.ts:415,419`

The two `<select>` h-8/h-9/h-10 FORBIDDEN patterns now read:
```
/<select\b(?![^>]*\b(?:h-1[12]|min-h-1[12])\b)[^>]*\bclassName=["'][^"']*\b(?<!max-)(?:h-8|h-9|h-10)\b/
```

The `(?<!max-)` lookbehind is present (added by plan-339 Item 2 / AGG-C5-02). The CLAUDE.md description of the `<select>` pattern does not mention this lookbehind — it describes the pattern as simply matching `h-8/h-9/h-10`, which is incomplete. A future maintainer reading only the docs would not know that `<select className="max-h-10">` is intentionally NOT flagged.

The docs also correctly describe the `<Button>`/`<button>` scale-token patterns as having `(?<!max-)` (line 514, implicitly via the AGG-R8c3-06 description), but line 512 predates that level of detail for `<select>`.

**The mismatch:** CLAUDE.md says the `<select>` patterns catch `h-8/h-9/h-10` — factually incomplete; they catch `(?<!max-)h-8/h-9/h-10`. The negative self-check fixtures for `max-h-10`/`max-h-8`/`cn("max-h-10")` (added at lines 990–993 of the test file) also go unmentioned.

**Correct value:** The description should add that the `h-8/h-9/h-10` branch carries `(?<!max-)` (mirroring the Button fix), so `max-h-{8,9,10}` ceiling utilities are NOT flagged.

**Recommended fix:** Update CLAUDE.md line 512 to:

> native `<select className="...h-8/h-9/h-10...">` literals and `cn()` composites — each carries a `(?<!max-)` lookbehind so `max-h-{8,9,10}` ceiling utilities are NOT flagged (AGG-C5-02 closes the same false-positive the Button patterns got in AGG-C4-01) — and sub-44 arbitrary `min-h-[NNpx]` values — hand-styled selects sit outside the shadcn `SelectTrigger` primitive's built-in `min-h-11` floor (R4C16 DES-R4C16-04).

**Confidence:** High (code verified; the lookbehind is present at lines 415, 419 of the test file; CLAUDE.md line 512 does not mention it).

**Severity:** LOW — the docs describe the pattern as more permissive than it actually is (false positive that doesn't occur); no live defect; maintenance-documentation gap only.

**Which side to change:** CLAUDE.md (the code is correct; the docs are incomplete).

---

## VERIFIED ACCURATE — ALL CYCLE-5-TOUCHED CLAIMS

### 1. React `cache()` wraps 10 data-access functions (CLAUDE.md:357)

Claim: "React `cache()` wraps 10 data-access functions — every `data.ts` export ending in `Cached` (`getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`) plus `getSeoSettings`"

Code: `apps/web/src/lib/data.ts` has exactly 10 `= cache(...)` assignments at lines 1332, 1595, 1597–1601, 1603, 1608, 1649. Names match exactly. **CORRECT.**

### 2. Settings hash covers all 9 COLOR_IMPACTING_KEYS (settings-hash.ts:37-49) (CLAUDE.md:263)

Code: `apps/web/src/lib/settings-hash.ts` lines 37–48 define exactly 9 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. Line 49 closes the array. HASH_LENGTH = 8 at line 51. **CORRECT.**

### 3. Both backfill paths persist the SAME 10-column set (CLAUDE.md:291)

Sidecar (`scripts/backfill-color-pipeline.ts` lines 371–380): UPDATE includes `pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit` — 10 columns.

In-app runner (`apps/web/src/lib/admin-backfill-runner.ts` lines 558–570): same 10 columns.

Both also handle the detection-failure case (derivative-only 2-column update for `was_downscaled`/`avif_10bit` without a `pipeline_version` bump). **CORRECT.**

### 4. Touch-target `<select>` patterns have `(?<!max-)` for h-8/h-9/h-10 (code)

Plan-339 Item 2 (AGG-C5-02) closed. The code at `touch-target-audit.test.ts:415,419` does carry `(?<!max-)` before the `h-8|h-9|h-10` group. Negative fixtures for `max-h-10`, `max-h-8`, `cn("max-h-10")`, `max-h-screen` added at lines 990–993. **CORRECT in code; omitted in CLAUDE.md — see Finding 1.**

### 5. i18n key-parity test committed (CLAUDE.md:477 + Testing section)

`apps/web/src/__tests__/i18n-key-parity.test.ts` exists and is tracked in git (plan-339 Item 4 / AGG-C5-T1). CLAUDE.md:477 references "the i18n key-parity check" as an existing enforcement gate. The test implements keys-only SET equality. **CORRECT.**

### 6. IMAGE_PIPELINE_VERSION = 7 defined in gallery-config-shared.ts:21 (CLAUDE.md:92)

Code: `apps/web/src/lib/gallery-config-shared.ts:21` = `export const IMAGE_PIPELINE_VERSION = 7;`. `process-image.ts:303` re-exports it. **CORRECT.**

### 7. Concurrency cap formula at pool=10 → cap=2 (CLAUDE.md:294)

Code: `apps/web/src/lib/admin-backfill-runner.ts:105–139`. `RESERVED = max(3, ceil(10/2)) = 5`. `cap = max(1, floor((10 – 5 – 1)/2)) = floor(4/2) = 2`. The inline comment at line 122–123 matches the CLAUDE.md formula. **CORRECT.**

### 8. sanitizeForOg imported by all three consumers (CLAUDE.md:181)

All three consumers verified at HEAD:
- `apps/web/src/app/api/og/route.tsx:5` — imports `sanitizeForOg`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:8` — imports `sanitizeForOg`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:14` — imports `sanitizeForOg`

**CORRECT.**

### 9. AGENTS.md:40 ".context/plans/ is gitignored"

`.gitignore` at lines 19–21: `.context/*` (ignores all) + `!.context/reviews/` + `!.context/reviews/**` (un-ignores reviews). So `.context/plans/` IS covered by the `!` exception's absence and is gitignored for NEW files. However, the directory contains tracked files committed before the rule (as noted in the prior cycle's aggregate as an imprecision, not a contradiction). No change since last cycle — same imprecision, not a code-value mismatch. Prior cycle's observation stands; not escalated.

### 10. Admin tunables table (CLAUDE.md:275–284) lists 7 settings

The table header is "Admin tunables (color/HDR)". It lists 7 settings and does not include `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, or `image_sizes`. These 4 additional settings exist in `gallery-config-shared.ts` and are in `COLOR_IMPACTING_KEYS` (documented at CLAUDE.md:263). The table footer says "Flipping any of these requires a backfill pass" — "these" refers to the 7 in the table. This is an incomplete table, but the section is explicitly titled "color/HDR" tunables, and the 9-key ETag paragraph already names all 9. The omission is pre-existing (not introduced by cycle 5) and is arguably intentional scoping. Not escalated as a new finding.

---

## CONCLUSION

**1 new LOW finding** (CLAUDE.md:512 select pattern description omits `(?<!max-)` lookbehind added by AGG-C5-02). All 35+ previously-verified claims and all cycle-5-touched claims are accurate at HEAD. The code is correct; the docs are incomplete on one detail.

**Recommended action:** Update CLAUDE.md:512 to mention the `(?<!max-)` lookbehind on the `<select>` h-8/h-9/h-10 patterns (mirrors the existing Button description). One-line doc fix.
