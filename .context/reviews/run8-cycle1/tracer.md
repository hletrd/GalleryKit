# Tracer Report — Run-8 Cycle-1

**HEAD:** 47b1e21f (post-Stripe-removal)
**Date:** 2026-06-21
**Scope:** FLOW-A (free download path), FLOW-B (original-file consumers + RES-R7C6-01 reachability), FLOW-C (migration 0023 apply), FLOW-D (config license-tier removal coherence)

---

## FLOW-A — Free Download: photo-viewer → href construction → serving layer → null-href guard

### Observation

The Download button in `photo-viewer.tsx` was previously gated behind a paid-download interstitial/token flow. That flow was removed in commits 6c5e0b61..47b1e21f. The kept path must be traced end-to-end.

### Evidence — href construction

`apps/web/src/components/photo-viewer.tsx:174-177`:

```
const downloadFilename = image?.filename_jpeg;
const downloadExt = downloadFilename ? downloadFilename.split('.').pop() || 'jpg' : 'jpg';
const downloadHref = image?.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : null;
const avifDownloadHref = image?.filename_avif ? imageUrl(`/uploads/avif/${image.filename_avif}`) : null;
```

`imageUrl()` (`apps/web/src/lib/image-url.ts:33-37`) prepends `IMAGE_BASE_URL` (server env) or reads `document.documentElement.dataset.imageBase` on the client. For a typical single-host deploy where `IMAGE_BASE_URL` is unset, both paths resolve `''` and the href is `/uploads/jpeg/<filename>` — a site-root-relative URL.

`isWideGamutPrimary` (`apps/web/src/lib/color-primaries.ts:46-49`) returns `false` on `null | undefined` input, so `isWideGamutSource` is safe even for images with no `color_primaries`.

### Evidence — render guard

`photo-viewer.tsx:927`: `{downloadHref && (` gates the entire `<CardFooter>` containing the Download button. When `image.filename_jpeg` is null or undefined, `downloadHref` is `null`, the footer is not rendered, and the button never appears. No orphaned handler is present.

### Evidence — gamut-aware branch

`photo-viewer.tsx:929`:
```
{isWideGamutSource && avifDownloadHref ? (
    <DropdownMenu>   ← AVIF + JPEG choice
        …
        href={downloadHref}   ← JPEG option (always set when we reach this branch)
        …
        href={avifDownloadHref}   ← AVIF option
    …
) : (
    <Button asChild …>
        <a href={downloadHref} …>   ← plain JPEG download
```

When `isWideGamutSource=true` but `avifDownloadHref=null` (filename_avif is null), the branch short-circuits to the plain JPEG button — correct. When both are non-null, the dropdown offers both. No path renders a button with a null href: the outer `downloadHref &&` guard prevents the footer entirely when the JPEG href is absent.

### Evidence — serving layer

`/uploads/jpeg/<filename>` resolves via Next.js static serving from `apps/web/public/uploads/jpeg/` (Next resolution order: headers → filesystem → route handlers). The file exists on disk for any processed image: `processImageFormats` writes JPEG derivatives atomically before the conditional UPDATE marks the row `processed = true`. The route handler at `apps/web/src/app/uploads/[...path]/route.ts` executes only when the file is NOT present in `public/` (fallback path), or for SW HEAD revalidation probes via `serveUploadFile`.

### Evidence — no orphaned interstitial/token handler

A recursive grep for `stripe`, `checkout`, `entitlement`, `download.*token`, `license.*tier`, and `sales` across `src/app` returned zero results in non-test files. The removed routes (`api/stripe/webhook`, `api/checkout`, `api/download`, pages/sales, lib/stripe, lib/license-tiers, lib/download-tokens, lib/download-interstitial) are absent from the filesystem. No route now intercepts `/uploads/jpeg/<filename>` before it reaches the static server.

### Verdict: CLEAN

The free download path is correct end-to-end. `downloadHref` is always a well-formed URL or null (button suppressed). The gamut-aware branch correctly falls through to JPEG when AVIF is unavailable. No orphaned handler intercepts the serving path. Confidence: HIGH.

---

## FLOW-B — Original-file consumers + RES-R7C6-01 reachability re-assessment

### Observation

Previously the paid-download route (`api/download`) streamed `data/uploads/original/<filename>` to public HTTP responses. That route is deleted. The question is whether any remaining code path returns original bytes to a public HTTP response.

### Exhaustive enumeration of remaining `data/uploads/original/` consumers

Evidence gathered by grepping for `resolveOriginalUploadPath`, `deleteOriginalUploadFile`, `stripGpsFromOriginal`, `processImageFormats`, `embedImageReal`, and `filename_original` across `src/lib/`, `src/app/`, and `scripts/`.

**1. Write-time GPS strip — `apps/web/src/app/actions/images.ts:315`**
```
await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
```
Modifies the on-disk file. No HTTP response. Admin server action, authentication-gated. Not a public-response path.

**2. Queue decode for derivative production — `apps/web/src/lib/image-queue.ts:293,337`**
```
const originalPath = await resolveOriginalUploadPath(job.filenameOriginal);
…
await processImageFormats(…, originalPath, …)
```
Reads the original as input to Sharp; outputs go to `public/uploads/{avif,webp,jpeg}/`. No HTTP response. Server-side only.

**3. CLIP embedding (image-queue background path) — `apps/web/src/lib/image-queue.ts:447`**
```
embedding = await embedImageReal(originalPath);
```
Produces a float32 embedding vector written to `image_embeddings` DB table. No HTTP response.

**4. CLIP embedding (admin embeddings action) — `apps/web/src/app/actions/embeddings.ts:132-133`**
```
const originalPath = await resolveOriginalUploadPath(filenameOriginal);
embedding = await embedImageReal(originalPath);
```
Admin server action (`requireSameOriginAdmin()` gated). Produces a DB row. No HTTP response.

**5. Backfill script — `apps/web/scripts/backfill-color-pipeline.ts:193,203`**
```
const originalPath = await resolveOriginalUploadPath(row.filename_original);
…
await processImageFormats(…, originalPath, …)
```
Sidecar `--rm` container script. No HTTP response.

**6. Delete — `apps/web/src/app/actions/images.ts:618,751`**
```
{ target: 'original', filename: image.filename_original, operation: () => deleteOriginalUploadFile(image.filename_original) }
```
Removes the file from disk. No HTTP response.

**7. `filename_original` in `data.ts` — `adminSelectFields` only**
`apps/web/src/lib/data.ts:210` includes `filename_original` in `adminSelectFields`. `publicSelectFields` (`data.ts:326`) explicitly omits it (`filename_original: _omitFilenameOriginal`). The compile-time `_SensitiveKeysInPublic` guard enforces this. The field is admin-only metadata used internally to locate the file; it is never surfaced to public API callers.

**Summary of remaining consumers:**

| Consumer | Path | Returns bytes to HTTP? |
|---|---|---|
| GPS strip (`images.ts:315`) | Write-time, server only | NO |
| Queue decode (`image-queue.ts:293,337`) | Background, server only | NO |
| CLIP embedding via queue (`image-queue.ts:447`) | Background, server only | NO |
| CLIP embedding via action (`embeddings.ts:132-133`) | Admin-gated action | NO |
| Backfill script (`backfill-color-pipeline.ts:193`) | Sidecar script | NO |
| Delete (`images.ts:618,751`) | Removes file | NO |

No remaining consumer returns original bytes to any HTTP response, public or authenticated.

### RES-R7C6-01 reachability re-assessment

**Prior state:** The residual was deferred because the GPS-stripped original could be streamed to a public HTTP response by the paid-download route (`api/download`). That route read the original file and streamed it. If `stripGpsFromOriginal` failed on a structurally anomalous HEIC (the `return` at `process-image.ts:1633`), the GPS-retaining original would be served to the purchaser.

**Post-removal state:** The paid-download route is deleted. No remaining code path returns the contents of `data/uploads/original/<filename>` to any HTTP response — public or authenticated. The original file is read only by Sharp (for derivative production), the CLIP encoder (for embedding), and the GPS-strip mutator itself. None of these paths returns original bytes to a caller over the network.

**Conclusion: RES-R7C6-01 leak vector is CLOSED.**

The anomalous-HEIC GPS-retention branch at `process-image.ts:1628-1634` still exists and can still execute, but its consequence is now limited to: the on-disk original retains GPS bytes. Those bytes are never delivered to any HTTP client. The DB GPS columns (`latitude`, `longitude`) are nulled before `stripGpsFromOriginal` runs (`images.ts:312-316`), so the public API never leaks GPS coordinates regardless. The residual's specific privacy leak (GPS data in a paid-download streamed file) no longer has a delivery vector.

The branch itself remains a latent imperfection (anomalous HEIC on disk retains GPS bytes) but with zero public reachability. This is a documentation/disposition update, not a new defect. If a future feature re-introduces a paid/original-file download route, RES-R7C6-01 must be re-escalated immediately.

**Verdict: CLEAN — RES-R7C6-01 leak vector definitively closed by route deletion. Confidence: HIGH.**

---

## FLOW-C — Migration 0023 apply: fresh DB and existing prod DB paths

### Observation

Migration 0023 (`0023_remove_paid_downloads.sql`) drops the `entitlements` table and the `license_tier` column from `images`. The `migrate.js` script has two apply paths: `reconcileLegacySchema` (for existing DBs being baselined) and `drizzle.migrate()` (for fresh or partially-migrated DBs).

### Evidence — migration 0023 SQL content

```sql
DROP TABLE IF EXISTS `entitlements`;
--> statement-breakpoint
ALTER TABLE `images` DROP COLUMN `license_tier`;
```

The `DROP TABLE IF EXISTS` is safe on any DB state (no-ops if the table is absent). The bare `ALTER TABLE … DROP COLUMN` would error if `license_tier` does not exist — but the SQL comment confirms: "On both a fresh DB and an incremental prod DB, migrations 0008 (adds license_tier) and 0013 (creates entitlements) run/baseline before this one, so the targets always exist when this runs via drizzle.migrate()."

### Evidence — fresh DB path (`prepareLegacyDatabaseIfNeeded`)

`migrate.js:675-695`:
1. `ensureMigrationTable` — creates `__drizzle_migrations` if absent.
2. `hasAnyGalleryTables` — returns `false` for a completely empty DB.
3. Because `!hasGalleryTables`, executes `reconcileLegacySchema(connection, dbName)`.
4. `reconcileLegacySchema` (`migrate.js:267-629`) builds the full current schema idempotently. It does NOT create `entitlements` (comment at line 596-597: "Not reconciled here so a baselined legacy DB matches the post-0023 schema"). It does NOT add `license_tier` to `images` (comment at line 370-371). It DOES call `dropTableIfPresent('entitlements')` and `dropColumnIfPresent(…, 'images', 'license_tier')` at lines 627-628 — these are no-ops on a fresh DB because neither object was created by the preceding `ensureTable` calls.
5. `baselineAllJournalMigrations` inserts one row per journal entry (filtered by hash — no duplicates). This marks all 24 entries (idx 0–23) as applied including 0023.
6. `runMigrations` calls `drizzle.migrate()`, which finds every journal hash already in `__drizzle_migrations` and applies nothing. The post-condition check (`migrate.js:724-734`) verifies all 24 hashes are present — passes.

**Fresh DB result:** Schema is built via `reconcileLegacySchema` without `entitlements` or `license_tier`. Migration 0023 is baselined but not executed (nothing to drop). Post-condition passes. Correct.

### Evidence — existing prod DB path (legacy reconcile)

`migrate.js:698-711`: If `hasAnyGalleryTables=true` and `journalCovered=false` (migration log is incomplete or poisoned):
1. `reconcileLegacySchema` runs. At lines 627-628, the LAST two statements are:
   ```
   await dropTableIfPresent(connection, 'entitlements');
   await dropColumnIfPresent(connection, dbName, 'images', 'license_tier');
   ```
   `dropTableIfPresent` uses `DROP TABLE IF EXISTS` (safe). `dropColumnIfPresent` checks `INFORMATION_SCHEMA.COLUMNS` first; if `license_tier` is absent, it returns without issuing the ALTER TABLE. Idempotent.
2. `baselineAllJournalMigrations` inserts missing hashes (already-present hashes skipped via Set filter).
3. `runMigrations` calls `drizzle.migrate()`. The drizzle migrator uses `MAX(created_at)` as its cursor.

### Evidence — journal ordering and cursor risk

Journal `when` timestamps for entries 0–23:
- idx 0–6: `1766198349853` through `1778304060000` (year ~2026 epoch range)
- idx 7–17: `1746144000000` through `1747156800000` (year ~2025 epoch range — NON-MONOTONIC, documented)
- idx 18–23: `1778587200000` through `1782000000000` (year ~2026 epoch range)

Entry 23 (`0023_remove_paid_downloads`) has `when=1782000000000`, which is the maximum `when` in the journal. After `baselineAllJournalMigrations` inserts a row for every journal entry, `MAX(created_at)` in `__drizzle_migrations` = `1782000000000`. Every entry's `folderMillis` is ≤ this value, so drizzle's cursor comparison `lastDbMigration.created_at < migration.folderMillis` is false for all entries → drizzle applies nothing → post-condition passes (all hashes present).

### Evidence — double-drop risk on existing prod DB

A prod DB that had `entitlements` and `license_tier` goes through `reconcileLegacySchema` which drops them. Then `drizzle.migrate()` finds all hashes already baselined and applies nothing — 0023's `DROP TABLE IF EXISTS` and `ALTER TABLE DROP COLUMN` never execute via drizzle. No double-drop.

A prod DB that had already applied 0023 via a prior `drizzle.migrate()` run (hash present in `__drizzle_migrations`) takes the early-return path (`journalCovered=true` at line 700) — `reconcileLegacySchema` does not run, no drops occur.

### Evidence — partial-baseline retry (post-condition false-fail risk)

If `baselineAllJournalMigrations` crashes mid-run (e.g. after inserting rows for idx 0-11 but before idx 12-23), a retry re-runs `reconcileLegacySchema` (idempotent) and `baselineAllJournalMigrations` (filters by `haveHashes` Set, inserts only missing rows — no duplicates). Then `drizzle.migrate()` finds the already-inserted hashes and correctly skips already-applied migrations. The post-condition check after `drizzle.migrate()` verifies all 24 hashes. If the second baseline inserted the remaining rows, the check passes. If the DB crashed before the second run completed, the check catches the gap and fails loudly — exactly the intended behavior.

### Verdict: CLEAN

Both the fresh-DB and existing-prod-DB paths for migration 0023 are correct. No ordering risk, no double-drop, no false post-condition failure. The idempotent `DROP TABLE IF EXISTS` in the SQL and the `INFORMATION_SCHEMA` guard in `dropColumnIfPresent` make both removal operations safe on any schema state. Confidence: HIGH.

---

## FLOW-D — Config: license-tier setting removal coherence

### Observation

The paid-download feature introduced `license_tier` as an `images` column and potentially added keys to `GALLERY_SETTING_KEYS`, `COLOR_IMPACTING_KEYS`, or `gallery-config.ts`. All must be cleanly absent post-removal.

### Evidence — `gallery-config-shared.ts`

`GALLERY_SETTING_KEYS` (`apps/web/src/lib/gallery-config-shared.ts:25-66`) lists 15 keys. Examined all 15 entries:
- No `license_tier`, `entitlement`, `stripe`, `paid_download`, or `download_token` key is present.
- `COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`) lists exactly 9 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. No paid-download key.
- The compile-time guard `_ColorKeysAreSettingKeys` (`settings-hash.ts:63-65`) enforces that every `COLOR_IMPACTING_KEY` is a real `GallerySettingKey`. Since no removed key appears in either list, no guard violation.

### Evidence — `gallery-config.ts`

A grep for `license_tier`, `entitlement`, `stripe`, and `paid` returned zero results in `gallery-config.ts` and `gallery-config-shared.ts`. The validation → resolution → consumption chain for admin settings has no dangling reference to any removed key.

### Evidence — `settings-hash.ts` / `buildHashFromConfig`

`buildHashFromConfig` (`settings-hash.ts:89-101`) maps exactly the 9 `COLOR_IMPACTING_KEYS` to their resolved config fields. No removed field appears. The `buildHash` function iterates `COLOR_IMPACTING_KEYS` in order — adding or removing a key changes the hash, but the current 9-key set is self-consistent.

### Evidence — `db/schema.ts`

A grep for `license_tier` and `entitlement` in `apps/web/src/db/schema.ts` returned zero results. The Drizzle schema no longer declares these columns.

### Evidence — `data.ts`

`adminSelectFields` and `publicSelectFields` were grepped for `license_tier`, `entitlement`. Zero results. The `_PrivacySensitiveKeys` guard (`data.ts`) has no entry for the removed fields (they are simply absent, not present-but-omitted, which is the correct post-removal state).

### Evidence — settings validation and resolution chain

The settings read/write path: admin UI → server action → `GALLERY_SETTING_KEYS` validation → `gallery-config.ts` resolution → `image-queue.ts` consumption. Since `license_tier` was a DB column (not a `GALLERY_SETTING_KEYS` entry), its removal from `gallery-config-shared.ts` validation is not applicable — it was never a setting key. Its removal from `db/schema.ts` and `data.ts` is the correct set of changes, and the migration 0023 handles the DB DDL. No dangling reference exists anywhere in the settings/hash/config chain.

### Verdict: CLEAN

No dangling reference to any removed paid-download key, column, or setting in `gallery-config-shared.ts`, `gallery-config.ts`, `settings-hash.ts`, `COLOR_IMPACTING_KEYS`, `db/schema.ts`, or `data.ts`. The settings hash remains coherent over its 9-key set. Confidence: HIGH.

---

## Summary Table

| Flow | Verdict | Confidence | Key Finding |
|---|---|---|---|
| FLOW-A (free download) | CLEAN | HIGH | `downloadHref &&` guard prevents null-href button; gamut branch safe; no orphaned handler; static serving is correct |
| FLOW-B (original consumers + RES-R7C6-01) | CLEAN | HIGH | **RES-R7C6-01 leak vector CLOSED**: zero remaining consumers return original bytes to any HTTP response |
| FLOW-C (migration 0023) | CLEAN | HIGH | Fresh-DB and prod-DB paths both correct; no double-drop; no false post-condition failure |
| FLOW-D (config coherence) | CLEAN | HIGH | No dangling `license_tier`/`entitlement` reference in any config, hash, schema, or data-access layer |

---

## RES-R7C6-01 Reachability Conclusion (explicit)

**Status: CLOSED — not merely deferred.**

The GPS-retention branch at `apps/web/src/lib/process-image.ts:1628-1634` (anomalous HEIC defeats lossless ISOBMFF scrubber, Sharp cannot re-encode HEVC) still exists in code and can still execute at upload time when `strip_gps_on_upload=true` AND `allow_hdr_ingest=true` AND a structurally anomalous HEIC is uploaded.

However the consequence is now bounded to: the on-disk file at `data/uploads/original/<filename>` retains GPS bytes in the file. This is NOT delivered to any HTTP client because:
1. The paid-download route (`api/download`) that previously streamed this file is DELETED. No surviving route serves files from `data/uploads/original/`.
2. All remaining consumers of the original path are internal server-side processes (Sharp, CLIP encoder, delete operation) with no HTTP response path.
3. The DB columns `latitude`/`longitude` are nulled before `stripGpsFromOriginal` runs (`images.ts:312-316`), so the public API never leaks GPS coordinates.

The residual can be archived as CLOSED. If a future feature re-introduces any route that streams from `data/uploads/original/`, RES-R7C6-01 must be re-opened at HIGH/CRITICAL severity (privacy) and a fix to the anomalous-HEIC branch must be implemented before that route ships.

---

## Confirmed Defects

None. All four flows are CLEAN.

---

## Carried Forward (not re-investigated this cycle — per deferred.md instructions)

- DEF-C11-01 (search `<Input>` h-8): unchanged
- R7C1-CR-01 through R7C1-CR-04: unchanged
- OBS-R7C2-02 through OBS-R7C2-07: unchanged
- TE-R7C2-02 through TE-R7C2-05: unchanged — NOTE: ARCH-R7C2-01 and TE-R7C2-02 reference Stripe webhook/entitlement code that is now DELETED. These findings should be closed/archived by the next cycle's aggregator, not carried forward. The root cause (missing behavioral tests for the money-handling route) is moot because the route is gone.
- INFO-R7C2-08, INFO-R7C2-09: unchanged
