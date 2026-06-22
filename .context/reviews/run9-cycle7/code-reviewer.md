# Code Reviewer — Run-9 Cycle-7 (HEAD feb63faa)

Angle: correctness / logic / data-flow / quality. Validated from code, not comments.

## Code Review Summary

**Files reviewed (focused + sweep):** image-queue.ts, app/actions/images.ts (upload + retryFailedImage),
api/admin/lr/upload/route.ts, lib/admin-backfill-runner.ts, scripts/backfill-color-pipeline.ts,
lib/process-image.ts (signature), lib/gallery-config.ts, lib/caption-generator.ts,
lib/view-retention.ts, lib/sql-restore-scan.ts (+ db-actions consumer),
__tests__/image-queue-settings-wiring.test.ts.

**Total findings:** 1 DEFECT (High confidence), 1 POLISH (test-mock drift, Low).

### By Severity
- CRITICAL: 0
- HIGH: 1 (the LR-route 6-settings omission — MEDIUM severity / HIGH confidence; data/intent-loss on the primary non-browser ingest path)
- MEDIUM: 0
- LOW: 1 (POLISH — stale test mock path)

---

## SPECIAL FOCUS #3 — enqueue / processing-consumer audit

`processImageFormats` positional signature (process-image.ts:958-973):
`(inputPath, webp, avif, jpeg, baseWidth, quality?, sizes=DEFAULT, iccProfileName?, forceSrgbDerivatives?, signals?, wideGamutJpegChroma?, avifEffort?, sdrJpegChroma?, wideGamutMaxSourcePixels?)`.
Note: `autoAltTextEnabled` is NOT a `processImageFormats` arg — it gates the queue handler's
fire-and-forget caption hook only (image-queue.ts:415-418, caption-generator.ts:58). So backfill
paths legitimately do not carry it; only enqueue paths that want auto-captioning must.

Handler gate (image-queue.ts:336): `if (!quality && !imageSizes)`. The 6 settings are seeded from
`job.*` BEFORE the gate (image-queue.ts:326-335) with `?? false` / `undefined` defaults; the gate
only re-loads from config when BOTH quality AND imageSizes are absent. **Therefore any enqueue that
supplies `quality` but NOT the 6 silently gets process-image defaults for the 6 — the exact
CR-R9C6-01 defect class.**

Complete call-site inventory (grep `enqueueImageProcessing(` across src + scripts — 6 sites, all audited):

| # | Entry point | file:line | supplies quality? | supplies the 6? | Gate enters? | Verdict |
|---|---|---|---|---|---|---|
| 1 | Browser upload | actions/images.ts:440 | yes (448-452) | **yes, all 6** (461-466) | no (correct) | **PASS** — the CR-R9C6-01 fix |
| 2 | retryFailedImage | actions/images.ts:1139 | **no** | no | **yes -> config-load** | **PASS** by fallback |
| 3 | LR PAT publish | api/admin/lr/upload/route.ts:420 | **yes** (428-433) | **NO** | **NO (skipped)** -> 6 fall to defaults | **FAIL — DEFECT (see CR-R9C7-01)** |
| 4 | Bootstrap | image-queue.ts:674 | no | no | yes -> config-load | **PASS** by fallback |
| 5 | Claim-retry re-enqueue | image-queue.ts:290 | re-enqueues SAME `job` | n/a | preserves job | **PASS** (carries whatever original carried) |
| 6 | Error-retry re-enqueue | image-queue.ts:510 | re-enqueues SAME `job` | n/a | preserves job | **PASS** |

Direct (non-queue) `processImageFormats` callers — both load `settings` from `getGalleryConfig()`
and forward all 7 positionally in correct order; verified against the signature:
- **admin-backfill-runner.ts:499-514** — `settings` built from config at :644-657; args match. **PASS**.
- **scripts/backfill-color-pipeline.ts:203-218** — `BackfillSettings` from config; args match. **PASS**.

### CR-R9C7-01 — LR PAT publish ignores the 6 admin processing settings on enqueue  [DEFECT, confidence: High]

**Where:** `apps/web/src/app/api/admin/lr/upload/route.ts:420-444` (the `enqueueImageProcessing({...})` call).
The job object supplies `quality` (lines 428-432) and `imageSizes` (line 433) but omits all of
`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`,
`wideGamutMaxSourcePixels`, and `autoAltTextEnabled`.

**Why it is a problem (proven, not inferred):**
- Because `quality` is present, the handler gate `if (!quality && !imageSizes)` at
  image-queue.ts:336 is **skipped**, so the config-load block (337-356) never runs for LR jobs.
- The 6 settings therefore resolve to the pre-gate defaults at image-queue.ts:326-335:
  `autoAltTextEnabled = job.autoAltTextEnabled ?? false` -> **false**;
  `forceSrgbDerivatives = job.forceSrgbDerivatives ?? false` -> **false**;
  `wideGamutJpegChroma / avifEffort / sdrJpegChroma / wideGamutMaxSourcePixels = job.*` -> **undefined**.
- `processImageFormats` then applies its own fallbacks (e.g. `wideGamutMaxSourcePixels ?? 50_000_000`
  at process-image.ts:1004; effort/chroma to Sharp/encoder defaults). These DIVERGE from admin config.
- The values ARE available to forward: `config = await getGalleryConfig()` at route.ts:170 is the full
  `GalleryConfig`; gallery-config.ts:62-90 confirms it exposes all 6 fields. So this is a genuine
  omission, not "values unavailable."
- This is byte-for-byte the same defect class that CR-R9C6-01 (commit 2078e43f) just fixed for the
  browser path — the fix was applied to images.ts:440 but NOT to the sibling LR ingest path.

**Concrete failure scenario:**
Admin sets `avif_effort=9`, `force_srgb_derivatives=true`, `wide_gamut_jpeg_chroma='4:4:4'`,
`sdr_jpeg_chroma='4:2:2'`, `wide_gamut_max_source_pixels=80_000_000`, and `auto_alt_text_enabled=true`.
A photographer publishes via the Lightroom Classic plugin (the primary non-browser ingest path).
The resulting derivatives are encoded at effort 6 (not 9 -> larger AVIFs), wide-gamut JPEG at the
encoder-default chroma instead of 4:4:4, `force_srgb_derivatives` ignored (P3 WebP/JPEG emitted even
though admin demanded sRGB), the 50 MP cap applied instead of 80 MP (a 60 MP wide-gamut publish is
needlessly downscaled), and **no auto alt-text is ever generated** (`generateCaption` returns null
when `autoAltTextEnabled` is false — caption-generator.ts:58). The SAME photo re-encoded later by an
admin backfill (which DOES honor config) produces DIFFERENT bytes/alt-text — the precise
inconsistency CR-R9C6-01 set out to eliminate, still live on the Lightroom path.

**Severity rationale:** MEDIUM severity (no crash / no security / no data-loss; it is correctness +
intent-loss + cross-path inconsistency on a real product runtime path), HIGH confidence (mechanism
fully traced through the gate; values provably available; mirrors an already-accepted fix).

**Fix:** forward the 6 from `config` in the LR enqueue, mirroring images.ts:461-466:

```ts
enqueueImageProcessing({
    id: imageId,
    /* …existing fields… */
    quality: { webp: config.imageQualityWebp, avif: config.imageQualityAvif, jpeg: config.imageQualityJpeg },
    imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,
    forceSrgbDerivatives: config.forceSrgbDerivatives,
    wideGamutJpegChroma: config.wideGamutJpegChroma,
    avifEffort: config.avifEffort,
    sdrJpegChroma: config.sdrJpegChroma,
    wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
    autoAltTextEnabled: config.autoAltTextEnabled,
    camera_model: exifDb.camera_model,
    capture_date: exifDb.capture_date,
    iccProfileName: data.iccProfileName,
    colorSignals: data.colorSignals,
});
```

**Test gap that let it through:** `__tests__/image-queue-settings-wiring.test.ts` pins only the
handler (job-carried vs. config-gate) and the browser-shaped job. It never drives the LR route's
enqueue, so the LR omission is invisible to the suite. Recommend extending coverage to assert the LR
route builds a job carrying all 6 (or a route-level fixture that intercepts `enqueueImageProcessing`
and asserts the job shape). Other enqueue paths' parity (browser carries 6; retry/bootstrap fall
back) is correct and worth pinning at the same time.

---

## Broad sweep (no new DEFECTs)

Examined for logic/edge/error-handling/invariant issues; all sound:

- **image-queue.ts retry preservation** (290/510): re-enqueue passes the SAME `job` reference, so
  retried jobs keep their upload-time 6-setting snapshot. Correct — no re-read of (possibly changed)
  config mid-retry, matching the "snapshot at accept time" intent (lines 316-317). No defect.
- **image-queue.ts gate semantics** (336): `!quality && !imageSizes` is the intended bootstrap/legacy
  discriminator; browser+LR always supply quality, retry/bootstrap supply neither. The 6 pre-gate
  seeds (326-335) make the handler robust to partially-populated jobs. Sound.
- **deleted-mid-processing cleanup** (394-411): `affectedRows === 0` -> `deleteImageVariants(dir, fn, [])`
  full-dir scan catches non-default-size variants. Consistent with both backfill paths. No orphan.
- **view-retention.ts**: future-cutoff guard present (`resolveRetentionMs` rejects non-finite / <=0 ->
  default; lines 39-47); chunked DELETE bounded at 200x5000/table/sweep; uses `(…, viewed_at)`
  composite index range. No data-loss path. Sound.
- **sql-restore-scan.ts** (+ db-actions.ts:424-425 consumer): conditional-comment inner text is
  scanned (line 118), app-backup DROPs masked before the DROP-TABLE guard, literals/hex/binary masked,
  and the consumer scans `combined` (prev 1 MB tail + chunk) so a dangerous statement straddling a
  chunk boundary is still caught. Defense-in-depth pattern set is comprehensive. Sound.
- **LR route parity (non-encode)**: honors `allow_hdr_ingest` (route.ts:300) and `strip_gps_on_upload`
  (311-324), attributes `uploaded_by = tokenUserId` (390), forwards EXIF caption inputs (438-439) and
  colorSignals (443). The ONLY parity break with the browser path is the 6 encode settings
  (CR-R9C7-01). This isolation strengthens confidence the omission is an oversight, not by design.
- **retryFailedImage** (images.ts:1085-1160): auth order (requireSameOriginAdmin -> isAdmin), integer
  id guard, `processed=false AND processing_error IS NOT NULL` fetch filter, clears failure columns +
  in-memory failure maps before re-enqueue. The bootstrap-shaped job (no quality/sizes) correctly
  hits the config-load gate, so retried images get current config. Sound.

### POL-R9C7-01 — stale mock path in settings-wiring test  [POLISH, confidence: Low]

`__tests__/image-queue-settings-wiring.test.ts:87` mocks `@/lib/caption` (`generateCaption`), but
image-queue.ts:21 imports from `@/lib/caption-generator`. The mock is therefore inert; the test
passes only because `generateCaption` is fire-and-forget and the real stub returns null when
`autoAltTextEnabled` is false. Not a runtime bug and not in the product path — purely a test that
isn't asserting what its mock implies. Fix: change the mock target to `@/lib/caption-generator`.
Low priority; flagged for accuracy, not as blocking.

---

## Open Questions
None at actionable confidence. No low-confidence CRITICAL/HIGH findings to surface.

## Positive Observations
- The CR-R9C6-01 browser fix is clean and the pre-gate seeding (image-queue.ts:326-335) makes the
  handler tolerant of any job shape — a good defensive design that limited the LR regression's blast
  radius to defaults rather than crashes.
- Both backfill paths and the queue handler forward the identical 14-arg positional `processImageFormats`
  call in the same order; no positional drift across the three direct callers.
- view-retention and sql-restore-scan show consistent, well-documented defense-in-depth with future-proof
  guards (future-cutoff, chunk-boundary straddle, conditional-comment scanning).

## Recommendation
**REQUEST CHANGES** — one MEDIUM-severity / HIGH-confidence DEFECT (CR-R9C7-01) on the Lightroom PAT
publish path: forward the 6 admin processing settings from `config` at api/admin/lr/upload/route.ts:420,
mirroring the browser fix at actions/images.ts:461-466, and extend the settings-wiring test to cover
the LR enqueue. The lead's preliminary read is **CONFIRMED**.
