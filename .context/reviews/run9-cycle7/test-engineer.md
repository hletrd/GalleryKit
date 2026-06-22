# Test Engineer Review — Run-9 Cycle-7

HEAD: feb63faa  
Date: 2026-06-21

---

## Executive Summary

**Overall test health: HEALTHY — 2058 passed, 4 skipped (CLIP offline integration, expected), 0 failed.**

The cycle-6 browser-upload settings-wiring fix (CR-R9C6-01) is correctly covered by `image-queue-settings-wiring.test.ts`. However, the LR Lightroom publish path at `apps/web/src/app/api/admin/lr/upload/route.ts:420` does **NOT** forward the same 6 admin-tunable processing settings, and **no existing test would catch this regression**. This is a confirmed DEFECT, not polish.

All other audited tests (backfill contract, migrate-reconcile tripwire, restore-scanner superset, privacy-fields, touch-target, i18n parity, NCLX map pins) are valid and non-vacuous.

---

## Special Focus: LR Upload Path Settings-Forwarding Gap

### Finding 1 — DEFECT (High confidence)

**ID:** TE-R9C7-01  
**Classification:** DEFECT  
**Confidence:** High  

**Claim to verify:** The LR PAT upload route at `:420` supplies `quality` + `imageSizes` but NOT the 6 settings, leaving those settings silently ignored for every Lightroom Classic publish.

**Verification:**

`apps/web/src/app/api/admin/lr/upload/route.ts` lines 420-444:

```
enqueueImageProcessing({
    id: imageId,
    filenameOriginal: data.filenameOriginal,
    filenameWebp: data.filenameWebp,
    filenameAvif: data.filenameAvif,
    filenameJpeg: data.filenameJpeg,
    width: data.width,
    topic: topicSlug,
    quality: {
        webp: config.imageQualityWebp,
        avif: config.imageQualityAvif,
        jpeg: config.imageQualityJpeg,
    },
    imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,
    camera_model: exifDb.camera_model,
    capture_date: exifDb.capture_date,
    iccProfileName: data.iccProfileName,
    colorSignals: data.colorSignals,
});
```

A grep for `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled` in `route.ts` returns **zero hits**. The 6 settings are entirely absent from the LR enqueue call.

**How the handler processes a job with quality but missing 6 settings:**

`apps/web/src/lib/image-queue.ts` lines 326-356:

```
let autoAltTextEnabled = job.autoAltTextEnabled ?? false;      // ?? false → falls to false
let forceSrgbDerivatives = job.forceSrgbDerivatives ?? false;  // ?? false → falls to false
let wideGamutJpegChroma: JpegChromaSubsampling | undefined = job.wideGamutJpegChroma;   // undefined
let avifEffort: number | undefined = job.avifEffort;           // undefined
let sdrJpegChroma: JpegChromaSubsampling | undefined = job.sdrJpegChroma;               // undefined
let wideGamutMaxSourcePixels: number | undefined = job.wideGamutMaxSourcePixels;         // undefined

if (!quality && !imageSizes) {   // quality IS set by LR route → gate NEVER enters
    // config load that would resolve the 6 → skipped entirely
}
```

Because `quality` is always supplied by the LR route, the `if (!quality && !imageSizes)` gate at line 336 never enters, and the 6 settings stay at their per-`??` or `undefined` fallbacks:

| Setting | LR path fallback | Intended behavior |
|---|---|---|
| `forceSrgbDerivatives` | `false` | Per admin setting — could be `true` |
| `wideGamutJpegChroma` | `undefined` → Sharp default `'4:2:0'` | Per admin setting — could be `'4:4:4'` or `'4:2:2'` |
| `avifEffort` | `undefined` → Sharp default `4` | Per admin setting — shipped default is `6` |
| `sdrJpegChroma` | `undefined` → Sharp default `'4:2:0'` | Per admin setting |
| `wideGamutMaxSourcePixels` | `undefined` → Sharp default `50_000_000` | Per admin setting |
| `autoAltTextEnabled` | `false` | Per admin setting — could be `true` |

This is the **same defect class as CR-R9C6-01** applied to the LR publish path. A photographer publishing P3 images through Lightroom Classic with `wideGamutJpegChroma='4:4:4'` and `avifEffort=9` set in admin settings would silently get `4:2:0` JPEG chroma subsampling and AVIF effort `4` instead. The browser upload path was fixed in cycle-6; the LR path was not.

**Does any existing test catch this?**

No. The `lr-upload-hdr-gate.test.ts` file (source-contract style, reading the literal source text) explicitly checks `camera_model` and `capture_date` in the enqueue block (lines 302-308 under COR-R4C1-05), but does **not** assert any of the 6 settings. A grep for `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled` in `lr-upload-hdr-gate.test.ts` returns **zero hits**.

The `image-queue-settings-wiring.test.ts` covers only the browser upload path — its test calls `enqueueImageProcessing(...)` directly with explicitly set job-level settings and asserts they reach `processImageFormats`. It does not cover the LR route's enqueue call.

**Fix:**

In `apps/web/src/app/api/admin/lr/upload/route.ts`, extend the `enqueueImageProcessing({...})` call at line 420 to mirror the browser upload path (`apps/web/src/app/actions/images.ts:440`):

```ts
enqueueImageProcessing({
    // ... existing fields ...
    forceSrgbDerivatives: config.forceSrgbDerivatives,
    wideGamutJpegChroma: config.wideGamutJpegChroma,
    avifEffort: config.avifEffort,
    sdrJpegChroma: config.sdrJpegChroma,
    wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
    autoAltTextEnabled: config.autoAltTextEnabled,
});
```

`config` is already the resolved `GalleryConfig` object (fetched earlier in the LR route handler). All 6 keys are present on it — no new DB fetch needed.

**Test gap (separate from the fix):**

After fixing the production code, add a source-contract assertion to `lr-upload-hdr-gate.test.ts` that the enqueue block contains all 6 settings, mirroring the COR-R4C1-05 block already there. This would prevent a silent regression on this path in the same way the browser path is protected by `image-queue-settings-wiring.test.ts`.

---

## Other Enqueue Sites — Status

**retryFailedImage** (`apps/web/src/app/actions/images.ts:1139`): Does NOT forward the 6 settings. This is the documented and intentional bootstrap-shaped job: no `quality`, no `imageSizes` supplied, so the `if (!quality && !imageSizes)` gate DOES enter and loads all settings from current config. Behavior is correct — retry re-encodes with current admin settings, not upload-time snapshot. Not a defect.

**Bootstrap path** (`apps/web/src/lib/image-queue.ts:674`): Same shape as retryFailedImage — no `quality`/`imageSizes`, gate enters, loads from config. Correct. Covered by `image-queue-settings-wiring.test.ts` test 2 ("bootstrap-shaped job").

**Admin backfill runner** (`apps/web/src/lib/admin-backfill-runner.ts:499`) and **sidecar backfill** (`apps/web/scripts/backfill-color-pipeline.ts:203`): These do not use `enqueueImageProcessing` at all — they call `processImageFormats` directly with explicit config passed through the `ReprocessOptions` parameter. Correct and separately covered by `backfill-color-pipeline.test.ts`.

**Re-enqueue same job** (`image-queue.ts:290/:510`): These are internal retry paths that re-queue the same `job` object, which preserves whatever settings were on the original job. Correct by construction.

---

## Audited Tests — Validation Results

### image-queue-settings-wiring.test.ts

**Status: Valid and non-vacuous.**

The test file documents its non-vacuousness explicitly: reverting the handler to resolve the 6 settings only inside the gate makes the `forceSrgbDerivatives`/chroma/effort/pixel assertions go RED. The mock infrastructure captures the PQueue task and runs it synchronously. `getGalleryConfigMock` is set to values DIFFERENT from both job values and process-image defaults, so any regression that causes the gate to enter would show the config values, not the job values. Test 2 (bootstrap shape) correctly verifies the gate path by omitting `quality`/`imageSizes`. Both tests are sound.

**Coverage boundary:** This test covers only the browser upload path by design (it calls `enqueueImageProcessing` directly). The LR path gap is TE-R9C7-01 above.

### lr-upload-hdr-gate.test.ts

**Status: Valid source-contract coverage for what it tests — but has a coverage gap for the 6 settings.**

The test correctly locks:
- HDR ingest gate ordering (before DB insert)
- GPS strip behind `config.stripGpsOnUpload`
- ICC descriptor written to `icc_profile_name` (not `color_space`)
- Upload attribution via `uploaded_by`
- Upload-processing-contract lock acquisition and release
- RAW rejection path
- Restore-maintenance window guard (pre and post)
- 1 GB disk pre-check
- Cumulative upload-tracker window
- Insert-failure containment try/catch
- Shared user-filename sanitizer
- Title/description code-point validation
- `camera_model` and `capture_date` in the enqueue payload

The test does NOT assert `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, or `autoAltTextEnabled` in the enqueue block. This omission means the defect in TE-R9C7-01 is undetected by the test suite.

### backfill-color-pipeline.test.ts

**Status: Valid, non-vacuous, and covers the column-set contract.**

The AGG-02 test at line 146 pins the exact set of persisted columns via `Object.keys(signals).sort()` equality. The column set tested (`['avif_10bit', 'color_pipeline_decision', 'color_primaries', 'has_gain_map', 'icc_profile_name', 'is_hdr', 'matrix_coefficients', 'transfer_function', 'was_downscaled']`) matches CLAUDE.md's documented backfill column set. The `R8-CRIT` test at line 227 verifies `forceSrgbDerivatives` is actually honored by the backfill (AVIF stays P3, JPEG goes sRGB). Tests use real Sharp instances against real file fixtures — not vacuous mocks. No issues.

### migrate-reconcile-coverage.test.ts

**Status: Valid and structurally sound.**

Three independent tripwires:
1. Column/table tripwire: introspects `drizzle-orm` `getTableColumns` against live `schema.ts`; strips JS comments before the presence check (AGG-R8c3-16a) so a column in a comment cannot satisfy the check.
2. Index tripwire: regex-scans all drizzle `*.sql` files for `CREATE [UNIQUE] INDEX` names; asserts each is present in comment-stripped `migrate.js` code.
3. DROP tripwire: explicitly pins `dropTableIfPresent('entitlements')` and `dropColumnIfPresent('images', 'license_tier')` in comment-stripped code.

The sanity check (`tables.length >= 15`, `images.columns.length >= 40`) and the index sanity check (`indexNames.length >= 10`) guard against a broken scanner producing vacuously passing per-item tests. All sound.

### sql-restore-scan.test.ts

**Status: Valid superset tripwire.**

The test at line 77 asserts `APP_BACKUP_TABLES` is a superset of every table name from the Drizzle schema (via `getTableName`). Sanity check at line 90 requires `schemaTables.length >= 18` and `'images'` membership. The test will fail loudly if a new table is added to `schema.ts` without adding it to `APP_BACKUP_TABLES` in `sql-restore-scan.ts`. Non-vacuous.

### privacy-fields.test.ts

**Status: Valid and symmetric.**

The symmetric guard test at line 83 computes the actual set difference between `adminSelectFieldKeys` and `publicSelectFieldKeys` and asserts it equals exactly `SENSITIVE_KEYS`. This is strictly stronger than the one-directional checks above it: it will catch a new admin-only column that the author forgot to add to `SENSITIVE_KEYS`, not just columns already in `SENSITIVE_KEYS` that leaked. The `timelineSelectFieldKeys` tests at lines 101-121 extend the same contract to the timeline query shape. SENSITIVE_KEYS list (line 6-42) is current — includes `uploaded_by`, `processing_error`, `failed_at`, `color_space`, `icc_profile_name`, `pipeline_version`, `was_downscaled`, `bit_depth`, `has_gain_map`. No drift detected.

### touch-target-audit.test.ts

Not deep-audited this cycle (no changes to the component surface in cycle-6/7 scope). Test suite passes cleanly at 2058/2062. The scanner infrastructure (multi-line normalization, `max-` ceiling lookbehind, `KNOWN_VIOLATIONS` table) is documented as correct in CLAUDE.md.

### i18n-key-parity.test.ts

**Status: Valid.**

Flattens both message files and asserts exact key-set equality with `setDifference`. Sanity check asserts `>= 30` keys in each. The documented asymmetry (Korean ICU plural vs. fixed form) is a VALUE difference, not a KEY difference, so the parity gate correctly handles it.

### NCLX map pins (color-detection.test.ts)

Not re-audited this cycle — all pins were confirmed complete in cycle-5 (matrix codes 0/1/8/9/10 all exercised; transfer codes 4/5/6/7/8/11/13/16/17/18/2 all exercised). The `matrix=8 → ycgco` and `transfer=5 → gamma28` fixes from R7C2-01 are pinned. Per the brief, re-filing these as new without new evidence is prohibited. Tests pass.

---

## Summary Table

| ID | File:Line | Type | Confidence | Verdict |
|---|---|---|---|---|
| TE-R9C7-01 | `lr/upload/route.ts:420` + `lr-upload-hdr-gate.test.ts` | DEFECT + coverage gap | High | **NEW — fix required** |
| image-queue-settings-wiring.test.ts | — | Test validity | High | VALID, non-vacuous |
| lr-upload-hdr-gate.test.ts | — | Test validity | High | VALID for what it covers; gap is TE-R9C7-01 |
| backfill-color-pipeline.test.ts | — | Test validity | High | VALID |
| migrate-reconcile-coverage.test.ts | — | Test validity | High | VALID |
| sql-restore-scan.test.ts | — | Test validity | High | VALID |
| privacy-fields.test.ts | — | Test validity | High | VALID, symmetric guard correct |
| i18n-key-parity.test.ts | — | Test validity | High | VALID |
| NCLX pins | color-detection.test.ts | Test validity | High | VALID (complete per cycle-5) |

---

## Test Metrics

- Test files: 225 passed, 2 skipped
- Tests: 2058 passed, 4 skipped (CLIP offline — expected, no CLIP weights in dev env)
- 0 failures
