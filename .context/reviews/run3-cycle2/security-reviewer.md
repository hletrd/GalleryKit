# Security review — Run-3 Cycle 2 (HEAD 2feba5ae)

Method: direct orchestrator deep review. The cycle-2 run context directed the
highest-value lead at the Lightroom PAT upload path (`/api/admin/lr/upload`):
cycle 1 closed the `allow_hdr_ingest` divergence; this cycle re-examined ALL
admin-gated upload constraints the browser path enforces to find any the PAT
path STILL bypasses.

## Browser vs Lightroom PAT upload constraint matrix

| Constraint | Browser `uploadImages()` | LR PAT route | Status |
|---|---|---|---|
| Per-file 200 MB cap | `saveOriginalAndGetMetadata` line 752 | shared (same fn) | OK |
| RAW rejection (`RawFileError`) | shared, process-image:361 | shared | OK |
| Decompression-bomb `limitInputPixels` | shared (Sharp ctor) | shared | OK |
| `allow_hdr_ingest` gate | images.ts:295 | route.ts:123 (cycle-1 fix) | OK |
| **GPS strip from on-disk ORIGINAL** | images.ts:323 `stripGpsFromOriginal()` | **MISSING** | **F1 HIGH** |
| Restore-maintenance guard | images.ts:122/332 | missing | F2 LOW |
| Disk-space pre-check (1 GB) | images.ts:218 `statfs` | missing | F3 LOW |
| Cumulative byte / file-count window | images.ts:209-237 | missing | F4 LOW |

## F1 — Lightroom PAT upload leaks GPS in the on-disk original despite `strip_gps_on_upload` (HIGH, conf High)

**File:** `apps/web/src/app/api/admin/lr/upload/route.ts:131-135`

```ts
const exifDb = extractExifForDb(data.exifData);
if (config.stripGpsOnUpload) {
    exifDb.latitude = null;
    exifDb.longitude = null;          // <-- nulls DB columns only
}
```

The LR route nulls the `latitude`/`longitude` DB columns when
`strip_gps_on_upload` is enabled, but — unlike the browser path — it never calls
`stripGpsFromOriginal()` on the saved original file. The browser path does both
(`app/actions/images.ts:318-324`), with the explicit comment:

> `PP-BUG-3: also strip GPS EXIF from the on-disk original so the paid-download
> endpoint doesn't leak protected locations.`

**Failure scenario (full chain):**
1. Admin enables `strip_gps_on_upload` (privacy intent: GPS must never leave the
   server). CLAUDE.md / Privacy section: "GPS coordinates excluded from public
   API responses."
2. Photographer uploads a geotagged photo through the GalleryKit Lightroom
   Classic publish plugin (`lr:upload` PAT) — the *primary* non-browser ingest,
   and Lightroom exports commonly retain GPS.
3. DB `latitude`/`longitude` are nulled, so the public gallery + admin UI look
   clean. But the original on disk under `data/uploads/original/` still carries
   the GPS EXIF.
4. Admin marks the photo as a paid tier (`bulkUpdateImages` → `license_tier`).
   Schema default is `'none'`, so it is not sellable until then — but this is
   the normal photographer workflow (ingest via Lightroom, then sell).
5. A customer purchases and hits `GET /api/download/[imageId]?token=…`. That
   route (`api/download/[imageId]/route.ts:218`) streams `filename_original`
   verbatim from `UPLOAD_DIR_ORIGINAL` — no GPS stripping at serve time.
6. The customer receives the original file **with the photographer's home /
   shoot-location GPS coordinates embedded**, defeating the admin's explicit
   privacy setting.

Even before sale, the original sits on disk with GPS the admin asked to remove,
so it is a persistent at-rest privacy defect, not only a serve-time one.

**Class:** privacy / sensitive-data leak (PII = precise geolocation). Per
CLAUDE.md global rules and repo Privacy Architecture, this is NOT a deferrable
finding.

**Fix:** mirror the browser path. After `saveOriginalAndGetMetadata` succeeds
and the HDR gate passes, when `config.stripGpsOnUpload` is set, call
`await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal))`
before (or alongside) nulling the DB columns. `stripGpsFromOriginal` is already
exported from `@/lib/process-image`; `UPLOAD_DIR_ORIGINAL` from
`@/lib/upload-paths`. It is best-effort (atomic temp-rename, preserves
orientation + ICC) and never throws, so it cannot break the upload.

## F2 — LR path ignores restore-maintenance window (LOW, conf High)

**File:** `route.ts` (no `getRestoreMaintenanceMessage` call).

The browser path refuses uploads during a DB restore (images.ts:122 and again
mid-loop at :332 via `cleanupOriginalIfRestoreMaintenanceBegan`). The LR route
has no such guard, so a publish-plugin upload landing during a restore window
can insert a row the restore then clobbers / orphans the file. Single-writer
topology + short restore window keep this LOW. **Re-open:** if the LR route ever
becomes a high-volume ingest or restore windows lengthen.

## F3 — LR path skips the 1 GB disk-space pre-check (LOW, conf Med)

The browser path returns `insufficientDiskSpace` when free space < 1 GB
(images.ts:216-226). The LR route writes the original with no pre-check, so a
near-full disk surfaces as a raw Sharp/ENOSPC 422 instead of a clean signal.
Cosmetic for a single trusted admin; LOW. **Re-open:** if disk-full incidents
recur on the deploy host (124 G, see CLAUDE.md disk hygiene).

## F4 — LR path is outside the cumulative upload-tracker window (LOW, conf Med)

The per-IP/-account cumulative byte + file-count window (images.ts:209-237) does
not cover the PAT path. Acceptable: the PAT is an authenticated admin scope, and
the shared per-file 200 MB cap + decompression-bomb `limitInputPixels` still
bound the real DoS surface. LOW / accept. **Re-open:** if PATs are ever issued
to lower-trust automation.

## Confidence
- F1: HIGH severity, High confidence — verified data flow end-to-end against the
  download route source.
- F2-F4: LOW, recorded for completeness; PAT-trust + single-writer topology
  justify deferral per CLAUDE.md runtime-topology notes.
