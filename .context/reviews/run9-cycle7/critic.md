# Critic — Run-9 Cycle-7 deep review (HEAD feb63faa)

Role: meta-skepticism. (1) Spot-check highest-entropy CLAUDE.md claims vs code; (2) independently probe SPECIAL FOCUS #3 (LR publish route 6-settings forwarding); (3) re-confirm prior disproofs (MED-R7C2-01, REJ-R7C3-01) still sound; (4) assess whether convergence is genuine.

Mode: THOROUGH throughout. No escalation to ADVERSARIAL — the single confirmed DEFECT is isolated (a known-class regression on a sibling path), not a systemic pattern, and the doc/claim sweep returned zero false claims.

---

## VERDICT: REVISE — one real DEFECT confirmed (LR publish path), convergence NOT genuine this cycle

**Overall assessment.** The lead's preliminary finding on SPECIAL FOCUS #3 is **CONFIRMED** with high confidence and exact file:line. The Lightroom publish-plugin upload route forwards `quality` + `imageSizes` but NOT the 6 processing settings that CR-R9C6-01 added for the browser path, and because the queue handler's config-load fallback gate is `if (!quality && !imageSizes)`, those 6 settings are silently dropped on every Lightroom publish — the exact defect CR-R9C6-01 fixed, surviving on the twin ingest path. All highest-entropy doc claims verified TRUE (zero false doc-claims). Both prior disproofs re-confirmed sound at HEAD. **NEW_FINDINGS: 1 DEFECT.**

---

## (2) SPECIAL FOCUS #3 — LR publish route 6-settings forwarding — INDEPENDENT VERDICT: CONFIRMED DEFECT

### CR-R9C7-CRITIC-01 — Lightroom publish route drops 6 admin processing settings (DEFECT, confidence HIGH)

**Evidence chain (independently traced, not relying on lead):**

1. **Browser path forwards all 6** — `apps/web/src/app/actions/images.ts:461-466`:
   ```
   forceSrgbDerivatives: uploadConfig.forceSrgbDerivatives,
   wideGamutJpegChroma: uploadConfig.wideGamutJpegChroma,
   avifEffort: uploadConfig.avifEffort,
   sdrJpegChroma: uploadConfig.sdrJpegChroma,
   wideGamutMaxSourcePixels: uploadConfig.wideGamutMaxSourcePixels,
   autoAltTextEnabled: uploadConfig.autoAltTextEnabled,
   ```

2. **LR route forwards NONE of the 6** — `apps/web/src/app/api/admin/lr/upload/route.ts:420-444`. The `enqueueImageProcessing({...})` object supplies `id`, filenames, `width`, `topic`, `quality` (`:428-432`), `imageSizes` (`:433`), `camera_model`, `capture_date`, `iccProfileName`, `colorSignals` — and **stops there**. No `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, or `autoAltTextEnabled`.

3. **The gate that makes this silent** — `apps/web/src/lib/image-queue.ts:336` `if (!quality && !imageSizes)`. The config-load fallback (`:339-355`) — which would otherwise load all 6 from current config — ONLY runs when BOTH `quality` and `imageSizes` are absent. The LR route supplies BOTH (`:428-433`), so the gate is NOT entered. The handler then takes the 6 from the job fields, which for LR jobs are all `undefined`/absent:
   - `autoAltTextEnabled = job.autoAltTextEnabled ?? false` (`:326`) → **false**
   - `forceSrgbDerivatives = job.forceSrgbDerivatives ?? false` (`:327`) → **false**
   - `wideGamutJpegChroma = job.wideGamutJpegChroma` (`:331`) → **undefined**
   - `avifEffort = job.avifEffort` (`:332`) → **undefined**
   - `sdrJpegChroma = job.sdrJpegChroma` (`:334`) → **undefined**
   - `wideGamutMaxSourcePixels = job.wideGamutMaxSourcePixels` (`:335`) → **undefined**

4. **What the encoder then uses** — `processImageFormats` (`apps/web/src/lib/process-image.ts:958`) falls to its hardcoded defaults for every `undefined`:
   - `forceSrgbDerivatives` → `false` (line 994 `!forceSrgbDerivatives`)
   - `wideGamutMaxSourcePixels` → `50_000_000` (line 1004 `?? 50_000_000`)
   - `wideGamutJpegChroma` → `'4:4:4'` (line 1055 `?? '4:4:4'`)
   - `avifEffort` → `6` (line 1056 `?? 6`)
   - `sdrJpegChroma` → `'4:2:0'` (line 1059 `?? '4:2:0'`)

**This is structurally identical to the pre-CR-R9C6-01 browser bug.** The browser path was fixed in commit `2078e43f`; the LR publish path — described in CLAUDE.md as "the primary non-browser ingest path" — was never touched.

**Failure scenario (concrete, realist-checked).** An admin sets `force_srgb_derivatives=true` (e.g. to standardize on sRGB WebP/JPEG for a client deliverable, or to work around a wide-gamut rendering complaint), or lowers `avif_effort` to 4 to speed encodes / raises it to 9, or changes `wide_gamut_jpeg_chroma` to `4:2:0` to shrink files, or lowers `wide_gamut_max_source_pixels` to protect a memory-constrained host. They then publish photos from Lightroom Classic via the publish plugin (the documented, supported PAT ingest path). **Every Lightroom-published photo silently ignores all of those settings** and is encoded at the process-image defaults (effort 6, 4:4:4 wide-gamut JPEG, 4:2:0 SDR JPEG, 50 MP cap, sRGB-forcing OFF). The admin has no signal this happened — the publish succeeds (HTTP 201), the Color Details audit shows correct color metadata (color signals ARE forwarded), and only the encoded BYTES differ from what the settings dictate.

The `autoAltTextEnabled` drop is the lower-impact arm: LR-published images get `autoAltTextEnabled=false` regardless of the admin toggle, so the auto-caption stub never runs for them even when an admin enabled it globally. (Caption is a fire-and-forget post-process, so this is a feature-gap, not data corruption.)

**Severity calibration (Realist Check).** This is correctly a **DEFECT, not CRITICAL**:
- Realistic worst case: derivatives encoded with wrong (default) chroma/effort/sRGB-forcing. No data loss — the ORIGINAL is preserved, and a `--force-reencode` backfill (which DOES honor all settings, see below) fully repairs every affected image. Recovery is documented and idempotent.
- Detection: silent (no error, byte-level only) — this RAISES concern, but is bounded because (a) the original is intact and (b) backfill repairs it.
- Mitigating factor: only affects installs that BOTH (a) changed a non-default value for one of the 6 AND (b) ingest via the Lightroom plugin. The shipped defaults already match process-image defaults, so a default-config install is unaffected.
- It is a real product-runtime correctness bug on a documented supported path, with a trivial fix and the data fully available at the call site — squarely inside the HIGH-BAR "genuine correctness defect" gate. Not POLISH.

**Fix (exact, fully specified — data already in scope).** The LR route already loads `const config = await getGalleryConfig()` at `route.ts:170`, and `getGalleryConfig()` returns all 6 fields with the same names the browser path uses (`apps/web/src/lib/gallery-config.ts:62/72/81/84/87/90`). Add 6 lines to the `enqueueImageProcessing` object at `route.ts:420`, mirroring `images.ts:461-466`:
```ts
forceSrgbDerivatives: config.forceSrgbDerivatives,
wideGamutJpegChroma: config.wideGamutJpegChroma,
avifEffort: config.avifEffort,
sdrJpegChroma: config.sdrJpegChroma,
wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
autoAltTextEnabled: config.autoAltTextEnabled,
```
(Use `config.*` — the LR route names its config object `config`, not `uploadConfig`.)

**Test gap that let this survive (recommend closing alongside the fix).** `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:301-308` already inspects the LR enqueue block but asserts ONLY `camera_model` and `capture_date` are forwarded. The CR-R9C6-01 fix added a settings-wiring test for the BROWSER path (`image-queue-settings-wiring.test.ts`) but no equivalent for the LR enqueue. No test in `src/__tests__/` asserts the LR route forwards the 6 settings (verified by grep). Extend the existing source-contract test at `:301-308` to also assert the 6 settings appear in the enqueue block — same fixture style already in use there.

---

## (1) Highest-entropy doc-claim spot-checks — ALL TRUE (zero false doc-claims)

Every high-entropy claim independently verified against code at HEAD feb63faa:

| Claim (CLAUDE.md) | Code evidence | Verdict |
|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` `export const IMAGE_PIPELINE_VERSION = 7;` | TRUE |
| `HASH_LENGTH = 8` | `settings-hash.ts:68` `const HASH_LENGTH = 8;` + `:81` `.slice(0, HASH_LENGTH)` (no extra `.slice(0,8)` at ETag site) | TRUE |
| `COLOR_IMPACTING_KEYS` = 9 keys | `settings-hash.ts:42-54`: wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels, image_quality_webp, image_quality_avif, image_quality_jpeg, image_sizes — exactly 9 | TRUE |
| `VIEW_RETENTION_DAYS` default 395 | `view-retention.ts:29` `DEFAULT_VIEW_RETENTION_MS = 395 * 24*60*60*1000`; `:43` `parseInt(process.env.VIEW_RETENTION_DAYS ?? '', 10)` | TRUE |
| 6 advisory locks | All 6 names present in src: gallerykit_db_restore, _upload_processing_contract, _topic_route_segments, _admin_delete, _color_pipeline_backfill, gallerykit:image-processing:{jobId} | TRUE |
| `cache()` = 10 wrapped functions | `data.ts`: 9 `...Cached` exports (`getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`) + `getSeoSettings` = 10 | TRUE |
| Backfill cap = 2 @ pool 10 | `admin-backfill-runner.ts:105-106` RESERVED=max(3,ceil(10/2))=5; `:139` cap=max(1,floor((10−5−1)/2))=floor(4/2)=**2**; `db/index.ts:23` POOL_CONNECTION_LIMIT=10 | TRUE |
| NCLX primaries 1/9/11/12 | `color-detection.ts:170-175`: 1=bt709, 9=bt2020, 11=dci-p3, 12=p3-d65 | TRUE |
| NCLX transfer 4/5/14/15/16/17/18 | `:185-211`: 4=gamma22, 5=gamma28 (BT.470BG, AGG-R7C2-01), 13=srgb, 14/15=gamma24, 16=pq, 17=gamma26, 18=hlg | TRUE |
| NCLX matrix 0/1/8/9/10 | `:215-219`: 0=identity, 1=bt709, **8=ycgco** (NOT bt2020-ncl — AGG-R7C1-01 correction), 9=bt2020-ncl, 10=bt2020-cl | TRUE |
| nginx caps 2M/64K/250M/216M/216M | `nginx/default.conf:31` 2M default, `:58` 64K login, `:75` 250M /admin/db, `:92` 216M dashboard, `:131-132` dedicated `^~ /api/admin/lr/upload` 216M winning over `:148-149` generic `^~ /api/admin/` 2M | TRUE |
| admin-tunable defaults | `gallery-config-shared.ts:92-124`: webp 90, avif 85, jpeg 90, force_srgb false, allow_hdr false, force_show false, wg_jpeg_chroma 4:4:4, avif_effort 6, sdr_chroma 4:2:0, wg_max_px 50000000 | TRUE |

**No false doc-claim found.** The CLAUDE.md is exceptionally well-maintained; the recent AGG-R7C1-01 (matrix code 8 → YCgCo) and AGG-R7C2-01 (transfer code 5 → gamma28) corrections are both reflected in code AND doc consistently.

---

## (3) Prior disproofs re-confirmed sound at HEAD (NOT re-opened — soundness confirmation only)

**MED-R7C2-01 (histogram clip-% denominator) — STAYS REFUTED.** Re-inspected `public/histogram-worker.js:24-37`: the per-pixel loop increments `r[rv]++; g[gv]++; b[bv]++;` exactly once per channel per pixel, so `sum(r)=sum(g)=sum(b)=N` (pixel count) identically for all three channels. Dividing each channel's clip-bin count by its own channel total (= N) is the mathematically correct per-channel worst-case fraction. The historically-proposed `3N` denominator would 3× under-report and mask real clipping. Soundness confirmed.

**REJ-R7C3-01 (gps-exif iloc `indexSize` unvalidated) — STAYS DISPROVED.** Re-inspected `gps-exif-strip.ts:512-519`: `indexSize` is NEVER passed to `readSized`. It is used only as (a) an addend in `extentEntrySize = indexSize + offsetSize + lengthSize` (`:513`) which is bounds-checked against `ilocBox.dataEnd` at `:514` BEFORE any read, and (b) a `pos += indexSize` skip (`:515`). The actual byte reads use the already-validated `offsetSize`/`lengthSize` via `readSized`, which returns `null` on overflow. A malformed `indexSize` either trips the `:514` bounds check (safe null) or misaligns `pos` so a downstream `readSized` returns null. No OOB read / GPS leak possible. Soundness confirmed.

Neither was re-filed.

---

## (4) Convergence assessment — NOT genuine this cycle

Convergence is **NOT** reached: there is one real, unfixed DEFECT (CR-R9C7-CRITIC-01) on a documented supported ingest path.

**Were reviewers missing surfaces?** I independently enumerated ALL enqueue/process entry points to test whether the LR gap is isolated or one of several:
- Browser upload `images.ts:440` — forwards all 6 → CORRECT (CR-R9C6-01)
- **LR PAT upload `route.ts:420` — forwards 0 of 6 → DEFECT** (this finding)
- Bootstrap `image-queue.ts:674` — supplies neither quality nor imageSizes → gate `:336` ENTERS → loads all 6 from config (`:347-352`) → CORRECT
- retryFailedImage `images.ts:1139` — supplies neither quality nor imageSizes → gate enters → CORRECT
- Retry re-enqueues `image-queue.ts:290` & `:510` — re-enqueue the SAME `job` object → consistent with the original enqueue (no independent gap)
- Backfill runner `admin-backfill-runner.ts:499` — direct `processImageFormats` call, forwards `settings.forceSrgbDerivatives/wideGamutJpegChroma/avifEffort/sdrJpegChroma/wideGamutMaxSourcePixels` (`:508-513`) → CORRECT
- Sidecar backfill `scripts/backfill-color-pipeline.ts:203` — direct call, forwards all 5 color settings (`:212-217`) → CORRECT

The LR route is the ONLY surviving instance. The gate design is sound: it is a fallback for jobs carrying NO settings (bootstrap/retry); the bug class is specifically "a path that supplies SOME settings (quality+imageSizes) but not the 6." Only the LR route fits that profile. So the cycle's reviewers (lead) correctly identified the one remaining gap — convergence will be genuine AFTER this fix lands, provided the test gap at `lr-upload-hdr-gate.test.ts:301-308` is also closed so a future LR enqueue edit can't silently re-drop the settings.

---

## What's missing / open questions
- The backfill paths intentionally do NOT forward `autoAltTextEnabled` (re-encode of existing photos, captions already exist) — this is correct by design, NOT a gap. Noted so it isn't mistaken for a 7th-setting omission.
- After the fix, a single contract test asserting "every `enqueueImageProcessing` call site that supplies quality+imageSizes also supplies the 6" would prevent this whole bug class from recurring on a future third ingest path. Recommend (POLISH, not blocking) but the targeted LR test extension is the minimum.

## Multi-perspective notes
- **Executor:** the fix is unambiguous — 6 lines, data already in scope at `route.ts:170`, exact field names confirmed. No questions needed.
- **Stakeholder:** for a multi-photographer studio publishing from Lightroom (the documented primary non-browser path), admin color/encode settings being silently ignored undermines the product's core "deliver the photographer's intent accurately" premise. This is the right thing to fix.
- **Skeptic:** strongest counter-argument — "defaults match shipped defaults, so most installs are unaffected." True, but the demo deployment and any install that tuned even one of the 6 IS affected, the path is documented+supported, and the fix is free. The counter-argument lowers severity (DEFECT not CRITICAL) but does not deferral-qualify it.

## Summary line
NEW_FINDINGS: 1 (CR-R9C7-CRITIC-01, DEFECT, HIGH). FALSE_DOC_CLAIMS: 0. PRIOR_DISPROOFS_RECONFIRMED: 2 (MED-R7C2-01, REJ-R7C3-01). CONVERGENCE: not genuine — LR publish path drops the 6 settings (independently confirms lead).
