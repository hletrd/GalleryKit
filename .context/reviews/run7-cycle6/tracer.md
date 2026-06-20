# Tracer Report — Run-7 Cycle-6

**Date:** 2026-06-20
**HEAD:** e855e6ee (byte-identical to cycle-5 convergence)
**Mission:** Evidence-driven causal trace of five critical end-to-end flows. Expected outcome: truthful zero new actionable findings.

---

## Flow 1 — Upload → PII: GPS/coordinates never reach public

### Chain traced

1. `apps/web/src/app/actions/images.ts:308-316` — `extractExifForDb()` populates `exifDb`; immediately after, if `uploadConfig.stripGpsOnUpload` is true, `exifDb.latitude = null` and `exifDb.longitude = null` are set **before** `exifDb` is spread into `insertValues` (line 356 `...exifDb`). DB INSERT therefore carries `null` for both coordinates.

2. `apps/web/src/app/actions/images.ts:316` — `await stripGpsFromOriginal(...)` is called on the on-disk original after the DB columns are nulled. Order is: null-the-DB → strip-the-file. Even if the file-strip throws (caught at line 1648 in process-image.ts with a non-fatal log), the DB columns are already null.

3. `apps/web/src/lib/data.ts:326-327` — `publicSelectFields` is derived from `adminSelectFields` by explicitly destructuring `latitude` and `longitude` out (`_omitLatitude`, `_omitLongitude`). The compile-time guard at line 418-419 (`_SensitiveKeysInPublic extends never`) enforces this at `tsc`.

4. `apps/web/src/lib/data.ts:417-419` — `PrivacySensitiveKeys` union includes `'latitude' | 'longitude'`; the `_privacyGuard` const is a type-level assertion that fires a TypeScript error if either ever appears in `publicSelectFields`.

### Residual RES-R7C5-01 status (unchanged)

`apps/web/src/lib/process-image.ts:1628-1633` is unchanged. When `stripGpsFromIsobmffBuffer` returns `null` (structural anomaly in the HEIF container) and the extension is `.heic` or `.heif`, Tier-2 falls into the `else if (ext === '.heic' || ext === '.heif')` branch and returns without writing anything — the original file retains GPS bytes. The `console.error` is emitted but the upload is not failed.

**Reachability:** unchanged from cycle-5. The DB columns are nulled before `stripGpsFromOriginal` runs (line 312-313 precedes line 316). Gallery UI, public API, and all Drizzle queries use `publicSelectFields` which omits `latitude`/`longitude`. The only exposure path is the paid-download route which streams `UPLOAD_DIR_ORIGINAL`. That route is gated by a single-use bearer token; no anonymous read path exists to the original. No new reachability evidence found.

**Verdict: CLEAN** (residual is unchanged, confirmed, and correctly scoped to RES-R7C5-01).

---

## Flow 2 — Checkout → Entitlement → Download

### Chain traced

**2a. Card-only pin**

`apps/web/src/app/api/checkout/[imageId]/route.ts:196-207` — `payment_method_types: ['card']` is hardcoded in the `stripe.checkout.sessions.create` call. Async payment methods (ACH, bank transfer) are unreachable at session creation.

**2b. Stripe webhook signature + payment_status gate**

`apps/web/src/app/api/stripe/webhook/route.ts`:
- Line ~68: `constructStripeEvent(payload, signature)` — raw body HMAC; unsigned requests return 400 before any DB work.
- Line ~96: `if (session.payment_status !== 'paid')` — explicit gate; `'unpaid'` logs at warn, other unexpected statuses at error; both return `{ received: true }` (200) without minting an entitlement.
- Line ~109: `amountTotalCents <= 0` — zero-amount coupon guard.

**2c. Idempotency**

SELECT-before-INSERT pattern (line ~268 `SELECT existing by sessionId`); if row exists, returns 200 without generating a new token. Belt-and-suspenders: `onDuplicateKeyUpdate` on the INSERT. Fresh-insert discrimination uses `insertId > 0 && affectedRows === 1` (not `affectedRows` alone, because `CLIENT_FOUND_ROWS` makes the dup-key loser also report `affectedRows = 1`). A dup-key loser with `insertId === 0` logs `idempotent skip (raced insert)` and returns without logging a plaintext token.

**2d. Token generation and storage**

`apps/web/src/lib/download-tokens.ts` — `generateDownloadToken()` returns `{ token, hash }` where hash is SHA-256 hex. Only `downloadTokenHash` is persisted; plaintext `downloadToken` is never written to DB.

**2e. Download route validation chain**

`apps/web/src/app/api/download/[imageId]/route.ts`:
- Shape check: `isValidTokenShape(token)` (`dl_` + 43 base64url chars) before any DB probe.
- Hash lookup: `eq(entitlements.downloadTokenHash, tokenHash)` — only the stored hash is compared.
- Constant-time compare: `verifyTokenAgainstHash` uses `crypto.timingSafeEqual` on 32-byte buffers.
- Expiry: `new Date() > new Date(entitlement.expiresAt)` — 24 h window.
- Refund check: `entitlement.refunded === true` → 410.
- Single-use (GET path): **no claim on GET** — interstitial renders and returns; claim is POST-only.
- Single-use (POST path): atomic `UPDATE ... WHERE downloadedAt IS NULL`; if `affectedRows === 0` → 410 "Token already used"; file handle is closed before returning 410.
- File open **before** the claim (`open(resolvedFilePath, 'r')` precedes the UPDATE) — missing-file ENOENT does not consume the token.
- After successful claim, `downloadTokenHash` is set to `null` in the UPDATE, preventing replay even on DB leak.

**Verdict: CLEAN.** Money-taken-no-goods path is closed by the card-only pin + `payment_status === 'paid'` gate. Token reuse is blocked by atomic single-use UPDATE + hash nullification. No token-timing oracle exists (timingSafeEqual on equal-length hex buffers).

---

## Flow 3 — Color → ETag → SW

### Chain traced

**3a. Source detection precedence**

`apps/web/src/lib/color-detection.ts:363` comment confirms: "Precedence: NCLX > ICC chromaticity > ICC name (heuristic)". Lines 393-395 show per-field application: `nclxPrimaries`, `nclxTransfer`, `nclxMatrix` are only applied when their respective NCLX map lookup returns a non-undefined value, preserving the lower-precedence ICC value for fields the NCLX box did not specify. This is the AGG-R8-06 correction.

**3b. Encoder decision and COLOR_IMPACTING_KEYS**

`apps/web/src/lib/settings-hash.ts:42ff` — `COLOR_IMPACTING_KEYS` array covers the 9 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. Compile-time guard at line 64 ensures every key is a valid `GallerySettingKey`; `HASH_LENGTH = 8`.

**3c. ETag formula (serve-upload path)**

`apps/web/src/lib/serve-upload.ts:215`:
```
W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"
```
The settings hash is already 8 chars (from `HASH_LENGTH`); no `.slice(0,8)` at the ETag site. On the static path (Next.js filesystem serving for files that exist in `public/`), the ETag is `W/"{size-hex}-{mtime-hex}"` — mtime and size change when a backfill re-encodes a file. The static path is the majority of production traffic; a color/quality setting change requires a backfill re-encode to change on-disk bytes before the static ETag invalidates.

**3d. Service worker HEAD revalidation**

`apps/web/public/sw.template.js:38` — `HEAD_REVALIDATE_TIMEOUT_MS = 300`. Line 239: `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)`. The generated `apps/web/public/sw.js:26` confirms `SW_VERSION = '1463f219-p7'` (git-SHA + `-p7` where 7 is `IMAGE_PIPELINE_VERSION`). Cache key includes the SW version so a pipeline version bump evicts the entire image cache.

**Verdict: CLEAN.** Color detection precedence is correct per-field. ETag formula on the serve-upload path includes all 9 COLOR_IMPACTING_KEYS. SW revalidation is bounded at 300 ms.

---

## Flow 4 — Backfill: advisory lock, claim, delete-during-reencode, version bump

### Chain traced

**4a. Advisory lock**

Both the in-app runner (`apps/web/src/lib/admin-backfill-runner.ts`) and the sidecar script (`apps/web/scripts/backfill-color-pipeline.ts`) acquire `LOCK_COLOR_PIPELINE_BACKFILL` (`gallerykit_color_pipeline_backfill`) via `GET_LOCK(name, 0)` (non-blocking) on a dedicated connection. Two concurrent backfill invocations serialize; the loser gets `0` from `GET_LOCK` and exits immediately.

**4b. Row claim — WHERE clause**

Sidecar (`backfill-color-pipeline.ts:329`): `WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION})`. In-app runner (`admin-backfill-runner.ts:374`): identical shape. Fresh uploads land at `pipeline_version = IMAGE_PIPELINE_VERSION` (set in `insertValues` in images.ts) so they are never re-processed by backfill.

**4c. Delete-during-reencode race**

In-app runner (`admin-backfill-runner.ts:573-607`):
- After `processImageFormats`, the UPDATE checks `affectedRows`. If `affectedRows === 0` (row deleted while encoding was in progress), `deleteImageVariants` is called for all three format directories and `reason: 'deleted-mid-reencode'` is returned. `pipeline_version` is NOT advanced (the row is gone), so no stale metadata is stranded at the current version.
- On detection failure (color signals threw after a successful encode): `pipeline_version` is explicitly NOT bumped (comment at line 581-585), keeping the row as a backfill candidate for a later run.

Sidecar (`backfill-color-pipeline.ts:136-145`): `filterDeletedMidReencode` checks `affectedRows === 0` per batch result and calls `cleanupDeletedMidReencodeVariants` — same pattern, confirmed at lines 129-131.

**4d. Version bump ordering**

Both paths: `pipeline_version` is written only inside the successful UPDATE (after `processImageFormats` succeeds AND color detection succeeds AND `affectedRows > 0`). A transient detection failure leaves the row behind the current version; a later run retries both encode and detection.

**Verdict: CLEAN.** No orphaned files (affectedRows===0 triggers cleanup). No stale metadata stranded at current version (version bump is withheld on detection failure and impossible on deleted-mid-reencode).

---

## Flow 5 — Session / Auth

### Chain traced

**5a. Cookie → proxy middleware**

`apps/web/src/proxy.ts:82` — `request.cookies.get('admin_session')` read in middleware. Lines 137-139 document that `/api/*` routes are **excluded** from the middleware matcher, so the middleware cookie check does not cover API routes. That exclusion is intentional and correct: API routes under `/api/admin/*` are guarded by `withAdminAuth` (enforced by `lint:api-auth`).

**5b. Token HMAC verification**

`apps/web/src/lib/session.ts:87` — `createHmac('sha256', secret).update(data).digest('hex')` produces the signature. Line 117 — `timingSafeEqual(signatureBuffer, expectedSignatureBuffer)` compares 32-byte HMAC buffers. A forged or expired token fails HMAC before any structural checks are reached (line 122 comment).

**5c. isAdmin() defense-in-depth**

`apps/web/src/app/actions/auth.ts:54` — `isAdmin()` calls `verifySessionToken` (which goes to DB for the session row). Every mutating server action also calls `requireSameOriginAdmin()` (sampled: `images.ts:102`). The lint gate `lint:action-origin` enforces the `requireSameOriginAdmin()` pattern across all files under `app/actions/`.

**5d. Rate-limit buckets**

`apps/web/src/lib/auth-rate-limit.ts`:
- Per-IP bucket: in-memory `BoundedMap` + DB-backed `'login'` key; 5 attempts / 15-min window.
- Per-account bucket: `accountLoginRateLimit` (`createWindowBoundedMap`); keyed by `buildAccountRateLimitKey()` (SHA-256 prefix of username); DB-backed `'login_account'` key; same 5/15-min window.
- Both buckets use `rollback*` helpers on infrastructure errors to avoid miscounting.
- CLAUDE.md notes these are process-local; distributed attack defense weakens under scale-out, but the single-writer topology makes this a known, documented tradeoff, not a new finding.

**Verdict: CLEAN.** HMAC + timingSafeEqual on session tokens. Defense-in-depth `isAdmin()` on every mutating action. Dual per-IP + per-account rate-limit buckets.

---

## Residual Carry-Forward Confirmation

**RES-R7C5-01** — HEIC anomaly GPS-strip fall-through (`process-image.ts:1628-1633`, `gps-exif-strip.ts:460,523`):

Confirmed unchanged at the same lines. The fall-through is real: a structurally anomalous HEIC (one where `stripGpsFromIsobmffBuffer` returns `null`) retains GPS bytes in the on-disk original when `strip_gps_on_upload = true` because Sharp cannot encode HEVC without a patent license. However:

1. DB `latitude`/`longitude` columns are nulled at `images.ts:312-313`, which executes before `stripGpsFromOriginal` at line 316.
2. All public queries use `publicSelectFields` (which excludes `latitude`/`longitude`) enforced by the compile-time guard.
3. The only path to the original bytes is the paid-download route, which requires a valid single-use bearer token.

No new reachability evidence found. The residual is correctly classified as a low-severity acknowledged gap affecting only one container family under `strip_gps_on_upload = true` with the paid-download feature active.

---

## Summary

| Flow | Verdict | File:line anchors (key) |
|------|---------|------------------------|
| 1. Upload → PII | CLEAN (residual unchanged) | `images.ts:312-316`, `data.ts:326-327,418-419` |
| 2. Checkout → Entitlement → Download | CLEAN | `checkout route:207`, `webhook:~68,~96`, `download route:validateDownloadRequest`, `download-tokens.ts:timingSafeEqual` |
| 3. Color → ETag → SW | CLEAN | `color-detection.ts:363,393-395`, `settings-hash.ts:42,68`, `serve-upload.ts:215`, `sw.template.js:38,239` |
| 4. Backfill | CLEAN | `admin-backfill-runner.ts:374,573-607`, `backfill-color-pipeline.ts:329,136-145` |
| 5. Session / Auth | CLEAN | `session.ts:87,117`, `proxy.ts:82`, `auth.ts:54`, `auth-rate-limit.ts:19` |

**All five flows CLEAN — truthful zero new actionable findings.** Residual RES-R7C5-01 is confirmed unchanged with no new escalation evidence.
