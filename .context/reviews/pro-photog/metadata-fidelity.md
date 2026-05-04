# Metadata Fidelity Audit — Pro Photographer Perspective

**Reviewer:** security-reviewer (metadata fidelity lens)
**Date:** 2026-05-03
**Scope:** IPTC, XMP, EXIF, color-profile, makernotes — what survives the pipeline, what gets dropped, what leaks.

The color-mgmt review (`.context/reviews/color-mgmt/_aggregate.md`) already addressed `autoOrient`, `withIccProfile`-only metadata stripping, and ETag cache-busting. Those findings are explicitly out of scope here. This review surfaces metadata fidelity issues a working pro photographer cares about: caption retention, attribution, capture-time precision, GPS auxiliaries, makernotes, file-bytes integrity, and pipeline robustness against real-world cameras.

Severity scale (pro-photog frame):
- **PRO-CRIT** — irreversible loss/leak of bytes a paying client expects to receive intact (editorial/commercial license fulfillment).
- **PRO-HIGH** — silent destruction of caption/credit/contact metadata that pros depend on to claim authorship and recover usage rights downstream; or pipeline failure modes that make uploads chronologically wrong.
- **PRO-MED** — perceptible feature gap that limits how the gallery can be used by working pros (e.g. cross-timezone shoots, archival captioning).
- **PRO-LOW** — polish, opt-in features, or nice-to-haves.

---

## PRO-CRIT

### PHOTOG-CRIT-1 — IPTC, XMP, and full EXIF on the original RAW/JPEG are NEVER read into the database; pro caption metadata is silently abandoned at upload

**Files:**
- `apps/web/src/lib/process-image.ts:737-846` (`extractExifForDb`)
- `apps/web/src/db/schema.ts:36-53` (image columns)
- `apps/web/src/app/actions/images.ts:286-343` (upload insert path)
- `apps/web/src/app/api/admin/lr/upload/route.ts:106-132` (Lightroom plugin insert path)

`extractExifForDb` only reads from `exifData.exif | exifData.Photo` and `exifData.image | exifData.Image` and `exifData.gps | exifData.GPSInfo`. It pulls 13 fields total: `DateTimeOriginal`, `Model`, `Make` (implicitly via the `image` block read), `LensModel`, `ISO`, `FNumber`, `ExposureTime`, `FocalLength`, `GPSLatitude/Longitude`, `ColorSpace`, `WhiteBalance`, `MeteringMode`, `ExposureBias`, `ExposureProgram`, `Flash`. Everything else in EXIF is discarded. The pipeline never reads the IPTC IIM block (lives outside EXIF in JPEG APP13/Photoshop IRB) and never reads XMP (lives in JPEG APP1 / TIFF tag 700).

Pro Lightroom workflow writes the photographer's caption stack into XMP-dc:title (ObjectName), XMP-photoshop:Headline, XMP-dc:description (Caption-Abstract), XMP-dc:subject (Keywords), XMP-dc:creator (By-line), XMP-photoshop:Credit, XMP-photoshop:Source, XMP-dc:rights (CopyrightNotice), XMP-Iptc4xmpCore:CreatorContactInfo (full block: name, address, city, region, postal code, country, email, phone, website), XMP-photoshop:Instructions, XMP-photoshop:Urgency, XMP-photoshop:City / State / Country, XMP-photoshop:TransmissionReference. None of this lands in the DB.

The schema has `title` and `description` columns — the gallery treats them as admin-input fields. There is no IPTC / XMP read at any point in the upload path. This means a stringer's already-captioned JPEG ("HUNTSVILLE, AL — May 2, 2026 / Tornado damage on 2nd Ave / Photo by Jane Doe / Credit: Reuters") arrives on the server with a fully-formed caption, and the gallery shows the photo with `title=null, description=''`. The photographer then has to retype the entire caption block in the admin UI. Worse, when a colleague re-downloads the JPEG derivative (which is re-encoded — see PHOTOG-CRIT-2), the original IPTC/XMP/EXIF block is gone from the bytes too. The photographer has lost their caption permanently in the only public artifact the gallery serves.

**Photographer-facing failure scenario:** Newsroom workflow. AP staff photographer covers a wildfire, presses to publish to ATIK.KR-style gallery for buyers. Adds full IPTC caption + ContactInfo in Lightroom. Uploads via the Lightroom plugin. Gallery shows photo with no caption. Buyer downloads the JPEG; it has no caption either. License-tracking by IPTC ImageUniqueID — broken. Reverse-image-search attribution — broken (no Copyright tag). Customer support email gets the buyer asking "where's the credit line for this photo I bought?".

**Fix:**
1. `process-image.ts` — call `sharp(originalPath).metadata()` and read `metadata.iptc` (Buffer) and `metadata.xmp` (Buffer/string). Parse IPTC IIM (record 2 / dataset 5 ObjectName, 25 Keywords, 80 By-line, 105 Headline, 110 Credit, 115 Source, 116 CopyrightNotice, 120 Caption-Abstract, 122 WriterEditor, 90 City, 92 Sub-location, 95 ProvinceState, 101 CountryName, 105 Headline, 118 Contact). Parse XMP via a small XMP RDF parser or regex sub-extraction.
2. Schema additions: `iptc_caption_abstract TEXT`, `iptc_headline VARCHAR(255)`, `iptc_byline VARCHAR(255)`, `iptc_credit VARCHAR(255)`, `iptc_source VARCHAR(255)`, `iptc_copyright VARCHAR(255)`, `iptc_keywords TEXT` (JSON array), `iptc_city/region/country VARCHAR`, `iptc_object_name VARCHAR`, `iptc_instructions TEXT`. Or one consolidated `iptc_metadata JSON` column for forward-compat.
3. Auto-populate `title` from `iptc_object_name || xmp_dc_title` and `description` from `iptc_caption_abstract || xmp_dc_description` when admin fields are NULL (mirroring the existing `applyAltSuggested` semantics).
4. Display in viewer sidebar: Credit / Headline / Caption / Keywords / Location.

---

### PHOTOG-CRIT-2 — Public "Download JPEG" link serves a re-encoded SHARP-pipeline derivative with all IPTC/XMP/EXIF stripped, not the photographer's bytes

**Files:**
- `apps/web/src/components/photo-viewer.tsx:222-224, 844-851` ("Download JPEG" button)
- `apps/web/src/lib/process-image.ts:644-661` (JPEG encode chain)
- `apps/web/src/lib/serve-upload.ts:33-119` (serve handler)

The download button on every public photo page resolves to:
```
href = /uploads/jpeg/{uuid}.jpg
download = `photo-${image.id}.jpg`
```
That URL serves the file the gallery created from the SOURCE via `processImageFormats()` — `image.clone().resize().toColorspace('srgb').withIccProfile('srgb').jpeg({...}).toFile(...)`. Per the recent CM-HIGH-2 fix, this chain only sets the ICC bit; it strips ALL of IPTC, XMP, EXIF (Make/Model/Lens/serial/owner/Software/DateTimeOriginal/GPS/etc), and the photographer's original JPEG quantization tables.

So even setting aside the entitlements API at `/api/download/[imageId]` (which is paid-tier only and does serve original bytes), the FREE "Download JPEG" link delivers:
- No IPTC caption (stripped at encode).
- No XMP attribution (stripped at encode).
- No EXIF DateTimeOriginal — the recipient cannot tell when the photo was taken.
- No camera/lens info (stripped, by design for privacy — but documented nowhere; many pros want this preserved for editorial provenance).
- Re-encoded JPEG — quality loss vs original even at `quality:90`. A photographer who shipped a master JPEG-XL 100% quality file does not get back what they sent.
- ICC tag is sRGB (correct) but the embedded ICC profile is the libvips-bundled sRGB profile, NOT the source's exact ICC (e.g. a custom monitor calibration ICC the photographer might have intentionally embedded).

**Photographer-facing failure scenario:** Wedding photographer shares a gallery URL with the bride's family. Aunt downloads "the photo of Grandma" via the Download JPEG button, opens it 6 months later in Photos / Lightroom — the date metadata is gone, so it sorts as "May 2026" (the download date) instead of "October 2025" (the wedding date). Shows up in the wrong year of the family timeline. Same photo shared via email "Look what I got from the gallery!" has no embedded photographer credit; the bride's family forwards it freely with no attribution back to the photographer.

**Fix options:**
1. **Preferred:** make the "Download JPEG" button serve the ORIGINAL bytes (gated by an admin toggle `allow_original_download` if the gallery is mixed-tier — currently the `license_tier === 'none'` branch already fences this off, so the button only shows on free photos; in that case original bytes are intentional). The route would mirror `/api/download/[imageId]` minus the entitlement check.
2. **Alternative:** during JPEG encode, preserve IPTC + XMP via Sharp's `keepIptc()` + `keepXmp()` + `keepExif()` (admin opt-in via setting `preserve_metadata_on_export`). Only strip GPS when `strip_gps_on_upload` is true. This route requires a per-tag policy: you want to keep caption/credit/copyright but strip serial number when policy says so.
3. Document that the free JPEG is "preview only" and the only attribution-bearing artifact is the paid entitlement download.

---

## PRO-HIGH

### PHOTOG-HIGH-1 — `strip_gps_on_upload` only nulls the DB columns; the photographer's original GPS bytes still sit on disk in `data/uploads/original/{uuid}.{ext}` and are served verbatim through `/api/download/[imageId]` for paid-tier customers

**Files:**
- `apps/web/src/app/actions/images.ts:289-292` (DB-level GPS strip)
- `apps/web/src/app/api/admin/lr/upload/route.ts:107-110` (DB-level GPS strip on LR plugin)
- `apps/web/src/lib/process-image.ts:416-538` (`saveOriginalAndGetMetadata` writes original to disk)
- `apps/web/src/app/api/download/[imageId]/route.ts:181-204` (streams raw original bytes)

The strip-GPS policy:
```ts
if (uploadConfig.stripGpsOnUpload) {
  exifDb.latitude = null;
  exifDb.longitude = null;
}
```
This drops the lat/lng from the `images` row. It does NOT modify the file on disk. The original is at `UPLOAD_DIR_ORIGINAL/{uuid}.{ext}` with all GPS EXIF intact (GPSLatitude, GPSLongitude, GPSAltitude, GPSImgDirection, GPSDestBearing, GPSAreaInformation, GPSTimeStamp, GPSDateStamp, GPSDOP, GPSSpeed, etc.). The /api/download endpoint then serves these bytes verbatim once the buyer presents a valid entitlement token.

For the AVIF/WebP/JPEG derivatives the recently-landed `withIccProfile()` fix DOES strip GPS at encode time (CM-HIGH-2). But: (a) pro photographer hits "Download JPEG" → still gets an unrelated stripped JPEG (see PHOTOG-CRIT-2); (b) the paid /api/download original RAW/JPEG carries GPS even when the admin's strip-GPS toggle is on. Toggle name is misleading at best, security-broken at worst.

**Photographer-facing failure scenario:** Wildlife photographer covers a sensitive nesting site (golden eagle, peregrine falcon — protected species, exact location is need-to-know). Toggles "Strip GPS on upload" in admin. Sells a print to a buyer through the entitlements flow. Buyer's downloaded original JPEG has GPS coordinates of the nest. Buyer publishes the photo on Twitter; the EXIF leaks the protected location. Photographer is now liable to the wildlife agency.

Same scenario, different victim: a war/conflict photographer shoots embedded footage. Protect the source's location. Strips GPS in admin. Sells to wire service. Wire service downloads original. Original has GPS. Source compromised.

**Fix:**
1. When `strip_gps_on_upload === true`, run a metadata-rewrite pass on the on-disk original (Sharp `.toFile()` with `withMetadata({exif: stripped})` OR ExifTool `-gps:all=`) before writing the original to its final path. The original's GPS bytes are removed.
2. ALSO strip from any in-memory derivative that is still served (this is mostly already correct for AVIF/WebP/JPEG via `withIccProfile()`).
3. Add a verification test: upload a fixture with GPS, set strip_gps_on_upload, verify both `/uploads/avif/{uuid}.avif` and `/api/download/{id}?token=...` bytes have no GPS section in their EXIF.

---

### PHOTOG-HIGH-2 — `capture_date` only reads `DateTimeOriginal`; sub-second precision (`SubSecTimeOriginal`) and timezone offset (`OffsetTimeOriginal`) are silently dropped, breaking cross-timezone chronological sort

**Files:**
- `apps/web/src/lib/process-image.ts:113, 150-192, 747, 773` (`parseExifDateTime`)
- `apps/web/src/db/schema.ts:36` (`capture_date: datetime("capture_date", { mode: 'string' })`)
- `apps/web/src/lib/data-timeline.ts:34-180` (timeline sort)

The pipeline reads only `DateTimeOriginal` (Photo.DateTimeOriginal in exif-reader's output, which exif-reader 2.0.3 returns as a `Date` object — see `node_modules/exif-reader/index.d.ts:284`). It does not read:
- `OffsetTimeOriginal` — timezone offset added in EXIF 2.31 (Sony A1, A7R V, A7 IV, A9 III; Canon R5/R6 II/R3/R1; Nikon Z9/Z8 — every modern pro body since 2019). Format `+09:00`, `-05:00`, etc.
- `SubSecTimeOriginal` — sub-second part of the timestamp (3 digits typically: "234" = 0.234 sec). Critical for burst sequences at 30 fps where multiple frames share the integer second.
- `DateTimeDigitized` and `DateTime` — not the same as Original; skipping by default is correct, but no fallback exists if Original is missing (some scanned/processed images carry only DateTime).

The DB column is `datetime("capture_date", { mode: 'string' })` — MySQL DATETIME, no timezone, no fractional seconds (default precision is 0). When two photographers in different timezones upload to the same gallery, their photos get sorted chronologically by the local-clock string, not by the absolute moment of shutter actuation. A 12:00:00 JST photo (03:00 UTC) sorts AFTER a 10:00:00 PST photo (18:00 UTC the day before) — wrong absolute order.

The `parseExifDateTime` function explicitly drops timezone info from exif-reader's `Date` value: it converts to UTC components and writes "YYYY-MM-DD HH:MM:SS" into the `mode:'string'` column. exif-reader 2.0.3 already parses `DateTimeOriginal` as a Date assuming UTC (which is wrong — EXIF says the value is in the camera's local time, which is unspecified). So `capture_date` ends up holding "the camera's local clock string, interpreted as if it were UTC, but stored as a no-timezone string anyway".

**Photographer-facing failure scenario:** Two-photographer wedding team. Lead shoots in Boston (EDT, -04:00). Second shooter shoots in Hawaii during the destination wedding teaser (HST, -10:00). Photos get uploaded to the same gallery for the couple to review. Bride opens timeline view, sees Hawaii sunset photos *before* the Boston rehearsal dinner photos because Hawaii's local clock at 17:30 HST is *after* Boston's 17:30 EDT *string-wise*, but actually Hawaii is 6 hours behind. The natural chronology of the wedding day is broken in the gallery's own timeline UI.

Same concept worse: travel photographer doing a 3-week trip Tokyo → Bangkok → London. At the end of the trip, hits "upload all". Each leg's photos sort chronologically wrong in the gallery's day-by-day grouping. The headline shot from "the night we crossed into Bangkok" gets filed under the wrong day.

Burst-sequence variant: action sports photographer, Sony A1 at 30 fps, captures the winning goal. 30 frames stamped with the same DateTimeOriginal but different SubSecTimeOriginal. All 30 collapse to identical `capture_date` in the DB. Frame ordering within the burst is lost — admin cannot cull "frame 17 of 30" because the timeline cannot sort them.

**Fix:**
1. Add columns: `capture_date_offset` (`varchar(7)`, e.g. "+09:00"), `capture_subsec` (`smallint unsigned`, ms 0-999).
2. In `parseExifDateTime`, when input is the exif-reader Date branch, ALSO read `exifParams.OffsetTimeOriginal` and `exifParams.SubSecTimeOriginal` from the same `Photo` block. Reconstruct an absolute UTC moment when offset is present; otherwise keep the camera-local moment but record offset=NULL so the UI can mark the photo as "timezone-unknown".
3. Migration step: change `capture_date` to `datetime(3)` (millisecond precision) so SubSec can land directly in the column.
4. Sort key for cross-timezone galleries: `COALESCE(capture_date - INTERVAL capture_date_offset, capture_date)` so photos sort by absolute UTC moment when known.

---

### PHOTOG-HIGH-3 — GPS auxiliaries (Altitude, ImgDirection, DestBearing, AreaInformation, Speed, MapDatum) are silently dropped — drone, landscape, and aviation pros lose meaningful data

**Files:**
- `apps/web/src/lib/process-image.ts:132-138, 752-770` (GPS extraction)
- `apps/web/src/db/schema.ts:43-44` (lat/lng only)

`extractExifForDb` only reads `GPSLatitude`, `GPSLatitudeRef`, `GPSLongitude`, `GPSLongitudeRef`. exif-reader (`node_modules/exif-reader/index.d.ts:363-396`) exposes 28 GPSInfo tags including `GPSAltitude`, `GPSAltitudeRef`, `GPSImgDirection` (compass bearing of the optical axis — what direction was the camera pointing), `GPSImgDirectionRef` ('T' = true / 'M' = magnetic), `GPSDestBearing` (heading to subject), `GPSAreaInformation` (free-text region descriptor), `GPSSpeed`+`GPSSpeedRef` (drone airspeed), `GPSMapDatum`, `GPSDOP` (positional accuracy), `GPSHPositioningError` (GPS confidence radius in meters), `GPSDateStamp`, `GPSTimeStamp`. None reach the DB.

For drone photographers: altitude is a primary metadata field — knowing a shot was taken from 120m AGL vs ground level changes how the gallery should describe it. For landscape pros: GPSImgDirection is what tells you whether you're looking at a sunrise or sunset shot of the same peak. For aviation pros: GPSSpeed + Altitude separates ground-truth airshow shots from cellular handheld.

The schema columns to add are not free, but a single `gps_metadata JSON` column would carry everything in one shot.

**Photographer-facing failure scenario:** Drone photographer with DJI Mavic 3 Pro shoots a series of an off-grid cabin in Yukon — top-down 80m, oblique 30m, ground-level 1.2m. Gallery shows three identical "lat/lng" pairs and no altitude differentiation. Buyer scrolls past the unique top-down because the gallery card surfaces are identical.

Aviation photographer at the Reno Air Races. Shoots P-51 Mustang at 200 ft AGL doing 380 mph. GPS speed and altitude tell the story. Gallery loses both. Photo is "just another P-51 photo".

**Fix:** add JSON column `gps_metadata` populated from the full `GPSInfo` block (after lat/lng + datum normalization). UI shows altitude and bearing under the photo when present, with tasteful pictograms (▲ for altitude, ◯→ for compass).

---

### PHOTOG-HIGH-4 — `lens_model` is captured raw with no normalization, so search/filtering across "Sony FE 70-200mm F2.8 GM OSS II" / "FE 70-200mm GM OSS II" / "70-200 GM" / "Sony 70-200/2.8 GM2" silently fragments

**Files:**
- `apps/web/src/lib/process-image.ts:775` (`lens_model: cleanString(exifParams.LensModel)`)
- `apps/web/src/db/schema.ts:38` (`lens_model: varchar("lens_model", { length: 255 })`)

Lens identification is a long-standing EXIF mess. Same Sony FE 70-200mm F2.8 GM OSS II reports as:
- `FE 70-200mm F2.8 GM OSS II` on Sony A1 with firmware ≥ 1.20
- `FE 70-200 F2.8 GM OSS II` on Sony A7 IV (drops "mm" suffix in some firmwares)
- `Sony FE 70-200mm F2.8 GM OSS II` when LightRoom rewrites EXIF
- `70-200mm F2.8 GM` on older bodies

Third-party glass is worse:
- Sigma 35mm F1.4 DG HSM Art on Sony reports as `35mm F1.4 DG HSM | Art 012` (with internal ID), or `Sigma 35mm F1.4 DG HSM | A` depending on firmware.
- Tamron 28-75mm F2.8 reports as `Tamron 28-75mm F/2.8 Di III VXD G2 (A063)` or just `28-75mm F2.8` depending on whether the body recognized the lens.
- Manual lenses report nothing or report user-set strings (Voigtländer Nokton sometimes shows up as the focal-length-only string, sometimes as user-defined).

Without normalization, the gallery will accumulate `lens_model = 'FE 70-200mm F2.8 GM OSS II'` for some photos, `lens_model = 'Sony FE 70-200mm F2.8 GM OSS II'` for others. Filtering "shot with the 70-200 GM II" will miss half the photos.

**Photographer-facing failure scenario:** Working pro with rotating gear inventory. Wants to build a smart collection (Phase 4.2 / smart-collections.ts) "Shots taken with my Sony 24-70 GM II from 2023-2026". Compiles for the gallery's mid-year promo. Filter `lens_model = 'FE 24-70mm F2.8 GM II'` matches 2023 photos. Then Sony body firmware update changed the EXIF string — 2025 photos now read `FE 24-70 F2.8 GM II`. Smart collection silently excludes 2025-2026 work.

**Fix options:**
1. **Lightweight (recommended):** add a `lens_model_normalized varchar(255)` column populated by a static lookup table at extract time. Maintain a small lens dictionary keyed on best-effort prefix-stripping (drop "Sony", "Canon", "Nikon", "Sigma", "Tamron"; collapse "mm F" / "mm f/" / " F" / " f/" → " f/"; normalize "II"/"II OSS"/etc). Match against canonical-name → manufacturer + canonical model. Existing entry `lens_model` keeps the raw string for forensics.
2. **Heavier:** integrate ExifTool's lens dictionary (or libexif's). Out of scope unless the gallery moves to a richer tool than exif-reader.

---

### PHOTOG-HIGH-5 — exif-reader 2.0.3 returns DateTimeOriginal as a `Date` object (interpreted as UTC), but cameras write local time — the parser silently shifts every photo's timestamp by the server's UTC offset

**Files:**
- `node_modules/exif-reader/index.d.ts:284` (`DateTimeOriginal: Date`)
- `apps/web/src/lib/process-image.ts:150-192` (`parseExifDateTime`)

exif-reader 2.0.3 parses the EXIF DateTimeOriginal string `2024:05:02 14:30:00` into a `Date` object using `new Date(yr, mo-1, day, hr, mi, sec)` semantics in v8 — which interprets the components as LOCAL TIME OF THE NODE PROCESS. So:
- Server runs in UTC → `Date(2024, 4, 2, 14, 30, 0)` is interpreted as UTC. `getUTCHours() = 14`. parseExifDateTime stringifies it as `2024-05-02 14:30:00`. **Correct (by accident).**
- Server runs in PDT (the developer's laptop) → same input becomes a Date for PDT 14:30. `getUTCHours() = 21`. parseExifDateTime writes `2024-05-02 21:30:00`. **Wrong — photo was taken at 14:30 in the camera's frame; gallery shows 21:30.**
- Container deployed in Asia/Seoul → `Date(2024,4,2,14,30)` is interpreted as KST. UTC components get shifted -9h to `05:30 UTC`. parseExifDateTime writes `2024-05-02 05:30:00`. **Off by 9 hours.**

This bug is masked by the typical Docker deployment running in UTC (the `Dockerfile` does not set TZ — and Linux containers default to UTC), but will reproduce immediately in any deployment where the host server has a non-UTC system timezone (NAS deployments often run America/Los_Angeles or local TZ to match operator wall clocks).

The string-input branch of `parseExifDateTime` (line 156-164) is correct because it parses the EXIF string directly and writes the same wall-clock components into MySQL. The Date-input branch (line 171-177) is wrong because it goes through `getUTCFullYear()`/`getUTCHours()` etc., which read the Date's UTC representation — but exif-reader has already shoved local-camera time into the Date as if it were local-server time. Net effect: the server's TZ silently rotates the photo's timestamp.

**Photographer-facing failure scenario:** Gallery operator runs the Docker container on a NAS (`TZ=America/New_York`). Photographer uploads photos taken in EDT. The wall-clock timestamp 13:00 EDT goes through exif-reader → `Date` object representing 13:00 EDT (17:00 UTC) → parseExifDateTime UTC branch reads `getUTCHours() = 17` → DB row `capture_date = '2026-05-02 17:00:00'`. Gallery's photo viewer shows "Captured at 17:00" — the photographer's actual capture time was 13:00. Every single one of their photos is silently wrong by 4-5 hours.

Worse: the timeline UI sorts by `capture_date`. Two photos taken 30 minutes apart on opposite sides of midnight (camera local) end up assigned to different *days* in the timeline.

**Fix:** in the Date-input branch, do not call `getUTCHours()` etc. Either (a) call the local-time getters (`getFullYear`, `getHours`, etc.), or (b) avoid going through Date entirely — convert the EXIF parse output back to a string format and re-parse via the string regex branch. Cleanest: the string branch already handles `YYYY:MM:DD HH:MM:SS`; coerce exif-reader's `Date` to its local-time string before passing to `parseExifDateTime`.

Lock-in test: feed `parseExifDateTime(new Date(2024, 4, 2, 14, 30, 0))` from a forced-TZ test (`process.env.TZ = 'Asia/Seoul'`); assert output is `'2024-05-02 14:30:00'` not `'2024-05-02 05:30:00'`.

---

### PHOTOG-HIGH-6 — EXIF parsing failures crash silently into the catch-all and the photo uploads with no metadata; the gallery cannot tell a "real RAW with corrupt EXIF" from "phone photo with no EXIF"

**Files:**
- `apps/web/src/lib/process-image.ts:462-469` (`exifReader(metadata.exif)` try/catch)
- `apps/web/src/app/actions/images.ts:282-343` (upload continues on EXIF failure)

```ts
let exifData: ExifDataRaw = {};
if (metadata.exif) {
    try {
        exifData = exifReader(metadata.exif);
    } catch (e) {
        console.error('Error reading EXIF', e);
    }
}
```

When exif-reader throws (truncated EXIF chunk from a recovery tool, byte-swapped legacy IFD, oversized values that exif-reader rejects, malformed maker note), the function silently swallows the error and continues with `exifData = {}`. extractExifForDb then returns empty values for every field. The image inserts with `capture_date=NULL`, `camera_model=NULL`, `lens_model=NULL`, etc. The admin sees a photo with "Camera info unavailable" and has no signal that the EXIF parse FAILED vs the source genuinely had no EXIF (e.g. screenshots, scanned documents, social-media-stripped images).

Real-world EXIF corruption sources:
- Files recovered from SD card with PhotoRec — often have truncated trailing IFDs.
- iPhone PNG screenshots from Photoshop — `metadata.exif` can be an IFD0-only block with no Photo IFD, exif-reader handles fine. But Photoshop's "Save for Web" sometimes writes byte-swapped EXIF on PNG that exif-reader 2.0.3 rejects.
- Older Sony A100 / D40 with original firmware — has a known maker note bug that some EXIF parsers reject.
- ARW files where the camera generated the embedded JPEG with a buggy EXIF block (Canon EOS 5DSr, certain firmware).

**Photographer-facing failure scenario:** Disaster photographer recovers an SD card from a damaged camera using PhotoRec. Some files have intact image data but truncated EXIF. Uploads the recovered batch. Gallery silently drops all metadata. Photographer has no way to know which photos uploaded "clean" vs "metadata-stripped due to corruption". Two months later, when re-shooting the assignment for a new outlet that requires the original capture date, photographer cannot tell whether the missing capture_date is "EXIF was corrupt" or "this was a screenshot".

**Fix:**
1. Persist a short error tag on the image row when EXIF parse fails: add `exif_parse_status varchar(20)` (`'ok' | 'no_exif' | 'parse_failed' | 'partial'`).
2. Show a visual badge in the admin dashboard for `exif_parse_status != 'ok'`.
3. Surface the error to the user in the upload UI ("EXIF could not be read for `IMG_001.JPG` — image still uploaded").
4. Optional: try a fallback parse via `sharp.metadata()` plus a smaller field set (DateTimeOriginal via a string scan of the buffer).

---

### PHOTOG-HIGH-7 — `original_format` lossy: AVIF original gets stored as `'AVIF'` (uppercase ext suffix), but the column is varchar(10) and there is no `original_compression` info; print shop can't tell if a TIFF is LZW vs ZIP vs uncompressed

**Files:**
- `apps/web/src/db/schema.ts:52` (`original_format: varchar('original_format', { length: 10 })`)
- `apps/web/src/app/actions/images.ts:336-343` (insert pulls only the file extension)
- `apps/web/src/lib/process-image.ts` (no compression scheme captured)

`original_format` is set from `data.filenameOriginal.split('.').pop()?.toUpperCase()` — extension uppercase. So a 16-bit ZIP-compressed TIFF and an 8-bit uncompressed TIFF land identically as `original_format='TIF'`. Editorial archive workflow that relies on knowing if a master is LZW or ZIP for ingestion automation cannot use the metadata.

Sharp's `metadata().compression` exposes the libvips compression descriptor (`'jpeg' | 'lzw' | 'deflate' | 'packbits' | 'none' | etc.`) for TIFF. Not currently read.

**Photographer-facing failure scenario:** Editorial photographer's archive ingester pulls weekly from a gallery export feed. Ingester does different things based on TIFF compression: LZW gets normalized, ZIP gets re-encoded for storage efficiency, uncompressed gets written unchanged. The gallery's API only exposes `original_format='TIF'` — the archive script has to download every original, run its own ExifTool, and decide. Wasted bandwidth and time.

**Fix:** add `original_compression varchar(20)` and read from `metadata.compression`. Same for `bit_depth` — already captured (CM-LOW-1 fix landed) but nothing is publicly visible on the photo page.

---

## PRO-MED

### PHOTOG-MED-1 — `camera_model` and `lens_model` always include the photographer-identifying camera owner / serial number when ExifTool would surface them, but Make is implicit and never persisted independently

**Files:**
- `apps/web/src/lib/process-image.ts:740-741, 774` (extracts only Model and LensModel from imageParams / exifParams)

The schema has `camera_model` but no `camera_make`. `extractExifForDb` reads `imageParams.Model` (e.g. `'EOS R5'`) and writes it to `camera_model`. The Make (`'Canon'`) is silently dropped. Two photos from a Canon EOS R5 and a Sony A7R V Mk II both surface as `camera_model = 'A7R V'` / `'EOS R5'`; for many users that's fine, but cross-brand pros want filter "All Canon shots" or "All Sony shots". Schema cannot do it without the Make column.

(`camera_owner_name` and `body_serial_number` are out of scope for here — see PHOTOG-MED-3.)

**Fix:** add `camera_make varchar(64)` populated from `imageParams.Make`. Migrate: backfill from existing `camera_model` strings via a static prefix table.

---

### PHOTOG-MED-2 — IPTC and XMP metadata are NEVER preserved on derivative encode (the new `withIccProfile()` chain only sets ICC bit) — even if the photographer opts to share their photo with caption preserved, the on-disk derivative has none

**Files:**
- `apps/web/src/lib/process-image.ts:617-661` (encode chain — three branches)

The encode chain after the CM-HIGH-2 fix uses `.withIccProfile('srgb')` / `.withIccProfile(avifIcc)` for all three formats. Sharp's `withIccProfile()` sets ONLY the ICC metadata bit (`0b01000`). It does not preserve IPTC (`0b10000`), XMP (`0b00100`), or EXIF (`0b00010`).

For privacy-conscious operators this is exactly right (CM-HIGH-2 demanded it). For attribution-conscious pros it's the opposite of right: when a pro deliberately wants to push photos out with IPTC caption attached for downstream attribution preservation, they cannot. There is no setting.

The right semantic split is per-tag, not per-format:
- **Always strip** (privacy floor): camera Body Serial Number, Lens Serial Number, GPS lat/lng (when policy on), CameraOwnerName.
- **Strip by policy:** GPS auxiliaries (admin toggle).
- **Always preserve** (attribution / archive): IPTC caption stack (Headline, Caption-Abstract, By-line, Credit, Copyright, ContactInfo); XMP-dc:title / description / creator / rights.

Sharp 0.34 `withIptc()` / `withXmp()` (or `withMetadata({iptc: ..., xmp: ...})` with explicit Buffer) can apply per-tag preservation. The current code structure does not expose this.

**Photographer-facing failure scenario:** Stock photo agency contributor uploads RM-licensed photos to the gallery's "stock photos" topic. Each photo's IPTC has the photographer's name in By-line and the agency's credit line. When agency or buyer downloads the AVIF/JPEG/WebP, the bytes have no IPTC. Buyer publishes; downstream usage is uncredited; agency's contribution-tracking rights-management system cannot find the buyer who published without permission.

**Fix:**
1. New admin setting `preserve_iptc_xmp_on_export` (boolean, default true for "share for attribution", false for "max privacy").
2. In `processImageFormats`, when setting is true, read `metadata.iptc` and `metadata.xmp` once, pass them to `withMetadata({iptc, xmp, icc: ...})` selectively. Strip GPS subfields manually before passing.
3. Per-tag override list in admin (`strip_serial_numbers`, `strip_owner_name`, `strip_software_tag`, etc.).

---

### PHOTOG-MED-3 — There is no admin setting to PRESERVE Body Serial Number / Camera Owner Name on derivative AVIF for chain-of-custody news workflows; the CM-HIGH-2 fix unconditionally strips them

**Files:**
- `apps/web/src/lib/process-image.ts:638-661` (encode chain after CM-HIGH-2 fix)

Wire-service and forensic news workflows DEPEND on the Body Serial Number being embedded in the JPEG bytes for chain-of-custody (and for fraud detection: AP, Reuters, AFP photographers' images get verified by serial-number lookup against the photographer's known body). The CM-HIGH-2 fix replaces `withMetadata({icc})` with `withIccProfile()`, which strips serial. Right move for privacy by default. But there is no opt-IN for editorial/news contexts that need it.

**Photographer-facing failure scenario:** Reuters stringer's photo is challenged on social media as "AI-generated". Reuters has internal protocol: pull the JPEG, verify Body Serial = the stringer's known body. The gallery served the JPEG with no serial. Cannot verify. Photo gets retracted out of caution, stringer's reputation takes a hit.

**Fix:** admin setting `preserve_serial_numbers_on_export` (boolean, default false — privacy-first). When true, the AVIF/WebP/JPEG encode chain re-attaches `BodySerialNumber`, `LensSerialNumber`, `CameraOwnerName` to the metadata block via `withMetadata({exif: filteredExif})`.

---

### PHOTOG-MED-4 — `density` (DPI from Sharp metadata) is never captured and never written back on JPEG encode — print labs that use IPTC DPI tag for queue routing fail

**Files:**
- `apps/web/src/lib/process-image.ts:520-538, 644-661` (DPI never read, never embedded)
- `apps/web/src/db/schema.ts` (no DPI column)

Sharp's `metadata().density` returns DPI. The pipeline never reads it. JPEG encode chain does not call `.jpeg({...})` with DPI — Sharp's default is 72. So the served JPEG is always 72 DPI even when the source was 300 DPI.

Print labs (Whitewall, Bay Photo, Loxley) auto-route incoming JPEGs to print sizes based on JPEG DPI tag: 300 = "fine art" queue, 72 = "web preview, reject for print". A photographer who downloads the served JPEG and emails it to a print lab gets the order rejected automatically.

**Photographer-facing failure scenario:** Wedding photographer's couple wants to print 30x40" canvas of the first kiss. Couple downloads from gallery, sends to Whitewall. Whitewall's automated DPI check tags the file as "web preview" (72 DPI) and rejects with "please supply a print-quality file". Photographer gets a frustrated text from the bride at 11pm.

**Fix:**
1. Add `original_dpi int` column.
2. In `saveOriginalAndGetMetadata`, `bitDepth = ...; const dpi = metadata.density ?? null;` — store both.
3. In `processImageFormats`, encode JPEG with `.jpeg({..., density: 300})` when the source was print-resolution (≥240 DPI), or with `density: metadata.density` to match. Same for `withMetadata({density: ...})`.

(Cross-link with the print-review for the print perspective.)

---

### PHOTOG-MED-5 — Animated GIF / animated WebP / animated AVIF (and HEIC live photos) are accepted by ALLOWED_EXTENSIONS but the pipeline silently encodes only frame 0; no flag, no warning

**Files:**
- `apps/web/src/lib/process-image.ts:71-73` (`'.gif'` in ALLOWED_EXTENSIONS)
- `apps/web/src/lib/process-image.ts:451, 565` (`sharp(originalPath, {...})` — no `pages: -1` or animation handling)

Sharp's default reads page 0 of multi-page input (TIFF, GIF, WebP, AVIF, HEIC). The pipeline does not pass `{pages: -1}` (read all frames as multi-frame) or `{animated: true}`. So a 5-second 30 fps animated GIF (150 frames) gets encoded as a static AVIF/WebP/JPEG showing frame 0 only.

iPhone Live Photos export as HEIC with multiple images (primary + 1-3 second motion). Apple Pro Photos package multiple variants in HEIF MIAF. Sharp's primary-image selection is "image 0" — usually the highest-quality still — which is correct for stills. But there is no surfacing of "this file had animation that was discarded".

**Photographer-facing failure scenario:** Wedding photographer captures the reception dance floor on iPhone Live Photo for an iPhone-shooting story. Uploads. Gallery shows a still frame. Bride's mother says "where's the moving one I saw on Jenny's phone?". Gallery has no UI affordance for this — there's not even a label "static frame extracted from a live photo".

**Fix:**
1. Detect multi-frame source via `metadata.pages > 1` (or `metadata.animated`).
2. Add `is_animated boolean DEFAULT false` and `frame_count smallint`.
3. Surface "Static preview — original is animated" badge in admin and viewer.
4. Optional: produce a small animated derivative in addition to the still. Out of scope for this audit but flag.

---

### PHOTOG-MED-6 — Multi-page TIFF (HDR brackets, panorama sources, scanner output with overview) is silently flattened to page 0

**Files:**
- `apps/web/src/lib/process-image.ts:451, 565` (no `pages` handling)

Pro multi-page TIFF use cases:
- HDR bracket TIFF stack: 7 frames at +/-3EV. Photographer uploads to share the source for a downstream HDR re-render. Gallery sees frame 0 (the underexposed -3EV) — looks broken.
- Panorama source TIFF: 6 horizontal frames stitched into a multi-page TIFF before final stitch. Photographer uploads to share with collaborator for re-stitch. Gallery shows leftmost frame only.
- Scanner output: many film scanners (Imacon, Hasselblad Flextight, Epson V850 with SilverFast) write multi-page TIFF (overview thumbnail + full-resolution scan). Sharp picks the first which may be the overview.

**Photographer-facing failure scenario:** Architectural photographer scans 4x5 large format negatives on Imacon. Output is multi-page TIFF: page 0 = 1500 px overview (for thumbnail browsing in the scan software), page 1 = 8000 px full-res. Photographer uploads. Gallery makes derivatives from page 0 — every photo is a 1500 px thumbnail. Photographer doesn't notice until prints come back blurry.

**Fix:**
1. `metadata.pages` exposes count.
2. When > 1, add admin-side surface: which page to use? Default to page 0 with a "use page N" override.
3. Extract `iccProfile` and `exif` from each page; stitch into the DB row only from the chosen page.

---

### PHOTOG-MED-7 — `Software` EXIF tag (Lightroom Classic 14.1, etc.) is read by Sharp but never persisted in the schema — pros can't surface "edited in" provenance

**Files:**
- `apps/web/src/lib/process-image.ts:740-741, 774` (no Software read)
- `apps/web/src/db/schema.ts` (no `software` column)
- `node_modules/exif-reader/index.d.ts:55` (Software string available on Image block)

`exifData.image.Software` (or `exifData.Image.Software`) is exposed by exif-reader. The pipeline never reads it. Editorial / fine-art photographers care: a buyer asked "is this AI-generated?" answers immediately if Software shows "Adobe Lightroom Classic 14.1" or "Capture One 24". Workflow auditors care: "this photo was processed with an unauthorized Topaz plugin" — the Software tag would say so.

**Fix:** add `processing_software varchar(255)` populated from `imageParams.Software` in extractExifForDb. Display in viewer info panel.

---

### PHOTOG-MED-8 — `user_filename` stored is the ORIGINAL upload filename (e.g. `IMG_4892.CR3`), but `filename_original` on disk is `{uuid}.{ext}` — there's no way to expose the photographer's catalog filename in the download attachment header

**Files:**
- `apps/web/src/app/actions/images.ts:319-323` (`user_filename = originalFilename`)
- `apps/web/src/app/api/download/[imageId]/route.ts:192-194` (download attachment is `photo-{id}{ext}`)
- `apps/web/src/components/photo-viewer.tsx:849` (download attribute is `photo-${image.id}.${downloadExt}`)

`user_filename` retains the original name. But the download header (entitlements path) and the public download attribute both use a synthesized `photo-{id}.ext`. The buyer downloads `photo-12345.jpg` instead of `IMG_4892_HiRes.jpg`. Loses the photographer's filename convention.

**Photographer-facing failure scenario:** Photographer's filename convention encodes assignment + frame: `2026-05-02_REUTERS_TornadoAL_001.jpg`. Buyer downloads via the gallery's entitlement flow. File on disk is `photo-15873.jpg`. Buyer's editorial system can't auto-route by filename pattern. Buyer's editor manually renames and gets it wrong; photo runs with the wrong story slug.

**Fix:** in `/api/download/[imageId]`, look up `images.user_filename` and use it (sanitized, length-capped) in `Content-Disposition: filename="..."`. Same for the public `download` attribute on the Download JPEG anchor.

---

## PRO-LOW

### PHOTOG-LOW-1 — Camera makernotes (Sony.MakerNote with AF point + ColorMode + PictureProfile; Canon CRX; Nikon NCDT) are never decoded; no AF-point overlay possible in viewer

**Files:** `apps/web/src/lib/process-image.ts:737-846`

exif-reader does not decode makernotes. ExifTool does. Surfacing AF point as an overlay on the photo (a colored dot showing where the camera focused) is a popular pro feature in Capture One / Photo Mechanic. The gallery has no such surface. PRO-LOW because a custom feature, not a regression.

**Fix:** out of scope here. Track as a feature request for "ExifTool integration".

---

### PHOTOG-LOW-2 — ICC profile name extracted from source (e.g. "Foobar2024 Calibrated") leaks to admin dashboard; could fingerprint a photographer's monitor calibration setup

**Files:** `apps/web/src/lib/process-image.ts:357-414` (`extractIccProfileName`), `apps/web/src/app/actions/images.ts:330` (insert `color_space: data.iccProfileName || ...`)

If a photographer uses a custom display calibration (e.g. SpyderX-generated profile named `Eizo CG2700X 2026-04-29 D65 G2.2`), that profile name lands in the `color_space` column and is displayed in the admin sidebar (and possibly the public viewer). For multi-photographer galleries, photographer A's calibration name leaking to photographer B is a minor cross-photographer-privacy concern.

**Fix:** flag-pattern allowlist — when the parsed ICC name doesn't match a known canonical name (`'sRGB'`, `'Display P3'`, `'Adobe RGB (1998)'`, `'ProPhoto RGB'`, etc.), normalize to `'Custom'` for public display, but keep raw value in DB for admin forensic.

---

### PHOTOG-LOW-3 — Color rendering intent in source ICC (perceptual / relative-colorimetric / absolute-colorimetric / saturation) is never surfaced; print labs that respect rendering intent get the wrong tone mapping

**Files:** `apps/web/src/lib/process-image.ts:357-414` (parser only reads 'desc' tag)

ICC profiles include a default rendering intent in the header (offset 64). Print workflow cares (perceptual for photos, relative-colorimetric for reproduction). The parser doesn't read it; the encode chain doesn't preserve it.

**Fix:** PRO-LOW; ICC fidelity for print labs is best handled by serving the original RAW/TIFF, which is already correct.

---

### PHOTOG-LOW-4 — XMP sidecar files (.xmp paired with original RAW) are NOT accepted on upload — Lightroom develop settings are lost

**Files:** `apps/web/src/lib/process-image.ts:71-73` (.xmp not in ALLOWED_EXTENSIONS)

A Lightroom user's develop settings live in a paired `.xmp` sidecar next to the RAW. Upload only accepts the .arw/.cr3/.nef. The sidecar is left on the photographer's local drive. Two months later, the photographer wants to re-render the RAW with the develop applied — the gallery has the RAW but not the sidecar.

**Fix:** PRO-LOW because most pros don't share develop sidecars publicly. If implemented, it would be a paired-upload feature (.xmp accepted, stored alongside `{uuid}.{ext}.xmp`).

---

### PHOTOG-LOW-5 — `original_file_size` mode `'number'` on `bigint` will silently lose precision above 9 PB (per existing comment), and there's no alarm if a future upload exceeds this; also no SHA-256 of the original is stored — chain-of-custody auditing of "the bytes I uploaded" vs "the bytes the gallery served" is impossible

**Files:** `apps/web/src/db/schema.ts:53`, `apps/web/src/app/actions/images.ts:340-343`

Existing comment in `images.ts` acknowledges the precision risk. Not the audit's main concern. Bigger concern: no content hash of the original is computed, so "did the bytes change between upload and download?" is unanswerable. Editorial chain-of-custody workflows want SHA-256 in the DB.

**Fix:** add `original_sha256 varchar(64)` populated during streaming write to `UPLOAD_DIR_ORIGINAL`. Crypto.createHash piped through the same Readable.

---

### PHOTOG-LOW-6 — `process-topic-image.ts` strips ALL ICC and metadata for topic thumbnails (CM-LOW-2 noted). Pro photographer's portrait used as topic image has no IPTC contact info

**Files:** `apps/web/src/lib/process-topic-image.ts:67-72`

Topic thumbnails are always 512x512 WebP and have no metadata. Probably correct (thumbnails don't need IPTC), but flag.

**Fix:** None. Document the intent.

---

## Summary by Severity

| Severity | Count | Photographer-facing impact |
|---------:|---:|---|
| PRO-CRIT | 2 | Caption metadata abandoned at upload (PHOTOG-CRIT-1); Free download serves stripped derivative not photographer's bytes (PHOTOG-CRIT-2) |
| PRO-HIGH | 7 | GPS strip toggle is shallow (1); capture time loses sub-second + timezone (2); GPS auxiliaries silently dropped (3); lens model not normalized (4); silent timestamp shift by server TZ (5); EXIF parse errors swallowed (6); TIFF compression scheme not captured (7) |
| PRO-MED | 8 | Make column missing (1); IPTC/XMP not preserved on derivative export (2); No serial-preservation opt-in for news (3); DPI not captured or embedded in JPEG (4); Animated GIF/HEIC silent flatten (5); Multi-page TIFF silent flatten (6); Software EXIF dropped (7); user_filename not used in download attachment (8) |
| PRO-LOW | 6 | Makernotes (1); ICC name fingerprinting (2); Rendering intent (3); XMP sidecar (4); SHA-256 (5); Topic thumbnail metadata (6) |

## Files most affected

| File | PRO-CRIT | PRO-HIGH | PRO-MED |
|------|---:|---:|---:|
| `apps/web/src/lib/process-image.ts` | 2 | 6 | 5 |
| `apps/web/src/app/actions/images.ts` | 1 | 2 | 1 |
| `apps/web/src/app/api/admin/lr/upload/route.ts` | 1 | 1 | 0 |
| `apps/web/src/app/api/download/[imageId]/route.ts` | 0 | 1 | 1 |
| `apps/web/src/db/schema.ts` | 1 | 4 | 5 |
| `apps/web/src/components/photo-viewer.tsx` | 1 | 0 | 1 |
| `node_modules/exif-reader/*` (parser fidelity) | 0 | 1 | 0 |

## Recommended fix sequencing

1. **PHOTOG-HIGH-5 first** (TZ-shift bug). Single-line fix in `parseExifDateTime`, immediately corrects every `capture_date` write going forward. Add a `process.env.TZ='Asia/Seoul'` test to lock in.
2. **PHOTOG-HIGH-1** (GPS strip is shallow). Operator-facing security fix; rewrite original on disk when the toggle is on.
3. **PHOTOG-HIGH-6** (silent EXIF parse failures). Persist parse status, surface in admin.
4. **PHOTOG-CRIT-1** (IPTC/XMP read on upload). Largest schema/migration impact; do once a planning round has agreed on which fields to surface vs which to keep in a JSON blob.
5. **PHOTOG-CRIT-2** (free download serves re-encoded derivative). Decide: serve original bytes for free-tier (one route change) OR add `preserve_iptc_xmp_on_export` flag (touches encode chain in 3 branches).
6. **PHOTOG-HIGH-2** (sub-second + offset capture). After (1), this is the natural next step on `capture_date` precision.
7. **PHOTOG-MED-2 / 3** (per-tag preservation policy). Touches the encode chain; coordinate with PRO-CRIT-2 fix.
8. **PHOTOG-HIGH-3, MED-1, MED-4, MED-7** (additional schema fields: GPS aux, Make, DPI, Software). Bundle into a single migration round.
9. **PHOTOG-MED-5 / 6** (animated, multi-page detection). Surface a flag so the gallery at least *acknowledges* what was discarded.
10. PRO-LOW items per discretion.

## Cross-references with other reviews

- **Color review (`.context/reviews/color-mgmt/_aggregate.md`)** — already addresses CM-CRIT-1 (P3 wide-gamut tag mismatch), CM-HIGH-1 (sRGB tag), CM-HIGH-2 (EXIF leak via withMetadata({icc})), CM-HIGH-4 (autoOrient), CM-HIGH-5 (cache busting). Not re-flagged here.
- **Print review (separately requested)** — likely overlaps with PHOTOG-MED-4 (DPI). Coordinate findings.
- **Privacy review** — would intersect with PHOTOG-HIGH-1 (GPS strip on disk) and PHOTOG-MED-3 (serial number strip policy).
