# Tracer Report — Run 7 Cycle 3

**HEAD:** c6eff919  
**Date:** 2026-06-19  
**Scope:** Independent re-verification of 6 prior-run flow conclusions + 1 residual.  
**Method:** File:line spot-check of every claimed control point against the actual code in
`/Users/hletrd/flash-shared/gallery/apps/web/src/`.

---

## Trace Report

### Observation

A prior tracer run completed a full 6-flow security/correctness investigation of
GalleryKit HEAD c6eff919 and concluded all flows CLEAN with one residual (RES-R7C2-01).
The run stalled before writing its report. This run independently re-verifies each
conclusion from source, then files the report.

---

### Flow 1 — Upload → process-image → EXIF/color detection → DB write → public vs admin select

**Claimed verdict:** CLEAN

**Evidence gathered:**

- `apps/web/src/lib/data.ts:325–353` — `publicSelectFields` is constructed by destructuring
  `adminSelectFields` and explicitly binding `latitude`, `longitude`, `filename_original`,
  `user_filename`, `original_format`, `original_file_size`, `processed`,
  `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `was_downscaled`,
  `transfer_function`, `matrix_coefficients`, `bit_depth`, `uploaded_by`,
  `processing_error`, `failed_at`, `color_space`, `icc_profile_name`,
  `pipeline_version` into discard variables before spreading the remainder. No PII field
  reaches the public object.

- `apps/web/src/lib/data.ts:416–419` — compile-time guard:
  `type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>;`
  `const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [...'ERROR...'] = true;`
  Any future inadvertent addition of a sensitive field to `publicSelectFields` is a
  TypeScript compile error.

- `apps/web/src/app/actions/images.ts:311–316` — GPS strip on upload:
  when `uploadConfig.stripGpsOnUpload` is true, both `exifDb.latitude` and
  `exifDb.longitude` are nulled before the DB write, AND
  `stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal))` is
  awaited, scrubbing the on-disk original that the paid-download route streams.

**Verdict: CLEAN — confirmed**

---

### Flow 2 — Checkout → Stripe webhook → entitlement → download token → /api/download streaming

**Claimed verdict:** CLEAN (with two known deferred gaps)

**Evidence gathered:**

- `apps/web/src/app/api/stripe/webhook/route.ts:105` —
  `if (session.payment_status !== 'paid')` gate. Async/unpaid sessions are rejected with a
  warning log and a 200 (no-op to Stripe) without minting an entitlement.

- `apps/web/src/app/api/download/[imageId]/route.ts:174–187` — three sequential guards in
  `validateDownloadRequest`:
  1. `if (new Date() > new Date(entitlement.expiresAt))` → 410 "Token expired"
  2. `if (entitlement.refunded)` → 410 "Purchase has been refunded"
  3. `if (entitlement.downloadedAt !== null)` → 410 "Token already used"
  All three must pass before the POST handler proceeds to stream bytes and burn the token.

- Card-only checkout pin, `charge.refunded` handler, and `async_payment_succeeded` gap are
  carried as known deferred items (ARCH-R7C2-01 / plan-316 / C3-RPF-01 / C4-RPF-03). Not
  re-filed as new findings.

**Verdict: CLEAN — confirmed; deferred gaps carried as-is**

---

### Flow 3 — Color signal precedence → encoder decision → ETag/cache → SW cache

**Claimed verdict:** CLEAN

**Evidence gathered:**

- `apps/web/src/lib/settings-hash.ts:41–53` — `COLOR_IMPACTING_KEYS` array contains exactly
  9 entries: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`,
  `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`,
  `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. `HASH_LENGTH = 8`.

- `apps/web/src/lib/serve-upload.ts:214–215` — ETag constructed as
  `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`
  where `settingsHash` comes from `getServingColorSettingsHash()` (which reads the 9 keys
  above). Pipeline version bump or any color/quality/size setting change invalidates the
  ETag on the serve-upload path.

- `apps/web/public/sw.template.js:38,239` — `HEAD_REVALIDATE_TIMEOUT_MS = 300` and the
  HEAD probe is issued with `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)`,
  bounding worst-case stall to 300 ms before falling back to cached bytes.

- NCLX `colr` parsing at `apps/web/src/lib/color-detection.ts:177,216,253,387` confirms the
  precedence chain: NCLX `colr` box → ICC chromaticity → ICC name allowlist.

**Verdict: CLEAN — confirmed**

---

### Flow 4 — Admin backfill (sidecar + in-app) → advisory lock → delete-during-reencode race → file cleanup

**Claimed verdict:** CLEAN

**Evidence gathered:**

- `apps/web/src/lib/admin-backfill-runner.ts:14,19,64` — runner imports
  `LOCK_COLOR_PIPELINE_BACKFILL` from `@/lib/advisory-locks` and acquires it
  `GET_LOCK(name, 0)` (non-blocking). A second concurrent invocation fails fast.

- `apps/web/src/lib/admin-backfill-runner.ts:419,432–438,573–575,603–607` —
  delete-during-reencode race handling: `affectedRows === 0` check at two points (after
  successful encode and after detection failure), both branch to
  `deleteImageVariants(UPLOAD_DIR_WEBP/AVIF/JPEG, ...)` cleanup and return
  `{ ok: false, reason: 'deleted-mid-reencode' }`. The row is counted as
  `deleted-mid-reencode` at line 720, not as a failure or success, so a deleted-mid-reencode
  image never orphans derivative files and never increments the error counter.

**Verdict: CLEAN — confirmed**

---

### Flow 5 — CLIP embedding write → semantic search read → malformed-row skip

**Claimed verdict:** CLEAN (with known deferred gap TE-R7C2-03)

**Evidence gathered:**

- `apps/web/src/app/api/search/semantic/route.ts:43,263,274,279` —
  `decodeEmbeddingColumn` is imported and called on each row's embedding buffer. The result
  of the cosine-similarity computation is either a `{ imageId, score }` object or `null`
  (when `decodeEmbeddingColumn` returns null for a malformed row). Line 279:
  `.filter((m): m is { imageId: number; score: number } => m !== null)` drops malformed
  rows before the result set is returned.

- Route-level mixed-set skip (TE-R7C2-03) remains an untested deferred gap. Not re-filed.

**Verdict: CLEAN at runtime — confirmed; TE-R7C2-03 deferred gap carried as-is**

---

### Flow 6 — Session token → middleware guard → per-action isAdmin()

**Claimed verdict:** CLEAN

**Evidence gathered:**

- `apps/web/src/proxy.ts:76,82,128,137–139` — middleware reads `admin_session` cookie but
  explicitly notes that the cookie check at this layer is a FORMAT gate only. API routes
  (`/api/*`) are excluded from the middleware matcher; every `/api/admin/*` route must
  implement its own auth check.

- `apps/web/src/app/actions/auth.ts:12,29,54,271` — `verifySessionToken` performs full
  cryptographic validation (HMAC-SHA256 + timing-safe compare). `isAdmin()` calls
  `verifySessionToken` and is the per-action trust boundary. Both are confirmed present and
  used in the action layer.

**Verdict: CLEAN — confirmed**

---

### Residual — RES-R7C2-01 (carry forward, not escalated)

**Description:** Structurally anomalous HEIC files (where the ISOBMFF walker encounters
`constructionMethod !== 0` at any item, or `ilocVersion > 2`) cause
`stripGpsFromIsobmffBuffer` to return `null`. The `stripGpsFromOriginal` caller in
`process-image.ts` reaches the HEIC branch, logs
`'stripGpsFromOriginal: cannot strip GPS from structurally anomalous HEIC (no HEVC encoder); original retains GPS'`,
and returns without modifying the on-disk original. The paid-download route subsequently
streams the unmodified original file.

**File:line evidence:**
- `apps/web/src/lib/gps-exif-strip.ts:219,379,459–460,498–523` — `ilocVersion > 2` returns
  null at line 460; `constructionMethod !== 0` returns null at line 523.
- `apps/web/src/lib/process-image.ts:1629–1633` — HEIC branch logs the error and returns
  without a re-encode fallback (prebuilt Sharp lacks an HEVC encoder).

**Reachability:** Unverified. Apple devices write `constructionMethod = 0` by spec
convention; the anomalous branch requires a non-standard HEIF writer. Do NOT escalate
without empirical proof the branch fires on real Apple HEIC uploads.

**Status:** Carry as residual. Not escalated.

---

### Findings summary

| Flow | Verdict |
|------|---------|
| 1 — Upload → PII select | CLEAN — confirmed |
| 2 — Checkout → download | CLEAN — confirmed; deferred gaps ARCH-R7C2-01/plan-316 carried |
| 3 — Color → ETag → SW | CLEAN — confirmed |
| 4 — Backfill → advisory lock → delete-race | CLEAN — confirmed |
| 5 — CLIP → semantic search | CLEAN (runtime) — confirmed; TE-R7C2-03 deferred |
| 6 — Session → middleware → isAdmin | CLEAN — confirmed |

**Residuals carried:** 1 (RES-R7C2-01 — anomalous HEIC GPS strip path, reachability unverified)

**New findings:** 0

**Refuted findings:** MED-R7C2-01 (histogram) — not re-filed per instruction.

---

### Critical unknown

RES-R7C2-01 reachability: whether any real-world Apple HEIC file triggers
`constructionMethod !== 0` or `ilocVersion > 2` in practice.

### Discriminating probe

Upload a HEIC file crafted with `constructionMethod = 1` (or `ilocVersion = 3`) in the
`iloc` box, then check the deploy host's server log for the
`'cannot strip GPS from structurally anomalous HEIC'` error string. A confirmed hit
escalates RES-R7C2-01 to a filed finding; silence under normal Apple HEIC uploads keeps
it deferred.
