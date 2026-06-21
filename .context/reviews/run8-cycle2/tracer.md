# Tracer Report — Run-8 Cycle-2

**HEAD:** f63af3b9
**Date:** 2026-06-18
**Scope:** 4 data-flow traces across free-download, GPS-strip, migration/reconcile, and settings-hash/ETag paths.

---

## Trace 1 — Free-Download Flow

**Verdict: CLEAN**

**Observation path:**
- `apps/web/src/components/photo-viewer.tsx:177` — `avifDownloadHref` is derived from the public field `image.filename_avif`.
- `apps/web/src/components/photo-viewer.tsx:189` — `isWideGamutSource = isWideGamutPrimary(image?.color_primaries)`. `color_primaries` IS a public field confirmed at `apps/web/src/lib/data.ts:241` inside `publicSelectFields`.
- `apps/web/src/components/photo-viewer.tsx:929` — the wide-gamut DropdownMenu branch is therefore reachable for public (unauthenticated) viewers.
- `apps/web/src/components/photo-viewer.tsx:934` — inside that branch, `isP3Pipeline(image.color_pipeline_decision)` is called. `color_pipeline_decision` is ADMIN-ONLY: omitted via `_omitColorPipelineDecision` at `apps/web/src/lib/data.ts:331` and listed in `_PrivacySensitiveKeys` at `apps/web/src/lib/data.ts:414`.
- `apps/web/src/lib/color-pipeline-decisions.ts:60-65` — `isP3Pipeline`: `if (!decision) return false;`. For public viewers `image.color_pipeline_decision` is `undefined`; the guard returns `false` immediately, the label falls through to the generic `downloadJpeg` branch. No crash. No admin-data leak.
- The AVIF anchor uses `avifDownloadHref` (constructed from the public `filename_avif`), never from the admin field.

**Assessment:** What initially appeared as a "critical candidate" (an admin-only field referenced on a public-data object) is fully null-safe by design. The `isP3Pipeline` guard handles the undefined case explicitly. Behavior is correct and converged. No entitlement or license gate survives anywhere in the download path — paid-download removal is byte-identical pre/post.

---

## Trace 2 — GPS-Strip Flow

**Verdict: CLEAN — RES-R7C6-01 stays CLOSED**

**Observation path:**
- Upload entry point: `apps/web/src/app/actions/images.ts` nulls `latitude` and `longitude` in the DB row at write time.
- On-disk strip: `process-image.ts` → `stripGpsFromOriginal` performs a lossless byte-level GPS-IFD / GPS-bearing-XMP neutralization on the file at `data/uploads/original/`. For PNG and structurally anomalous files a metadata-free re-encode is used instead.
- Every reader of `data/uploads/original/` is internal and server-side only: queue/backfill Sharp decode, CLIP embedding encoder, delete path. No public HTTP route streams the original.
- Application layer: `ALLOWED_UPLOAD_DIRS` whitelist excludes `original/`.
- nginx layer: `location ^~ /uploads/original/ { return 404; }` — the path is blocked at the edge before the app is reached.
- The only surviving references to `UPLOAD_DIR_ORIGINAL` in route handlers are `statfs` disk-space probes; they never stream file bytes (confirmed by security-reviewer).

**Assessment:** All exfiltration vectors are closed at two independent layers (app + nginx). RES-R7C6-01 remains correctly closed.

---

## Trace 3 — Migration / Reconcile Flow

**Verdict: CLEAN**

**Observation path:**
- All three DB entry states (fresh install, legacy without `__drizzle_migrations`, partial/mid-migration) route through `reconcileLegacySchema` + `baselineAllJournalMigrations` in `apps/web/scripts/migrate.js` before drizzle's `migrate()` runs, so drizzle never executes a previously-baselined journal file body.
- `entitlements` table drop: `apps/web/scripts/migrate.js:627` — `dropTableIfPresent(connection, 'entitlements')`.
- `images.license_tier` column drop: `apps/web/scripts/migrate.js:628` — `dropColumnIfPresent(connection, dbName, 'images', 'license_tier')`.
- Both fire on a legacy DB via the reconcile path, covering the upgrade case cleanly.
- Journal `when` for migration `0023` is `1782000000000`, which is strictly greater than the prior maximum journal `when` of `1781687094232`. Drizzle's cursor-advance logic will not skip the entry.
- The hash post-condition in `runMigrations` (asserts every journal hash present in `__drizzle_migrations` after `migrate()`) will not false-fail on this entry.

**Assessment:** Schema evolution for the paid-download removal is handled correctly across all three DB states. The migration is monotonically ordered and the post-condition guard is satisfied.

---

## Trace 4 — Settings-Hash / ETag Flow

**Verdict: CLEAN**

**Observation path:**
- `apps/web/src/lib/settings-hash.ts:42-54` — `COLOR_IMPACTING_KEYS` enumerates exactly 9 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`.
- `_ColorKeysAreSettingKeys` compile-time guard in `settings-hash.ts` validates that every entry in `COLOR_IMPACTING_KEYS` is a key of the settings type. `tsc` typecheck passes — no phantom or removed keys.
- `buildHashFromConfig` enumerates the same 9 keys when computing the settings hash.
- `serve-upload.ts` emits the ETag as `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` where `settingsHash` is already 8 chars (`HASH_LENGTH` in `settings-hash.ts`); no `.slice(0,8)` is applied at the ETag site.
- **CRT-D1 static-path caveat (still holds and is documented):** flipping a color/quality/size admin setting does NOT invalidate already-served STATIC derivatives (on-disk bytes unchanged until re-encode). The settings-hash ETag invalidates only the `serve-upload.ts` path. The static path (Next.js filesystem handler, `W/"{size-hex}-{mtime-hex}"` ETag) is invalidated only when bytes change on disk via a backfill re-encode. This limitation is documented in CLAUDE.md and no code change is indicated.

**Assessment:** The settings hash covers all 9 byte-impacting keys, the compile guard is sound, and the ETag construction is correct. The CRT-D1 operational caveat is unchanged and correctly documented.

---

## Cross-Cutting Notes

- **RES-R7C6-01 CLOSED:** GPS-strip closure confirmed by Trace 2. Do not re-file.
- **REJ-R7C3-01 disproved:** The "admin field leaked to public viewer" concern on `color_pipeline_decision` in the download flow (Trace 1) is refuted — `isP3Pipeline` is explicitly null-guarded and returns `false` on `undefined` input; no data reaches the client.
- **Stripe webhook deleted:** `checkout.session.async_payment_succeeded` handler was a tracked deferred item (C3-RPF-01 / C4-RPF-03). The entire paid-download / entitlements surface has been removed. The webhook route, the `entitlements` table, and the `images.license_tier` column are all dropped in migration `0023`. The async-payment gap is moot — no Stripe integration remains in this codebase revision.
