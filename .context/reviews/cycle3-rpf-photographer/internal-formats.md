# Cycle 3 RPF — Internal Formats Review

**Date:** 2026-05-08
**Reviewer perspective:** professional photographer + end-user-workflow.
**Scope:** AVIF / WebP / JPEG bit-depth, ICC embedding, compression, encoder paths.
**Predecessor reviews:** `.context/reviews/photographer-r3/internal-formats.md`, `.context/reviews/cycle2-rpf-photographer/internal-formats.md`.

---

## State of the codebase entering cycle 3

Internal-formats surface is now well-managed:

- AVIF: 10-bit on wide-gamut sources (lazy Promise-based singleton probe in `process-image.ts:53-78`); falls back to 8-bit on probe failure. P3-tagged when source is wide-gamut, sRGB-tagged otherwise. Effort: admin-tunable (`avif_effort`, default 6). Per-encode bitdepth retry on bitdepth-specific failure.
- WebP: 8-bit. P3-tagged when source is wide-gamut and `force_srgb_derivatives=false` (default). Otherwise sRGB.
- JPEG: 8-bit. Wide-gamut: 4:4:4 chroma (admin-tunable `wide_gamut_jpeg_chroma`). SDR: 4:2:0 chroma (admin-tunable `sdr_jpeg_chroma`, cycle-2 C2-A5). P3-tagged or sRGB-tagged following the same rule.
- rgb16 pipeline for wide-gamut, non-DCI-P3 sources (16-bit linear-light resize). DCI-P3 skips rgb16 to preserve source ICC for the Bradford toColorspace('p3') transform.
- 50 MP wide-gamut downscale (`wide_gamut_max_source_pixels`, admin-tunable, cycle-2 C2-A6) before fan-out.

All 10-bit encode paths have shipped. The sRGB JPEG chroma is now tunable. The 50 MP cap is now tunable. Pipeline version 6 is documented in the version-history docstring.

---

## Findings (cycle 3)

### MED (1)

#### C3-INT-MED-1 — `effectiveChroma` cast to `'4:4:4' | '4:2:2' | '4:2:0'` only validates value at write time, not at read time

**File:** `apps/web/src/lib/process-image.ts:854-856`.
**Severity:** MED.
**Confidence:** HIGH.

The chroma value flows: admin UI → `gallery_config` table (validated at write per `VALIDATORS.wide_gamut_jpeg_chroma` / `VALIDATORS.sdr_jpeg_chroma` at `gallery-config-shared.ts:159-164`) → `getGalleryConfig()` (returns `string`) → `processImageFormats(..., wideGamutJpegChroma?: string, ..., sdrJpegChroma?: string)` → `effectiveChroma = wideGamutJpegChroma ?? '4:4:4'` → `as '4:4:4' | '4:2:2' | '4:2:0'`.

The runtime cast at line 854 is a TypeScript escape hatch. If a future contributor either (a) changes the validator to accept `'4:1:1'` without changing the type, or (b) skips validation when reading from the DB (e.g. in the test path or a migration), Sharp's `chromaSubsampling` will receive a malformed value and throw at encode time. The whole upload pipeline goes red for that gallery until the bad config is fixed.

**Fix shape:** type the value as `'4:4:4' | '4:2:2' | '4:2:0' | undefined` end-to-end. Have `getGalleryConfig()` validate-on-read and fall back to `DEFAULTS` if the DB has a stale invalid value. The validator function already enforces it; just expose the narrower type.

```ts
// gallery-config.ts
export interface GalleryConfig {
    wideGamutJpegChroma: '4:4:4' | '4:2:2' | '4:2:0';
    sdrJpegChroma: '4:4:4' | '4:2:2' | '4:2:0';
    // ...
}

// process-image.ts
async function processImageFormats(
    // ...
    wideGamutJpegChroma?: '4:4:4' | '4:2:2' | '4:2:0',
    avifEffort?: number,
    sdrJpegChroma?: '4:4:4' | '4:2:2' | '4:2:0',
    // ...
)
```

Eliminates the runtime cast.

**Photographer impact:** none directly. Defense in depth against config / migration drift.

**Tests:** lock via type-checker. Existing `gallery-config-shared.test.ts` covers validator behavior; add a runtime test that the type is narrower after `getGalleryConfig`.

---

### LOW (3)

#### C3-INT-LOW-1 — `validatedNumber(map, 'wide_gamut_max_source_pixels')` clamps silently on out-of-range

**File:** `apps/web/src/lib/gallery-config.ts:163` (assumes `validatedNumber` semantics).
**Severity:** LOW.
**Confidence:** MEDIUM.

The validator at `gallery-config-shared.ts:164` accepts numbers in `[10_000_000, 200_000_000]`. If the DB has a stale value outside that range, the read path falls back to `Number(DEFAULTS.wide_gamut_max_source_pixels) = 50_000_000`. Silent clamp; no admin observable signal that "your value of 5_000_000 was rejected."

**Fix shape:** log a warning when `getGalleryConfig` falls back due to invalid value. Surface in the admin settings page as "current effective value: 50_000_000 (DB stored: 5_000_000, falling back due to range violation)."

**Photographer impact:** none typically — the admin set the value through the UI (which also validates). The fallback fires only if (a) the validator was changed but the DB wasn't migrated, or (b) someone modified the DB directly.

#### C3-INT-LOW-2 — `_highBitdepthAvifProbePromise` is module-scoped; never re-evaluated after worker reload

**File:** `apps/web/src/lib/process-image.ts:48-78`.
**Severity:** LOW.
**Confidence:** MEDIUM.

Carry-forward from cycle 2 `C2-INT-LOW-2`. The probe runs once per process. If the Sharp build changes mid-runtime (rare; would require a rolling deploy with a different Docker image), the probe state is stale. The per-encode retry (lines 820-835) catches the failure mode — falls back to 8-bit for that image. CPU waste only.

**Fix shape:** on encode failure, also reset `_highBitdepthAvifProbePromise = null` so subsequent encodes don't waste CPU trying 10-bit again. Bounded mitigation.

**Photographer impact:** trivial. Bounded by encode throughput.

#### C3-INT-LOW-3 — `.wi15.tmp` cleanup race window if SIGKILL mid-upload

**File:** `apps/web/src/lib/process-image.ts:702-720, 917-921`.
**Severity:** LOW.
**Confidence:** HIGH.

Carry-forward from cycle 2 `C2-INT-LOW-1`. The intermediate `.wi15.tmp` file is unlinked in the `finally` block of `processImageFormats`. SIGKILL between `toFile(tmpPath)` (line 716) and the `finally` block leaves the tmp file on disk. Bounded leak rate (one orphan per killed upload of a wide-gamut > 50 MP source — rare).

**Fix shape:** add a startup sweeper that scans `UPLOAD_DIR_ORIGINAL` for `*.wi15.tmp` files older than (e.g.) 1 hour and unlinks them. Single fix; runs at process boot.

**Photographer impact:** none directly. Disk hygiene.

---

### Photographer-axis re-confirmation

| Question | Answer |
|---|---|
| Is wide-gamut AVIF emitted at 10-bit? | YES (lazy probe; per-encode retry; falls back to 8-bit on probe or encode failure). |
| Is the AVIF effort tunable? | YES (`avif_effort` admin setting, default 6, range 4-9). |
| Is the wide-gamut JPEG chroma tunable? | YES (`wide_gamut_jpeg_chroma`, default 4:4:4). |
| Is the SDR JPEG chroma tunable? | YES (`sdr_jpeg_chroma`, default 4:2:0; cycle-2 C2-A5). |
| Is the 50 MP cap tunable? | YES (`wide_gamut_max_source_pixels`, default 50_000_000; cycle-2 C2-A6). |
| Is rgb16 pipeline used for wide-gamut sources? | YES (skipped only for DCI-P3 to preserve source ICC for Bradford). |
| Do parallel encodes share `image` Sharp instance state? | NO (cycle-2 WI-14 hardened; rgb16 path uses fresh `sharp(processingInputPath, ...)` per format). |
| Does the encoder respect the photographer's source ICC for AVIF tagging? | YES (`resolveAvifIccProfile` allowlist; strict P3 only). |

**Net:** internal-formats surface is well-tuned. The 4 cycle-3 findings are end-to-end type narrowing and disk-hygiene polish.

---

## Convergent findings (this round)

None.

---

## Provenance

Cycle-3 RPF internal formats angle. Single-orchestrator focused pass.
