# Tracer Report — Run-7 Cycle-4

**Date:** 2026-06-20
**Reviewed HEAD:** 1cdbb883 (SW stamp for run-7 cycle-2; codebase delta since cycle-3 HEAD c6eff919 is 2 comment/guard fixes + review docs + SW stamp — no application logic changed)
**Scope:** 6 highest-risk security/correctness flows with file:line anchors. RES-R7C3-01 re-confirmed unchanged (do not escalate). MED-R7C2-01 / REJ-R7C3-01 / ARCH-R7C2-01 not re-filed.

---

## Flow 1 — Upload → EXIF extract → GPS PII strip → DB public/admin select

**Verdict: CLEAN**

### Evidence

**GPS strip in action** (`apps/web/src/app/actions/images.ts:311-317`):
```typescript
if (uploadConfig.stripGpsOnUpload) {
    exifDb.latitude = null;
    exifDb.longitude = null;
    await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
}
```
Both the DB columns and the on-disk original are nulled/scrubbed before the INSERT. The on-disk original path uses `data.filenameOriginal` (a UUID, never user-controlled) so there is no path-traversal risk here.

**DB field separation** (`apps/web/src/lib/data.ts:208-419`):
- `adminSelectFields` (line 208) includes `latitude` (line 236) and `longitude` (line 237).
- `publicSelectFields` (line 355 object definition) explicitly omits them via `_omitLatitude` / `_omitLongitude` destructuring (lines 326-327). The object itself (line 355) contains neither key.
- `PrivacySensitiveKeys` union (line 416) enumerates `'latitude'` and `'longitude'` among 20 admin-only fields.
- Compile-time guard (lines 418-419): `type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>` with `const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [...]  = true`. Any accidental re-addition of GPS to `publicSelectFields` is a hard `tsc` error.
- All public-facing data access functions spread `publicSelectFields` (data.ts lines 733, 782, 832, 898, 964, 1128, 1207, 1358). A distinct `publicMapSelectFields` (line 359-363) is the only path that retains `latitude`/`longitude`, and it is guarded by a separate `_mapPrivacyGuard` (line 431) that rejects any other sensitive key leaking through that path.

**No gaps observed.** Two independent enforcement layers (action nulling + compile-time guard) protect GPS PII.

---

## Flow 2 — Checkout → Stripe webhook → entitlement → paid download

**Verdict: CLEAN**

### Evidence

**Checkout** (`apps/web/src/app/api/checkout/[imageId]/route.ts`):
- Rate-limit pre-increment before any DB work; rollback on all early-return paths.
- Price > 0 guard enforced before `stripe.checkout.sessions.create`.
- Card-only pin at line 207: `payment_method_types: ['card']` — operationally closes the `async_payment_succeeded` gap (documented residual C4-RPF-03, tracked in-code).

**Webhook** (`apps/web/src/app/api/stripe/webhook/route.ts`):
- Stripe signature verified via `stripe.webhooks.constructEvent` before any processing (mandatory; throws on invalid signature).
- `payment_status !== 'paid'` gate at line 105: sessions not yet paid are ignored; the card-only pin means this path is unreachable in practice.
- Zero-amount reject at line 299: `!Number.isInteger(amountTotalCents) || amountTotalCents <= 0`.
- Idempotent: SELECT before INSERT (lines 320-331); `insertedFresh = insertHeader.affectedRows === 1 && insertHeader.insertId > 0` (line 382) distinguishes fresh insert from duplicate event.

**Download** (`apps/web/src/app/api/download/[imageId]/route.ts`):
- GET = interstitial only; no writes, no FS access.
- POST: file is opened (line 349: `fileHandle = await open(resolvedFilePath, 'r')`) BEFORE the atomic claim UPDATE so a missing file does not consume the token.
- Atomic single-use claim: `UPDATE SET downloadedAt=NOW(), downloadTokenHash=null WHERE id=? AND downloadedAt IS NULL`. Second POST returns 410.
- Constant-time verify via `verifyTokenAgainstHash()` (timingSafeEqual under the hood).
- Path safety: `lstat` → symlink rejection → `realpath` containment → `open`.

---

## Flow 3 — Color detection → pipeline decision → encoder → ETag → SW invalidation

**Verdict: CLEAN**

### Evidence

**Settings hash** (`apps/web/src/lib/settings-hash.ts:42-66`):
- 9 `COLOR_IMPACTING_KEYS`: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`.
- Compile-time guard (lines 63-65): `(typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never` — typo or removed key is a hard `tsc` error.
- `buildHashFromConfig(config)` (line 89) computes purely from resolved `GalleryConfig`; no DB round-trip on the hot serve path. Callers on the hot path (serve-upload.ts) debounce via a module-scoped 5 s TTL + stale-while-revalidate (serve-upload.ts:46-80).

**ETag formula** (`apps/web/src/lib/serve-upload.ts:215`):
```typescript
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
```
Formula incorporates pipeline version, mtime, file size, and the 8-char settings hash. Any of the 9 byte-impacting settings changing flips `settingsHash`; a re-encode changes mtime+size; a pipeline version bump changes the version prefix. All three invalidation triggers are active.

**SW invalidation** (`public/sw.template.js` / `public/sw.js`): the SW performs ETag-based HEAD revalidation bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (300 ms). On ETag mismatch the SW fetches fresh bytes. The `x-gk-admin-render: 1` header (set in proxy.ts) excludes admin-session pages from the offline HTML cache.

---

## Flow 4 — Backfill → advisory lock → delete-during-reencode race → file cleanup

**Verdict: CLEAN**

### Evidence

**Advisory lock** (`apps/web/src/lib/admin-backfill-runner.ts:310-311`):
```
'SELECT GET_LOCK(?, 0) AS acquired'  [LOCK_COLOR_PIPELINE_BACKFILL]
```
Non-blocking (`timeout=0`): if another runner holds the lock, the caller receives `{ status: 'already_running' }` immediately rather than queueing. The lock is released on connection close so a crashed runner never wedges the next attempt (line 327: `RELEASE_LOCK`).

Both the in-app runner (`admin-backfill-runner.ts`) and the sidecar script (`scripts/backfill-color-pipeline.ts`) use the same `LOCK_COLOR_PIPELINE_BACKFILL` constant, so they serialize against each other.

**Delete-during-reencode race** (`admin-backfill-runner.ts:571-607`):
- After the re-encode, the runner issues `UPDATE SET pipeline_version=? WHERE id=?`.
- If `affectedRows === 0` (row was deleted while encoding), `cleanupDeletedMidReencodeVariants(row)` is called (lines 573-574 and 605-607).
- `cleanupDeletedMidReencodeVariants` (line 430-438) calls `deleteImageVariants(UPLOAD_DIR_WEBP, ...)`, `deleteImageVariants(UPLOAD_DIR_AVIF, ...)`, `deleteImageVariants(UPLOAD_DIR_JPEG, ...)` with `[]` sizes — a full directory scan so all variant sizes are covered, including non-default-size variants.
- The return value is `{ ok: false, reason: 'deleted-mid-reencode' }` so the row is counted as neither success nor failure.

**Connection budget cap** (runner.ts:34-35): in-app concurrency capped at `max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1) / 2))` where `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` → effective cap of 2 at the shipped pool of 10, preventing live traffic starvation.

---

## Flow 5 — CLIP embedding → semantic search → malformed-row skip

**Verdict: CLEAN**

### Evidence

**Malformed-row skip** (`apps/web/src/app/api/search/semantic/route.ts:273-279`):
```typescript
const scored = rows
    .map((row) => {
        const imgEmbedding = decodeEmbeddingColumn(row.embedding);
        if (imgEmbedding === null) return null;
        const score = similarity(queryEmbedding, imgEmbedding);
        return { imageId: row.imageId, score };
    })
    .filter((m): m is { imageId: number; score: number } => m !== null);
```
`decodeEmbeddingColumn` returns `null` for any row whose MEDIUMBLOB is truncated, zero-length, or not a multiple of 4 bytes. The `.filter` type guard uses `m !== null` with an explicit type predicate so TypeScript tracks the narrowed type. A bad row is silently dropped without throwing or returning a 500.

**Gate checks** (same file): same-origin check (line 100), rate-limit pre-increment (line 209), mode gate (line 227): `'disabled'` → 503; only `'stub'` or `'production'` serve results.

---

## Flow 6 — Session cookie → middleware → isAdmin() per-action

**Verdict: CLEAN**

### Evidence

**Middleware** (`apps/web/src/proxy.ts:81-116`): cookie format check only (length >= 100 AND 3 non-empty colon-delimited segments). This is a fast-path guard to redirect obviously unauthenticated requests before they reach the server action. API routes are excluded from the matcher (line 140: `'/((?!api|_next|_vercel|.*\\..*).*)' `).

**Per-action crypto verification** (`apps/web/src/app/actions/auth.ts:28-30`):
```typescript
const session = await verifySessionToken(token);
return session;
```
`verifySessionToken` in `lib/session.ts` uses `timingSafeEqual` HMAC-SHA256 verification. A compromised or forged cookie that passes the proxy format check is rejected here on cryptographic grounds.

**Defense-in-depth layering** (`apps/web/src/app/actions/images.ts:11-12, 549, 645, 803, 877-880, 1084-1087`):
- Every mutating action imports and calls `isAdmin()` independently of the middleware check.
- The pattern is `requireSameOriginAdmin()` first (CSRF/origin check), then `isAdmin()` (session crypto check), with early return on failure.
- `isAdmin()` calls `getSession()` → `verifySessionToken(token)` → DB session lookup; it does not trust the proxy's format check alone.

---

## Residual Status

**RES-R7C3-01 — HEIC anomaly GPS-strip fall-through (CARRIED, NOT ESCALATED)**

Location confirmed unchanged: `apps/web/src/lib/process-image.ts:1628-1633` (within `stripGpsFromOriginal`) and `gps-exif-strip.ts:460,523` (ISOBMFF parser null-return paths).

The HEIC anomaly branch in `process-image.ts:1628-1633`:
```typescript
} else if (ext === '.heic' || ext === '.heif') {
    console.error('stripGpsFromOriginal: cannot strip GPS from structurally anomalous HEIC (no HEVC encoder); original retains GPS', { filePath });
    return;
}
```
This path is reached only when `stripGpsFromIsobmffBuffer` returns `null` (structural anomaly detected) AND the file extension is `.heic`/`.heif`. The lossless re-encode fallback (Tier 2) cannot proceed because prebuilt Sharp lacks the HEVC encoder. In this case the on-disk original retains its GPS data.

**Reachability assessment (unchanged from cycle-3):** A structurally anomalous HEIC that passes initial upload validation but defeats the ISOBMFF parser is theoretically possible. However: (a) the DB columns `latitude`/`longitude` are still nulled before this path executes (the DB null happens unconditionally in `images.ts:311-313`, before `stripGpsFromOriginal` is called), so the public API never serves GPS coordinates regardless; (b) the affected surface is only the paid-download original file; (c) the fallback logs a `console.error` so the anomaly is visible; (d) the `allow_hdr_ingest=false` default means HDR HEIC sources (the most likely source of exotic HEIC structure) are rejected at upload. The reachability of this code path with a GPS-carrying anomalous HEIC while `strip_gps_on_upload=true` and `allow_hdr_ingest=true` is a narrow but non-zero combination. Status: carried residual, reachability unverified, severity unchanged from prior cycle. Do not escalate.

---

## Summary

| Flow | Status | Key Anchors |
|------|--------|-------------|
| 1 — GPS PII (upload → DB → public API) | CLEAN | images.ts:311-317; data.ts:418-419 (_SensitiveKeysInPublic guard) |
| 2 — Stripe checkout/webhook/download | CLEAN | checkout/route.ts:207; webhook/route.ts:105,299,382; download/route.ts:349 |
| 3 — Color pipeline → ETag → SW | CLEAN | settings-hash.ts:63-65 (guard); serve-upload.ts:215 (ETag formula) |
| 4 — Backfill advisory lock + race | CLEAN | admin-backfill-runner.ts:310-311,573-607 |
| 5 — CLIP malformed-row skip | CLEAN | semantic/route.ts:273-279 |
| 6 — Session → middleware → isAdmin() | CLEAN | proxy.ts:81-116; auth.ts:28-30; images.ts:549,645,803,877 |
| RES-R7C3-01 — HEIC anomaly GPS-strip | CARRIED | process-image.ts:1628-1633; gps-exif-strip.ts:460,523 |

All 6 flows are intact. No new findings. One carried residual, unchanged.
