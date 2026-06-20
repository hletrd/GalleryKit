# Trace Report — GalleryKit run-7 cycle-5

**Date:** 2026-06-20  
**HEAD:** 1cdbb883 (no source changes since cycle-4 review)  
**Scope:** 6 mandated end-to-end data flows + residual RES-R7C4-01 re-confirmation

---

## Flow 1 — Upload → PII handling

### Observation

`uploadImages` (apps/web/src/app/actions/images.ts) must null GPS columns in the in-memory EXIF record **before** the DB insert, then call `stripGpsFromOriginal` on the on-disk file, so that even a strip failure cannot leak GPS to the public.

### Trace

**Line-level ordering (images.ts:308–382):**

1. `exifDb = extractExifForDb(data.exifData)` — line 308
2. `exifDb.latitude = null; exifDb.longitude = null` — lines 312–313 (inside `if (uploadConfig.stripGpsOnUpload)`)
3. `await stripGpsFromOriginal(...)` — line 316 (on-disk strip, same `if` block)
4. Maintenance checks — lines 319–331
5. `const insertValues = { ..., ...exifDb, ... }` — line 354 spreads the already-nulled record
6. `await db.insert(images).values(insertValues)` — line 382

**Verdict:** CLEAN. GPS is nulled in memory at lines 312–313, spread into `insertValues` at line 354, and written to DB at line 382. The on-disk strip at line 316 also runs before the insert. A strip failure (e.g., the HEIC anomaly residual) cannot cause a public leak because the DB columns are already null at the point of insert; the strip failure only affects the private on-disk original (paid-download path).

**Public select field exclusion:** `publicSelectFields` in `apps/web/src/lib/data.ts` excludes `latitude` and `longitude` via the `_PrivacySensitiveKeys` compile-time guard. No change detected.

**Auth guard:** `uploadImages` calls `requireSameOriginAdmin()` at line 119 and `getCurrentUser()` at line 114, before any file processing.

---

## Flow 2 — Checkout → Webhook → Download

### Observation

Stripe checkout must pin to card-only, webhook must verify signature and gate on `payment_status === 'paid'`, and the download route must enforce single-use atomically.

### Trace

**Checkout (apps/web/src/app/api/checkout/[imageId]/route.ts:207):**

```
payment_method_types: ['card'],
```

Card-only pin confirmed. Async payment methods (SEPA/ACH/bank-transfer) cannot be initiated. `priceCents <= 0` guard at line 132 prevents zero-amount sessions.

**Webhook (apps/web/src/app/api/stripe/webhook/route.ts):**

- Stripe signature verified at line 74 via `constructStripeEvent(payload, signature)` — raw body text read before any parsing (line 66).
- `payment_status !== 'paid'` guard at line 105 rejects async/unpaid sessions.
- Zero-amount guard at line 299.
- Idempotency: SELECT by `sessionId` at line 323 before token generation; `onDuplicateKeyUpdate` belt-and-suspenders at line 365; `insertedFresh` discriminates true insert from dup-key loser at line 382 using `insertId > 0` (verified against mysql2 FOUND_ROWS behavior per code comment).
- Deleted-image FK error caught at line 390 as permanent (200, no retry).

**Download (apps/web/src/app/api/download/[imageId]/route.ts):**

- Token shape validated with `isValidTokenShape(token)` at line 107 before any DB work.
- Hash lookup at line 133 (`eq(entitlements.downloadTokenHash, tokenHash)`).
- `verifyTokenAgainstHash` constant-time check at line 170.
- lstat + symlink rejection at line 323; `realpath` containment at line 334.
- File opened (`await open(resolvedFilePath, 'r')`) at line 349 **before** the atomic claim UPDATE at line 379.
- Atomic claim: `UPDATE WHERE downloadedAt IS NULL` at lines 379–385; `affectedRows === 0` → 410 at line 398.
- On claim UPDATE failure or stream error, `fileHandle.close()` is called before returning.

**Verdict:** CLEAN. All invariants hold at file:line. Single-use is enforced atomically. File is opened pre-claim so a missing-file failure cannot consume the token.

---

## Flow 3 — Color → ETag → SW

### Observation

`process-image.ts` produces derivative files; `serve-upload.ts` emits an ETag incorporating `IMAGE_PIPELINE_VERSION`, mtime, size, and settings hash; the SW performs stale-while-revalidate with a 300 ms HEAD timeout.

### Trace

**serve-upload.ts (apps/web/src/lib/serve-upload.ts:215):**

```ts
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
```

`IMAGE_PIPELINE_VERSION` imported from `gallery-config-shared` (not `process-image`, avoiding Sharp load on serve path — comment at line 11). `settingsHash` comes from `getServingColorSettingsHash()` (lines 50–83), which uses a 5 s module-scoped TTL with stale-while-revalidate and a no-arg `FALLBACK_HASH` on cold-start failure. Cache-Control is `public, max-age=3600, must-revalidate` (line 252).

**Next static path:** serves the overwhelming majority of traffic with mtime+size ETag (no settings hash). The documented operational gotcha (CRT-D1) — flipping a color setting does not invalidate already-served static derivatives until backfill re-encodes the files — is known and documented in CLAUDE.md.

**SW (apps/web/public/sw.js:239):**

```js
signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS),
```

`HEAD_REVALIDATE_TIMEOUT_MS = 300` confirmed at line 38. On abort the SW falls through to stale-serve and revalidates in the background.

**Verdict:** CLEAN. ETag construction matches documented contract. SW timeout is wired. The static-path operability gap is a known, documented architectural trade-off, not a new defect.

---

## Flow 4 — Backfill → Advisory lock → Delete race

### Observation

Both the in-app runner (`admin-backfill-runner.ts`) and the sidecar script (`scripts/backfill-color-pipeline.ts`) must acquire the `gallerykit_color_pipeline_backfill` advisory lock and handle the delete-during-reencode race by checking `affectedRows === 0` and cleaning up derivative files.

### Trace

**Advisory lock — in-app runner (apps/web/src/lib/admin-backfill-runner.ts:64):**

```ts
import { LOCK_COLOR_PIPELINE_BACKFILL, getImageProcessingLockName } from '@/lib/advisory-locks';
```

Lock acquired non-blocking (`GET_LOCK(name, 0)`) on a dedicated connection per code comments at lines 14–19. Lock pin holds for the run's lifetime.

**Advisory lock — sidecar (apps/web/scripts/backfill-color-pipeline.ts:56, 296–298):**

```ts
import { LOCK_COLOR_PIPELINE_BACKFILL } from '../src/lib/advisory-locks';
// ...
console.log('[backfill-color-pipeline] Acquiring advisory lock…');
```

Same lock constant, same dedicated connection pattern. Explicit release at line 514 before connection close.

**Delete race — in-app runner (admin-backfill-runner.ts:573–607):**

```ts
if ((updateResult as { affectedRows?: number } | undefined)?.affectedRows === 0) {
    return { ok: false, reason: 'deleted-mid-reencode' };
```

Two `affectedRows === 0` checks (lines 573 and 605) cover both the success-path and detection-failed path. Variant cleanup via `deleteImageVariants` at lines 432–434.

**Delete race — sidecar (backfill-color-pipeline.ts:143–162):**

```ts
results: { affectedRows: number; files: BatchFilenames }[],
// ...
return results.filter((r) => r.affectedRows === 0).map((r) => r.files);
```

`getDeletedMidReencodeFiles` at lines 143–145 filters batched UPDATE results; `cleanupDeletedMidReencodeVariants` at lines 160–162 counts deleted-mid-reencode rows. Update results pushed at lines 422 and 431.

**Verdict:** CLEAN. Both entry points acquire the same advisory lock, check `affectedRows === 0`, and call `deleteImageVariants` for cleanup. Counting is correct in both paths.

---

## Flow 5 — CLIP → Semantic skip

### Observation

The semantic route must heal a stored `'production'` value to `'disabled'` when `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env flag is absent, and must skip null/malformed embedding rows via `.filter(m => m !== null)`.

### Trace

**gallery-config.ts (lines 129–144):**

```ts
semanticSearchMode: (() => {
    // ...
    if (value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') {
        return 'disabled';
    }
```

Confirmed: a stored `'production'` row heals to `'disabled'` at resolver time unless the operator explicitly sets `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.

**search/semantic/route.ts (lines 221–233):**

```ts
let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
try {
    const config = await getGalleryConfig();
    semanticMode = config.semanticSearchMode;
} catch {
    // fail closed — config unavailable means disabled
}
if (semanticMode !== 'stub' && semanticMode !== 'production') {
    rollbackSemanticAttempt(ip);
    return NextResponse.json({ error: 'Semantic search is not fully configured' }, { status: 503, ... });
}
```

Fail-closed on config error. A healed `'disabled'` is caught by the `!== 'stub' && !== 'production'` check and returns 503.

**Null embedding skip (route.ts:273–279):**

```ts
.map((row) => {
    const imgEmbedding = decodeEmbeddingColumn(row.embedding);
    if (imgEmbedding === null) return null;
    const score = similarity(queryEmbedding, imgEmbedding);
    return { imageId: row.imageId, score };
})
.filter((m): m is { imageId: number; score: number } => m !== null);
```

`decodeEmbeddingColumn` returns `null` for malformed rows; the type guard `.filter(m => m !== null)` correctly skips them with no crash.

**Verdict:** CLEAN. Resolver heals production→disabled without env flag. Route fails closed on config error. Null embedding rows are skipped safely.

---

## Flow 6 — Session → Middleware → isAdmin

### Observation

`proxy.ts` provides a first-line cookie format check for admin sub-routes; every mutating server action must independently call `requireSameOriginAdmin()` and `isAdmin()`.

### Trace

**proxy.ts (lines 54–116):**

- `isProtectedAdminRoute(pathname)` correctly guards all `/[locale]/admin/` sub-paths (line 60: `pathname.startsWith(/${locale}/admin/)`) but explicitly excludes the login page (`/[locale]/admin` exactly, no trailing slash).
- Token format check: `!token || token.length < 100` at line 90; `tokenParts.length !== 3 || tokenParts.some(p => p.length === 0)` at line 103.
- Middleware matcher at line 140 explicitly excludes `/api/*`. API routes under `/api/admin/*` rely entirely on `withAdminAuth` wrappers (enforced by `lint:api-auth`).

**Cryptographic verification (apps/web/src/lib/session.ts:117):**

```ts
if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
```

Full HMAC-SHA256 verification with `timingSafeEqual` happens inside `verifySessionToken`, called by `getCurrentUser` (auth.ts:29) and `isAdmin` (auth.ts:54–55).

**Defense in depth (images.ts:114–120):**

```ts
const currentUser = await getCurrentUser();
if (!currentUser) return { error: t('unauthorized') };
const originError = await requireSameOriginAdmin();
if (originError) return { error: originError };
```

All mutating server actions in `images.ts` call both guards. The `lint:action-origin` script enforces this across all action files. Note: `getCurrentUser()` is called before `requireSameOriginAdmin()` in `uploadImages`; however this is fine — if either check fails the action aborts. The pattern is consistent with the rest of the codebase (lines 553–554, 649–650, 807–808).

**Verdict:** CLEAN. Middleware provides format-level pre-filter; cryptographic verification in `verifySessionToken` with `timingSafeEqual`; every mutating action calls both `isAdmin()` and `requireSameOriginAdmin()`.

---

## Residual RES-R7C4-01 — HEIC Anomaly GPS-strip Fall-through

### Re-confirmation

**process-image.ts:1629–1633:**

```ts
// Prebuilt Sharp cannot encode HEVC-compressed HEIF (patent
// licensing), so a malformed HEIC that defeats the lossless
// scrub cannot be rewritten here. Surface it loudly: the
// original keeps its GPS data until the admin re-exports.
console.error('stripGpsFromOriginal: cannot strip GPS from structurally anomalous HEIC (no HEVC encoder); original retains GPS', { filePath });
return;
```

**Status: UNCHANGED — no new reachability evidence.** The fall-through path is still present. The GPS columns are nulled in the DB (images.ts:312–313) before insert (line 382) and before the strip call (line 316), so public API responses never leak GPS regardless of strip outcome. The only exposure is the private on-disk original streamed by the paid-download route (`/api/download/[imageId]`), which requires a valid, unexpired, single-use token. Reachability requires: (1) a structurally anomalous HEIC input that passes the lossless ISOBMFF scrub but fails the re-encode fallback, AND (2) the paid-download feature being active. The hosting Sharp build lacks a HEVC encoder (documented), making the fall-through path reachable only in that specific edge case. No escalation; residual stands as previously assessed.

---

## Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All 6 flows are clean; codebase has converged | High | Strong (file:line primary artifacts for every invariant) | Every checked invariant holds exactly as documented |
| 2 | Residual RES-R7C4-01 is a latent defect | Low | Moderate (code path identified; reachability unverified) | Structurally anomalous HEIC + paid-download active required; no new evidence changes assessment |

---

## Convergence Notes

All 6 flows reduce to the same conclusion: invariants hold as documented in prior review cycles. No new defects identified. The HEIC residual is unchanged from cycle-4 assessment.

---

## Current Best Explanation

The codebase is in a converged state across all 6 mandated data flows. Every ordering invariant, auth gate, atomic claim, advisory lock, null-skip, and env-heal was verified by direct file:line inspection of the primary source artifacts. No actionable new findings.

---

## Critical Unknown

Whether a structurally anomalous HEIC that defeats the lossless scrub is producible on the actual production Sharp build (RES-R7C4-01 reachability).

## Discriminating Probe

Upload a HEIC file with a deliberately corrupted `iinf`/`pitm` box (rendering it anomalous for the lossless ISOBMFF scrub) to the staging instance and observe whether `stripGpsFromOriginal` logs the HEVC-encoder error. If it does, the paid-download original retains GPS; if it does not (Sharp re-encodes or lossless scrub succeeds), reachability is refuted.

---

## Uncertainty Notes

- RES-R7C4-01 reachability remains unverified on the production host's Sharp build.
- The `affectedRows ?? 1` fallback in download/route.ts line 397 is a deliberate conservative default (allow download on shape mismatch) documented with a code comment; it is a known trade-off, not a defect.
- The static-path ETag gap (CRT-D1) is a known architectural trade-off documented in CLAUDE.md; no new evidence changes its assessment.
