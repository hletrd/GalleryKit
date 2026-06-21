# Tracer Report — Run-9 Cycle-6

HEAD: ba3277da

---

## Trace Report

### Observation

The code-reviewer (CR-R9C6-01) claimed: in `lib/image-queue.ts` the job handler resolves
six admin-configurable processing settings (`autoAltTextEnabled`, `forceSrgbDerivatives`,
`wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`) ONLY inside
`if (!quality && !imageSizes)`. The upload path (`actions/images.ts`) ALWAYS supplies `quality`
and `imageSizes`, so that block is skipped on every real upload, and those six settings fall
back to `process-image.ts` hardcoded defaults — different from what the backfill runner
supplies — creating a silent asymmetry between freshly-uploaded and backfilled photos.

---

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | CR-R9C6-01 is CONFIRMED: upload path skips the 6 settings; fallbacks are coincidentally identical to the admin config defaults, so no observable damage occurs today but the asymmetry is real | High | Strong (Tier-1 file:line) | Gate condition at image-queue.ts:318 is exactly as described; upload never passes the 6 settings; fallback values in process-image.ts match the shared DEFAULTS |
| 2 | CR-R9C6-01 is CONFIRMED with observable damage: non-default admin values for the 6 settings produce different output on upload vs backfill | Medium | Strong | Requires an admin to have changed one of the 6 away from its default |
| 3 | CR-R9C6-01 is REFUTED: the 6 settings flow in by another route the reviewer missed | Low (initially) | Contradicted by evidence | `ImageProcessingJob` type carries none of the 6; no alternate path exists |

---

### Evidence For

**Hypothesis 1 and 2 (confirmed asymmetry):**

- `image-queue.ts:306-317` — after copying `job.quality` and `job.imageSizes` into locals,
  all six settings are initialised to their zero/false/undefined values:
  ```
  let autoAltTextEnabled = false;          // line 308
  let forceSrgbDerivatives = false;        // line 309
  let wideGamutJpegChroma: ... | undefined; // line 313
  let avifEffort: number | undefined;       // line 314
  let sdrJpegChroma: ... | undefined;       // line 316
  let wideGamutMaxSourcePixels: ... | undefined; // line 317
  ```

- `image-queue.ts:318` — the block that resolves all six from `getGalleryConfig()` is:
  ```
  if (!quality && !imageSizes) {
  ```
  All six assignments (`lines 327-332`) are inside this block and NOWHERE else.

- `actions/images.ts:448-453` (upload path, Phase 4 of `uploadImages`) — the call is:
  ```typescript
  enqueueImageProcessing({
      ...
      quality: {
          webp: uploadConfig.imageQualityWebp,   // line 449
          avif: uploadConfig.imageQualityAvif,   // line 450
          jpeg: uploadConfig.imageQualityJpeg,   // line 451
      },
      imageSizes: uploadConfig.imageSizes.length > 0 ? uploadConfig.imageSizes : undefined,  // line 453
      ...
  });
  ```
  `uploadConfig` is the fully-resolved `GalleryConfig` fetched at `images.ts:176`.
  `quality` is always a non-null object (three numeric fields). `imageSizes` is
  `undefined` only when `uploadConfig.imageSizes.length === 0`, but
  `gallery-config-shared.ts:95` shows the default is
  `'640,1536,2048,4096,5120,7680'` — six values — so `imageSizes` is a populated array
  on every normal upload.

  Even if an admin clears `image_sizes` to empty, `quality` remains a non-null object,
  so `!quality` is `false` and the gate is still not entered. The gate requires BOTH
  `quality` and `imageSizes` to be falsy simultaneously. That cannot happen from the
  upload path because `quality` is always a plain object.

- `ImageProcessingJob` type (`image-queue.ts:113-136`) — carries only `quality?` and
  `imageSizes?`. None of the six settings appear as fields. There is no alternative
  channel.

- `process-image.ts:1004,1055,1056,1059` — confirmed fallbacks when the six are `undefined`:
  ```
  const WIDE_GAMUT_MAX_SOURCE_PIXELS = wideGamutMaxSourcePixels ?? 50_000_000;  // line 1004
  const effectiveChroma = wideGamutJpegChroma ?? '4:4:4';                       // line 1055
  const effectiveEffort = avifEffort ?? 6;                                       // line 1056
  const effectiveSdrChroma = sdrJpegChroma ?? '4:2:0';                          // line 1059
  ```
  And `forceSrgbDerivatives` defaults to `false` (line 309 of image-queue.ts, passed
  through as the `undefined`-coerced-to-false parameter at process-image.ts:994):
  ```
  const targetIcc = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb';
  ```

- Comparing fallbacks to `gallery-config-shared.ts` DEFAULTS:
  | Setting | process-image.ts fallback | gallery-config-shared.ts default |
  |---|---|---|
  | `forceSrgbDerivatives` | `false` | `'false'` → `false` |
  | `wideGamutJpegChroma` | `'4:4:4'` | `'4:4:4'` |
  | `avifEffort` | `6` | `'6'` → `6` |
  | `sdrJpegChroma` | `'4:2:0'` | `'4:2:0'` |
  | `wideGamutMaxSourcePixels` | `50_000_000` | `'50000000'` → `50000000` |
  | `autoAltTextEnabled` | `false` | `'false'` → `false` |

  **All six fallbacks exactly match the schema defaults.** This means on a factory-default
  installation, upload and backfill produce identical output. The asymmetry only surfaces
  when an admin changes any of these six settings away from their defaults.

- `admin-backfill-runner.ts:508-513,652-656` — the backfill runner DOES load and pass
  all six settings, confirming the asymmetry is real: a backfill after a settings change
  gets the admin's values; a fresh upload under the same settings does not.

---

### Evidence Against / Gaps

**Hypothesis 3 (refuted):**

- `ImageProcessingJob` type (`image-queue.ts:113-136`) has no fields for any of the
  six settings. No alternate injection path exists.
- The upload call site (`images.ts:440-458`) passes exactly 10 fields; none of the six
  settings appear.
- `getGalleryConfig()` is not called inside `processImageFormats` — it reads only what
  is passed in as parameters.

**Hypothesis 1 — severity qualifier:**

- When all six settings are at their defaults (the only scenario in a fresh install or an
  install where no admin has touched these settings), the fallback values in
  `process-image.ts` are numerically identical to the defaults. So the bug is latent and
  produces no observable damage until an admin deviates from defaults.
- The admin-visible settings most likely to be changed are `avif_effort` (performance
  tuning) and `force_srgb_derivatives` (gamut delivery). Changing `force_srgb_derivatives`
  to `true` is the highest-impact case: fresh uploads would still deliver P3-tagged
  derivatives while the admin expects sRGB-only — a direct violation of photographer-intent.

---

### Rebuttal Round

**Best challenge to the current leader (H1/H2):**

Could `imageSizes` ever be `undefined` on the upload path, causing `(!quality && !imageSizes)`
to be re-evaluated with only `quality` as the gate? No: even if `imageSizes` is `undefined`
(admin cleared `image_sizes`), `quality` is always a non-null object `{webp, avif, jpeg}`.
The JS expression `!quality` on a non-null object is `false`, so the gate is still not entered.
The gate is `&&`, requiring both falsy simultaneously. That cannot happen from `uploadImages`.

**Why the leader still stands:**

The gate logic is unambiguous. The upload path always provides `quality`. The six settings
are only resolved inside the gate. The `ImageProcessingJob` type carries no field for any
of them. The conclusion stands.

---

### Convergence / Separation Notes

H1 and H2 are the same root cause at different severity levels. H2 (observable damage) is
a strict subset of H1 that only activates when an admin changes one of the six settings.
H3 is definitively ruled out by the type definition and call-site evidence.

---

### Current Best Explanation

**CR-R9C6-01 is CONFIRMED as a latent defect.**

The upload path (`actions/images.ts:440-458`) always supplies `quality` (a non-null object)
and usually supplies `imageSizes` (a non-empty array). The gate at `image-queue.ts:318`
(`if (!quality && !imageSizes)`) is therefore never entered for any upload job, so six
admin-configurable settings are never read from the DB on the upload path. They fall back
to hardcoded defaults in `process-image.ts` that happen to match the schema defaults
exactly. The defect is latent: with all settings at defaults the output is correct. The
defect becomes observable the moment an admin changes any of the six away from their
defaults — freshly uploaded photos then get the old (default) encoding while backfilled
photos get the admin's intended encoding. The highest-impact case is `force_srgb_derivatives`
set to `true`: fresh uploads continue to produce P3-tagged WebP/JPEG despite the admin
explicitly requesting sRGB-only delivery.

This is an explicit design gap, not a runtime race: the upload path was designed to
snapshot `quality` and `imageSizes` at enqueue time (so a settings change mid-queue does
not straddle in-flight uploads), but the snapshot was never extended to cover the other
six settings when they were added.

---

### Critical Unknown

Whether any production admin has changed any of the six settings away from their defaults
(if yes, the defect is already producing wrong-encoded uploads silently; if no, it is
purely latent).

---

### Discriminating Probe

Check the `admin_settings` DB table for any row where `key` is one of
`force_srgb_derivatives`, `wide_gamut_jpeg_chroma`, `avif_effort`, `sdr_jpeg_chroma`,
`wide_gamut_max_source_pixels`, `auto_alt_text_enabled` and the `value` differs from its
schema default. If any such row exists, the defect has been silently active.

---

### Uncertainty Notes

None material. The code path is deterministic and fully traced. The only open question is
whether the latent defect has already been triggered in a specific deployment — that is an
operational question, not a code question.

---

## Clean-Check Results (3 additional flows)

### (a) Settings-hash ETag two-tier invalidation — CLEAN

- `settings-hash.ts:42` defines `COLOR_IMPACTING_KEYS` covering all nine
  byte-impacting settings: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`,
  `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`,
  `image_quality_avif`, `image_quality_jpeg`, `image_sizes`.
- Compile-time guard `_ColorKeysAreSettingKeys` at `settings-hash.ts:63-65` ensures every
  key in the list is a valid `GallerySettingKey` at `tsc` time.
- `serve-upload.ts:214-215` builds the ETag as
  `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` using
  `getServingColorSettingsHash()` which delegates to `getColorSettingsHash()`.
- The two-tier logic (static path uses mtime+size ETag; serve-upload path uses the
  settings-hash ETag; static path invalidates only after backfill rewrites files) is
  documented and matches the code. No gap found.

Flow: CLEAN.

### (b) Restore quiesce pause→clear→onIdle + lock release — CLEAN

- `db-actions.ts:310` calls `beginRestoreMaintenance()` (causes `enqueueImageProcessing`
  to reject new jobs).
- `db-actions.ts:334` calls `quiesceImageProcessingQueueForRestore()`.
- `image-queue.ts:757-759`: sequence is `queue.pause()` → `queue.clear()` →
  `await queue.onIdle()`. The clear-before-onIdle ordering (COR-R4C12-01) is correct:
  a paused queue never starts queued tasks so `onIdle()` after `pause()` without `clear()`
  would deadlock with >1 queued job.
- `image-queue.ts:760-767`: after `onIdle()`, all in-memory state sets/maps are cleared
  and `bootstrapped` is reset so the post-restore bootstrap re-discovers unprocessed rows.
- Lock release: advisory lock `gallerykit_db_restore` is released in the `finally` block
  at `db-actions.ts:349` via `SELECT RELEASE_LOCK(?)`. The early-return path at
  `db-actions.ts:323` also explicitly releases (C7R-RPL-02 fix). Both paths null and
  release `uploadContractLock` as well.

Flow: CLEAN.

### (c) C5 restore-scanner fix — own-backup DROP TABLE passes — CLEAN

- `sql-restore-scan.ts:12-31` defines `APP_BACKUP_TABLES` as a const array of all 18
  application tables.
- `sql-restore-scan.ts:34-37` compiles `ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` — a regex
  matching exactly `DROP TABLE IF EXISTS \`<known-table>\`;` for each entry.
- `stripSqlCommentsAndLiterals()` at line 121 MASKS (replaces with spaces) all matching
  own-backup DROP TABLE lines BEFORE applying `DANGEROUS_SQL_PATTERNS`.
- `DANGEROUS_SQL_PATTERNS` at line 55 still contains `\bDROP\s+TABLE\b` — but it runs
  on the already-masked string, so own-backup drops are invisible to it.
- The superset invariant is locked by `__tests__/sql-restore-scan.test.ts` (a tripwire
  that introspects the Drizzle schema), so a future table added to `schema.ts` without
  updating `APP_BACKUP_TABLES` fails the test.

Flow: CLEAN.

---

## Summary

**CR-R9C6-01: CONFIRMED DEFECT** — decisive line: `image-queue.ts:318`
`if (!quality && !imageSizes)`. The upload path always provides `quality` (a non-null
object), so this gate is never entered on upload and six admin-configurable settings
(`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`,
`wideGamutMaxSourcePixels`, `autoAltTextEnabled`) are silently ignored for every fresh
upload. Fallback values happen to match schema defaults, so damage is latent until an
admin deviates from defaults. Highest-impact deviation: `force_srgb_derivatives=true`
causes fresh uploads to deliver P3-tagged derivatives contrary to the admin's intent.

**3 flows CLEAN** — settings-hash ETag two-tier invalidation, restore
quiesce/lock-release, and c5 restore-scanner own-backup DROP TABLE pass.

New defect ID: **CR-R9C6-01** (CONFIRMED, latent-until-settings-changed, severity HIGH
when triggered).
