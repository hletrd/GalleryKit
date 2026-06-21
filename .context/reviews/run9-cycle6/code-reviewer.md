# Code Reviewer — run-9 cycle-6

**HEAD:** `ba3277da` (docs commit; last real source change `d1cde2e4`, the c5 restore-scanner fix)
**Verdict:** REQUEST CHANGES — **1 DEFECT found** (`CR-R9C6-01`)
**Typecheck:** PASS (`typecheck:app` + `typecheck:scripts`, exit 0)

> This agent is read-only (Write/Edit blocked); the lead persisted this review from the agent's returned text.

## Summary
Reviewed ~40 files across `lib/`, `app/actions/`, `app/api/`, `components/`, `db/`, `scripts/`, with special focus on the largest change since run-8 (the Stripe/paid-download removal) and the c5 restore-scanner fix. **1 DEFECT, 2 LOW non-defect observations.**

## [DEFECT] CR-R9C6-01 — Fresh uploads silently bypass 6 admin-configurable processing settings

**Type:** DEFECT — broken-gate / false-behavior + false-doc. **Confidence:** Medium (wiring is proven; "Medium" only because the impact is invisible under default configs).

**Files:** `image-queue.ts:318` (gating `if (!quality && !imageSizes)`, settings resolved at lines 326–334); `actions/images.ts:445–458` (upload enqueue always supplies `quality`+`imageSizes`); `image-queue.ts:113–136` (`ImageProcessingJob` type carries none of these fields). Correct contrast callers: `admin-backfill-runner.ts:508–512` (loads all 5 unconditionally) and `image-queue.ts:654` (bootstrap omits quality/imageSizes, so the block runs).

**Root cause (proven from code on all three legs):** The job handler resolves SIX settings — `autoAltTextEnabled`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels` — ONLY inside `if (!quality && !imageSizes)` (`image-queue.ts:318`). The **upload path** enqueues with `quality` (lines 448–452) AND `imageSizes` (line 453) set → the block is never entered → `forceSrgbDerivatives` stays hardcoded `false` (line 309), the four chroma/effort/pixel settings stay `undefined`, `autoAltTextEnabled` stays `false` (line 308). `process-image.ts` does NOT read config internally (verified) so it falls back to defaults: `targetIcc = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3':'srgb'` → always `p3` for wide-gamut (line 994); `?? '4:4:4'` (1055), `?? 6` (1056), `?? '4:2:0'` (1059), `?? 50_000_000` (1004). Bootstrap and backfill both honor the settings → **asymmetry**: a fresh upload vs. the same photo after backfill get different color treatment when any setting is non-default. All six are admin-exposed in `settings-client.tsx`.

**Concrete failures:**
1. `force_srgb_derivatives=true` → a newly uploaded Display-P3 photo gets **P3-tagged** WebP/JPEG anyway, contradicting the gate (until a backfill runs).
2. `wide_gamut_max_source_pixels` lowered to 20 M → upload **warns** at >20 MP (`images.ts:302` uses the config value) but the encoder uses 50 M and does **not** downscale → host can OOM on the rgb16 pipeline — the exact failure the setting prevents. This also falsifies the AGG-M1 comment at `images.ts:299` ("matches the encoder's actual downscale threshold").
3. `avif_effort` / `sdr_jpeg_chroma` / `wide_gamut_jpeg_chroma` tuned → fresh uploads use process-image defaults, diverging from backfilled photos.
4. `auto_alt_text_enabled=true` → `generateCaption(..., false)` on every fresh upload (`image-queue.ts:397`).

**Why it survived 9 runs:** under defaults the skipped values equal process-image's defaults (byte-identical output). The only tests touching these settings call the pure resolver or the backfill runner directly. No test exercises `uploadImages → enqueueImageProcessing → handler → processImageFormats`, so the gap is uncovered. Blame: the gate predates the color settings (quality/sizes-only); the color settings were added INSIDE it without accounting for the upload path supplying quality+imageSizes.

**Fix (recommended, option A — snapshot semantics):** add the 6 fields to `ImageProcessingJob`, populate from the already-fetched `uploadConfig` at the upload enqueue, and read `job.*` with a config fallback (preserves the design's upload-time snapshot intent and the bootstrap config-load). Add a wiring test asserting forwarding to `processImageFormats`.

## Verified correct
- **c5 restore-scanner (CR-R9C5-01): SOUND** — `APP_BACKUP_TABLES` (18) matches the 18 schema `mysqlTable` defs 1:1.
- **Paid/Stripe removal: clean & atomic** — no dangling `license_tier`/`licenseTier`/`LICENSE_TIERS` in non-test source.
- **All actions + 8 API routes: ZERO defects** — auth + same-origin + rate-limit + integer-id validation + transaction atomicity + last-admin-delete guard all sound.
- `serve-upload.ts`, `settings-hash.ts`, `data.ts`, `auth-rate-limit/rate-limit/bounded-map`, `use-display-capability.ts`, `blur-data-url.ts`, `og-sanitize.ts`, `view-retention.ts`, `proxy.ts` — re-confirmed correct.

## Non-defects (informational, NOT findings)
1. `images.ts:1109` `retryFailedImage` returns hardcoded English on a localized admin surface (i18n polish; auth/validation correct).
2. `admin-users.ts:120–122` over-limit in-memory branch returns before the DB increment (opposite of `public.ts` ordering; non-exploitable, admin-only 10/hr).

## Refuted (NOT a finding)
- `admin-backfill-runner.ts:573,605` `affectedRows` optional-chaining — pre-adjudicated/REFUTED. No new evidence.

**Verdict: 1 DEFECT found — CR-R9C6-01.**
