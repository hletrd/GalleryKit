# Security / correctness review — Run-3 Cycle 3 (PAT upload divergence audit)

Scope: systematic constraint-by-constraint comparison of the Lightroom Classic
PAT upload path (`apps/web/src/app/api/admin/lr/upload/route.ts`) against the
browser `uploadImages()` server action (`apps/web/src/app/actions/images.ts`).

## Constraint parity matrix (PAT route vs `uploadImages()`)

| Constraint | Browser `uploadImages()` | PAT route | Verdict |
|---|---|---|---|
| Per-file 200 MB max | `saveOriginalAndGetMetadata` → `MAX_FILE_SIZE` (process-image.ts:752) | same shared helper | **PARITY** (shared helper) |
| Empty-file rejection | shared helper (process-image.ts:756) | same | **PARITY** |
| Decompression-bomb / `limitInputPixels` | Sharp ctor in shared helper (process-image.ts:786) | same | **PARITY** |
| RAW rejection (RawFileError) | shared helper throws; caught → `rawNotSupported` (images.ts:478,506) | shared helper throws; caught as **generic 422** "Upload failed" | **DIVERGENCE (LOW)** — still rejected, but opaque message |
| Symlink rejection / SAFE_SEGMENT / UUID filename | `getSafeExtension` + `randomUUID` in shared helper (process-image.ts:762-764) | same | **PARITY** (shared helper) |
| `allow_hdr_ingest` gate | images.ts:295 | route.ts:155 (fixed cycle 1) | **PARITY** |
| `strip_gps_on_upload` (DB cols) | images.ts:318 | route.ts:158 | **PARITY** |
| `strip_gps_on_upload` (on-disk EXIF) | images.ts:323 `stripGpsFromOriginal` | route.ts:171 (fixed cycle 2) | **PARITY** |
| Topic exists validation | images.ts:251 | route.ts:96 | **PARITY** |
| Topic slug format (`isValidSlug`) | images.ts:244 | route.ts:80 | **PARITY** |
| Title/desc sanitization | `sanitizeAdminString` | route.ts:84,90 | **PARITY** |
| `icc_profile_name` column write | **`icc_profile_name: data.iccProfileName`** (images.ts:362) | **OMITTED** — instead `color_space: data.iccProfileName \|\| exifDb.color_space` | **DIVERGENCE (MED)** — see SEC-C3-01 |
| `uploaded_by` attribution | `uploaded_by: currentUser.id` (images.ts:375) | **OMITTED** (NULL) — `tokenUserId` only used for audit | **DIVERGENCE (MED)** — see SEC-C3-02 |
| `image_sizes` / upload-processing-contract lock | `acquireUploadProcessingContractLock` (images.ts:183) | NOT acquired | DIVERGENCE (LOW) — see DEF analysis |
| Cumulative byte/file-count window | tracker (images.ts:209,235) | NOT enforced | DEFERRED (DEF-C2-03) |
| Restore-maintenance window | images.ts:122,326,332 | NOT checked | DEFERRED (DEF-C2-01) |
| 1 GB disk-space pre-check | images.ts:216-226 | NOT checked | DEFERRED (DEF-C2-02) |

## SEC-C3-01 (MED / High) — PAT path drops `icc_profile_name` and pollutes `color_space` with ICC name

**Citation:** `apps/web/src/app/api/admin/lr/upload/route.ts:167-168`
```
color_space: data.iccProfileName || exifDb.color_space,
bit_depth: data.bitDepth,
```
vs browser parity `apps/web/src/app/actions/images.ts:361-363`:
```
...exifDb,                 // exifDb already supplies color_space (EXIF ColorSpace tag)
icc_profile_name: data.iccProfileName,
bit_depth: data.bitDepth,
```

**Problem (two distinct defects in one line):**
1. The PAT route **never writes the `icc_profile_name` column** at all. Every
   LR-published photo therefore has `icc_profile_name = NULL`, so the admin
   Color Details audit row shows no ICC profile name for the *primary
   non-browser ingest path*. R8-H2's stated goal ("mirror browser upload path —
   store all color/HDR signals so the Color Details accordion shows complete
   metadata") is only partially met: NCLX signals are stored but the ICC
   descriptor name is silently lost.
2. The PAT route **overwrites `color_space` with the ICC profile name**.
   CLAUDE.md (`images` color columns table) documents `color_space` as
   "EXIF `ColorSpace` tag value (`'sRGB'` / `'Uncalibrated'`) — **NOT the ICC
   name**". The browser path honors this: `color_space` flows only from
   `...exifDb` (process-image.ts:1354 derives it from `exifParams.ColorSpace`).
   The PAT path writes `data.iccProfileName` (e.g. "Display P3", "Adobe RGB
   (1998)") into the column, violating its documented semantics and corrupting
   any analytics/filtering that groups by `color_space`.

**Failure scenario:** Photographer publishes from Lightroom Classic with a
Display P3 export. DB row gets `color_space = "Display P3"` (wrong column),
`icc_profile_name = NULL` (lost). Admin opens Color Details → "ICC profile"
shows blank, and any future query `WHERE color_space = 'sRGB'` misclassifies
the photo. A browser upload of the identical file stores
`color_space = "Uncalibrated"/"sRGB"` + `icc_profile_name = "Display P3"`.

**Fix:** mirror the browser path exactly:
```
...exifDb,
icc_profile_name: data.iccProfileName,
bit_depth: data.bitDepth,
```
Remove the `color_space: data.iccProfileName || ...` line so `color_space`
comes from `exifDb` and `icc_profile_name` carries the ICC descriptor.

## SEC-C3-02 (MED / High) — PAT path leaves `uploaded_by` NULL

**Citation:** `route.ts` insertValues (no `uploaded_by` key). `tokenUserId`
is computed at route.ts:64 but used only for `logAuditEvent`. Browser parity:
`images.ts:375` `uploaded_by: currentUser.id`.

**Problem:** Every LR-published image has `uploaded_by = NULL`. The public Atom
feed (`app/feed.xml/route.ts:76-92`) renders a per-entry `<author>` JOIN-derived
from `uploaded_by`; NULL falls back to the feed-level author. For a
multi-photographer studio publishing via the LR plugin, attribution is silently
wrong — every LR upload appears authored by the site default, not the
publishing photographer, even though the PAT *identifies* that photographer
(`verified.userId`). The schema FK (`uploaded_by → admin_users.id ON DELETE SET
NULL`, schema.ts:94) and index (schema.ts:118) exist specifically for this.

**Failure scenario:** Studio with admins Alice + Bob. Bob's LR plugin holds a
PAT minted under Bob's user id. Bob publishes 50 photos. Atom feed credits all
50 to the site-default author, not Bob. `uploaded_by` is admin-only PII so no
public leak, but the attribution feature (R17-L2) is dead on the LR path.

**Fix:** add `uploaded_by: tokenUserId` to insertValues. (Cookie-fallback
requests where `tokenUserId` is null degrade gracefully to NULL — same as a
legacy upload.)

## Net-new sweep (other surfaces) — no new findings

- i18n key parity en↔ko: 812/812, zero drift.
- `serve-upload`, share routes, Stripe webhook, auth/rate-limit: no net-new
  issues surfaced this pass (covered extensively in prior R27-R29 cycles).
