# Pro Photographer Workflow Review

**Persona**: working pro photographer using ATIK.KR Photo Gallery as the public-facing portfolio + client-deliverable platform. Wedding shooter, editorial photographer, commercial product photographer, fine-art photographer.

**Out of scope**: color management (already audited at `.context/reviews/color-mgmt/_aggregate.md`; pixel-pipeline correctness is being fixed in-flight).

**Severity**:
- **PRO-CRIT** — daily-use blocker for working pros
- **PRO-HIGH** — frequent friction, costs hours per shoot
- **PRO-MED** — workaround exists but feels amateurish
- **PRO-LOW** — nice-to-have polish

A "Verdict vs SmugMug / Pixieset / PhotoShelter" call lives at the bottom.

---

## Findings index

| ID | Title | Severity |
|---|---|---|
| PP-CRIT-1 | No IPTC / XMP ingestion or persistence — every photo loses creator/copyright/headline | PRO-CRIT |
| PP-CRIT-2 | RAW upload allowlist is one-vendor-only (Sony `.arw`); Canon/Nikon/Adobe DNG/Fuji/Olympus all rejected at extension check | PRO-CRIT |
| PP-CRIT-3 | No Lightroom Classic plugin actually shipped — server endpoint exists but no `.lua` to install | PRO-CRIT |
| PP-CRIT-4 | No watermarking — public-facing AVIF/WebP/JPEG served without overlay; client-proofing is impossible without giving the photo away | PRO-CRIT |
| PP-CRIT-5 | No star rating / pick / reject / color-label fields — the universal Lightroom culling vocabulary is absent end-to-end | PRO-CRIT |
| PP-HIGH-1 | 200 MB hard cap rejects medium-format DNG and even some Z9 / R5 high-burst JPEGs; rejection UX shows generic toast, no progress bar | PRO-HIGH |
| PP-HIGH-2 | No Photo Mechanic / Capture One / Bridge integration; LR upload route is technically reusable but undocumented and lacks IPTC fields | PRO-HIGH |
| PP-HIGH-3 | Tags are a flat string set; no hierarchical IPTC keywords (`Wedding > Reception > First Dance`) | PRO-HIGH |
| PP-HIGH-4 | License model is fixed-enum `none / editorial / commercial / rm`; no CC, no per-image rights statement, no usage scope | PRO-HIGH |
| PP-HIGH-5 | No download tier presets — client always gets the full-res JPEG derivative; no "1200px web", no "print 300 DPI", no "Instagram square" | PRO-HIGH |
| PP-HIGH-6 | Admin reactions visibility is one-way — visitor likes accumulate but admin cannot list "all photos liked by visitor X" or export client picks | PRO-HIGH |
| PP-HIGH-7 | No burst / stack / sequence model — 200-frame goal celebration shows as 200 individual masonry tiles | PRO-HIGH |
| PP-HIGH-8 | No print-grade output: density / DPI is never written to derivatives; original color space tag preserved only for AVIF wide-gamut path | PRO-HIGH |
| PP-HIGH-9 | Critical viewing UI lacks 1:1 native-pixel zoom — `image-zoom.tsx` zooms in viewport-relative units; no focus-check, no clipping warning on histogram | PRO-HIGH |
| PP-HIGH-10 | No HDR gain-map preservation; iPhone 14 Pro+ HDR Photos lose their gain map on every upload | PRO-HIGH |
| PP-MED-1 | Bulk operations are limited (topic / title prefix / description / license / add tags / remove tags); no bulk rate / pick / set capture date / set location | PRO-MED |
| PP-MED-2 | Re-edit / re-publish over an existing image record is not supported; new upload = new ID = broken embeds and shared-link breakage | PRO-MED |
| PP-MED-3 | Searchability is admin-invisible — schema indexes capture_date but UI exposes no date-range picker, no camera/lens/ISO filter, no rating filter | PRO-MED |
| PP-MED-4 | No quick-rate / label keyboard shortcut in photo viewer for admin culling | PRO-MED |
| PP-MED-5 | Admin upload preview shows 2/3-column grid only — no contact-sheet view at 200+ frames | PRO-MED |
| PP-MED-6 | Visitor-created shared groups (favorites) are admin-creatable but not visitor-creatable; client picks ride on the like/reaction system that is anonymous-day-bucketed | PRO-MED |
| PP-LOW-1 | License copy uses "rm" as a UI-facing string — non-photographers won't know it's "Rights-Managed" | PRO-LOW |
| PP-LOW-2 | Korean place-name round-trip is not modelled because there is no IPTC location field at all (downstream of PP-CRIT-1) | PRO-LOW |
| PP-LOW-3 | Print/proof watermark setting absent (downstream of PP-CRIT-4) | PRO-LOW |

---

## Detailed findings

### PP-CRIT-1 — IPTC / XMP completely absent from the pipeline

**Files**:
- `apps/web/src/lib/process-image.ts:107-148` (`ExifDataRaw` interface — only EXIF fields modelled, no IPTC interface)
- `apps/web/src/lib/process-image.ts:737-846` (`extractExifForDb` — extracts only `capture_date`, `camera_model`, `lens_model`, `iso`, `f_number`, `exposure_time`, `focal_length`, `latitude`, `longitude`, `color_space`, `white_balance`, `metering_mode`, `exposure_compensation`, `exposure_program`, `flash`, `bit_depth` — no `creator`, `byline`, `copyright`, `credit`, `source`, `headline`, `caption_writer`, `instructions`, `transmission_reference`, `rights_usage_terms`, `keywords`, `subject_codes`, `category`, `city`, `country`, `country_code`, `province_state`, `sublocation`, `urgency`, `intellectual_genre`, `scene_codes`, `iptc_subject_codes`)
- `apps/web/src/db/schema.ts:19-79` (`images` table — confirms no IPTC columns exist)
- `apps/web/src/lib/process-image.ts:560-661` (encode chain — uses `withIccProfile()` for ICC bit only; IPTC/XMP source bits are stripped on every derivative)

**Failure scenario**: Gemma is delivering a 600-photo Tokyo Travel Editorial to The Guardian. Her Lightroom export carries IPTC `Creator = "Gemma Roberts"`, `CopyrightNotice = "© 2026 Gemma Roberts / All Rights Reserved"`, `Credit = "Gemma Roberts for The Guardian"`, `Headline` per photo, `City = "Tokyo"`, `Country = "Japan"`, hierarchical keywords (`Travel > Asia > Japan > Tokyo > Shibuya`). She uploads. Every photo arrives at the picture desk with empty `creator`, no copyright string, no caption, no keywords, no IPTC location — because the pipeline never extracted them, never stored them, and `withIccProfile()` strips IPTC/XMP from the served derivatives. The picture desk's automation that file-renames using `Creator-City-Headline.jpg` fails. Picture editor manually re-keys 600 photos. Gemma gets an angry call. She moves to PhotoShelter (which is built on IPTC-first data model) on Monday.

**Concrete evidence**: The grep for `iptc|copyright|byline|creator|headline|keywords` in `process-image.ts` returned zero matches. `exif-reader` is the only metadata reader used (`process-image.ts:2`); it does NOT parse IPTC / XMP. Sharp can read XMP via `sharp().metadata().xmp` but the code never calls it.

**Fix**:
1. Add an IPTC parser pass (e.g. `node-iptc` or a hand-rolled IIM parser over the JPEG APP13/Photoshop 3.0 segment) and an XMP parser (e.g. `xml2js` over the XMP packet).
2. Extend the `images` schema with at minimum: `creator`, `creator_email`, `copyright_notice`, `credit_line`, `source`, `rights_usage_terms`, `headline`, `caption_writer`, `instructions`, `transmission_reference`, `iptc_keywords` (TEXT, newline-separated for hierarchical), `city`, `province_state`, `country`, `country_code`, `sublocation`, `intellectual_genre`, `scene_codes`. Schemes are well-defined by IPTC IIM 4 / XMP-PhotoMetadata.
3. Preserve IPTC/XMP on derivatives — this needs `withMetadata({iptc: ..., xmp: ...})` careful merge OR stripping IPTC EXIF only and re-injecting a curated subset (the sales-aware subset must hide internal admin notes).
4. Surface in the photo viewer info panel.
5. Surface in the LR upload route's `formData` accepted fields (currently only `title`, `description`, `topic` — `lr/upload/route.ts:70-83`).

**Severity**: PRO-CRIT — every editorial / agency / wire-service / commercial pro relies on IPTC for everything from automated filenaming to legal copyright tracking. This is "the field" that pros assume is always there. SmugMug / PhotoShelter / Pixieset all model it.

---

### PP-CRIT-2 — RAW allowlist is Sony-only

**File**: `apps/web/src/lib/process-image.ts:71-73`

```javascript
const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.arw', '.heic', '.heif', '.tiff', '.tif', '.gif', '.bmp'
]);
```

**Missing**: `.cr2` (Canon), `.cr3` (Canon mirrorless), `.nef` (Nikon), `.dng` (Adobe Digital Negative — universal interchange format!), `.orf` (Olympus / OM System), `.pef` (Pentax), `.raf` (Fujifilm), `.rw2` (Panasonic), `.x3f` (Sigma Foveon), `.iiq` (Phase One), `.3fr` (Hasselblad), `.fff` (Hasselblad), `.mef` (Mamiya), `.mrw` (Minolta), `.srw` (Samsung), `.kdc` (Kodak).

The dropzone client at `apps/web/src/components/upload-dropzone.tsx:163` has the same Sony-only list. Drop a `.cr3` in: rejected at the client. Drop it via `lr/upload/route.ts`: rejected at `getSafeExtension` (`process-image.ts:100`) with `"File extension not allowed: .cr3"`.

**Failure scenario**: Marcus is a Canon-shooting wedding photographer. He buys an R5 (his shooting body emits `.cr3`). His existing portfolio is on a self-hosted ATIK gallery. Day one of the new body, he tries to upload his test shots: every file rejected with no explanation of why. He files a GitHub issue, watches it sit, and migrates to Pixieset in 48 hours.

Even worse: the photographer who *does* shoot Sony but whose primary deliverable is a `.dng` (because Capture One emits DNG when its native CO format isn't desired) is also locked out — DNG is the universal RAW format Adobe ships specifically as the cross-vendor pivot, and it isn't here.

**Note about Sharp/libvips support**: Sharp can decode many RAW formats via libvips' libraw integration when libvips is built with `--with-libraw`. The prebuilt binaries from `sharp` npm don't include libraw. Even adding the extensions to the allowlist won't make the pipeline work without rebuilding Sharp or routing RAW through `dcraw` / `darktable-cli` / `libraw` first.

**Fix**:
- Short-term: add `.dng` to the allowlist (DNG is a TIFF extension; libvips CAN read embedded JPEG previews and the full image via TIFF reader for many DNGs).
- Medium-term: ship a side-car RAW preprocessor (e.g. `dcraw_emu` or `libraw-bin` invoked before Sharp) that emits a 16-bit linear TIFF for the rest of the pipeline. Mark the original as RAW source in `original_format` so the served derivatives can carry "From RAW" pedigree.
- Surface a clear UX message: "RAW format detected. Processing may take longer." with a per-format size hint.

**Severity**: PRO-CRIT — a portfolio gallery that won't accept your camera's native files is a non-starter. Pros aren't going to convert to JPEG just to upload to your gallery.

---

### PP-CRIT-3 — Lightroom Classic plugin doesn't actually exist on disk

**Evidence**:
- `apps/web/src/db/schema.ts:151-168` (`adminTokens` comment claims "Lightroom Classic publish plugin")
- `apps/web/src/app/api/admin/lr/upload/route.ts` (single file — server endpoint only)
- `apps/web/src/lib/admin-tokens.ts` (token plumbing only)
- `glob('**/*.lua')` returned zero matches.
- `glob('apps/web/src/app/api/admin/lr/**/*')` returned only `upload/route.ts` — no `delete`, no `re-publish`, no `status`, no `list`, no `metadata`.

**Failure scenario**: David is a destination wedding photographer. He sees "Lightroom Classic publish plugin" in the marketing copy and migrates 12,000 historical wedding photos out of SmugMug. After migration he opens Lightroom, looks for the GalleryKit publish service to install — there is no `.lrplugin` package shipped with the repo. He searches GitHub releases. Nothing. He files an issue. Repo maintainer (you) explains "the plugin isn't built yet, the API is ready though." David has no way to publish from Lightroom because there is no plugin. He has manually drag-dropped 600 photos via the web UI today and stops bothering with the rest. He's writing a one-star review.

**What a real LR Publish plugin needs**: `Info.lua` (manifest), `PublishServiceProvider.lua` (`processRenderedPhotos`, `metadataThatTriggersRepublish`, `goSupportsCustomSortOrder`, `deletePhotosFromPublishedCollection`, `viewForCollectionSettings`, `endDialogForCollectionSettings`), `PublishSettingsViewModel.lua` (settings dialog), `GalleryKitAPI.lua` (HTTP wrapper around the upload endpoint with token auth), localization strings, plugin icon. None exists.

**Additional gaps even if plugin were shipped**:
- Re-publish: the upload route always inserts a new `images` row (`route.ts:134`). LR's publish model expects re-publish to UPDATE an existing remote ID. There is no `lr/update` or `lr/republish` endpoint.
- Delete: no `DELETE /api/admin/lr/[id]` endpoint exists.
- Smart Preview support: LR's smart-preview workflow expects the publish target to accept the smart preview as a valid render. The route accepts any file ≤ 200 MB, so this works incidentally but isn't documented.
- Metadata round-trip: even if the plugin sent `xmp:dc:creator`, the server doesn't parse it (PP-CRIT-1).
- Export-preset selection: not modelled — the server runs its own AVIF/WebP/JPEG pipeline regardless of LR's export preset.

**Fix**: Either
1. Ship the plugin (a 200-line `.lrplugin` is the bare minimum for a Publish service; LR SDK is well-documented), or
2. Remove "Lightroom Classic publish plugin" from the schema comment and `lr-tokens.ts` documentation. Today the docs over-promise.

**Severity**: PRO-CRIT — cited as a feature, doesn't exist.

---

### PP-CRIT-4 — No watermarking, anywhere

**Evidence**: Grep for `watermark|overlay|composite` (case-insensitive) returned no functional hit. The matches that came back are unrelated:
- `apps/web/src/components/lightbox.tsx` — uses `composite` only as a Tailwind blend-mode class.
- `apps/web/src/components/ui/{sheet,dialog,alert-dialog}.tsx` — overlay backdrops, not image overlays.
- `apps/web/src/lib/upload-tracker.ts`, `data-timeline.ts`, `histogram.tsx`, `__tests__/touch-target-audit.test.ts` — unrelated DOM overlay vocabulary.
- `apps/web/src/app/api/og/photo/[id]/route.tsx` — Open-Graph image generation, no watermark.

The Sharp pipeline at `process-image.ts:560-661` builds AVIF/WebP/JPEG with NO `.composite()` call. There is no admin setting for watermark image, opacity, position, or per-tier application.

**Failure scenario**: Sarah is a wedding photographer running a private proofing gallery for her client (a $15,000 wedding). She wants the client to see all 600 photos to pick favorites, then deliver only the chosen 200 at full-res. Today the pipeline serves `/uploads/jpeg/{uuid}.jpg` — full-resolution JPEG — to anyone with the `/g/{key}` shared-group link. The client's brother saves all 600 photos via right-click. Sarah loses the upsell on the prints package because the family already has print-quality JPEGs. She moves to Pixieset, which watermarks proofing galleries and only un-watermarks after payment.

**Fix**:
1. Add `watermark_filename`, `watermark_opacity`, `watermark_position`, `watermark_size_pct` to `admin_settings`.
2. Add an optional `watermark_tier` per derivative bucket (e.g. JPEG public = watermarked, JPEG download-via-entitlement = unwatermarked).
3. In `processImageFormats`, after `.resize()` and before encoder, optionally `.composite([{ input: watermarkPath, gravity: 'southeast', blend: 'over' }])`.
4. Per-image override: `images.watermark_override` (`'inherit' | 'force_on' | 'force_off'`).
5. Per-shared-group override: `shared_groups.watermark_mode` (`'none' | 'subtle' | 'overlay'`).
6. Critically: the entitlement download path at `apps/web/src/app/api/download/[imageId]/route.ts` should serve the unwatermarked original.

**Severity**: PRO-CRIT — proofing without watermark is broken proofing. Every paid platform in this space (SmugMug, Pixieset, ShootProof, Cloudspot, Pic-Time) ships watermarking on day 1.

---

### PP-CRIT-5 — No star rating, pick/reject, or color label fields

**Evidence**: Grep for `rating|stars|pick|reject|color_label|colorLabel|flag` (case-insensitive) on `apps/web/src/db/schema.ts` returned zero matches inside the `images` table definition. The matches it returned are about: visitor reactions (boolean like), upload rejection (file rejection), reaction `flag` (boolean like), bulk-edit dialog `mode flag`. None of them is the Lightroom 0-5 star scale, the P/X pick/reject flag, or the red/yellow/green/blue/purple color label.

These are universal shorthand:
- Stars 0-5 — quality grade. Lightroom default.
- Pick (P) / Reject (X) / Unflagged — culling state. Lightroom default keyboard shortcuts.
- Color label red/yellow/green/blue/purple — workflow state. Often: red = needs retouch, yellow = client review, green = approved, blue = delivered, purple = archive.

**Failure scenario**: Yuki is a fashion photographer. After a 2-day editorial shoot, she has 2,400 frames. Her standard cull workflow:
- First pass: X reject the obvious misses (eyes closed, motion blur, expression off). Cuts to ~1,800.
- Second pass: rate the remaining: 1 star = OK, 3 stars = portfolio-grade, 5 stars = hero shot. By stars: ~30 5-star, ~120 3-star, rest 1-star.
- Third pass: filter to 3-star+, color-label green for client picks (~60).
- Deliver: filter green only.

She tries this in ATIK. There are no rating fields. She uses tags instead: tag 5-star → tag 3-star → tag green. But:
- Tags are flat (PP-HIGH-3) so `5-star` and `3-star` are siblings.
- Tag UI requires typing the tag name; LR has 1-5 number keys, P, X, 6-9 for color labels — keystroke-per-photo workflow.
- Filtering by tag exists in smart-collections (`smart-collections.ts`) but not in the admin image manager UI as a quick filter.

She abandons her workflow and just delivers everything. Client sees 1,800 photos and gives up.

**Fix**:
1. Schema: `images.rating` (TINYINT 0-5), `images.pick_flag` (ENUM `'unflagged' | 'pick' | 'reject'`), `images.color_label` (ENUM `'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple'`).
2. Photo viewer keyboard shortcuts: `0-5` = rating, `P` / `X` / `U` = pick/reject/unflag, `6-9` = color labels (matches LR).
3. Admin image manager filter: rating range, color label, pick flag.
4. Bulk edit: extend `bulk-edit-types.ts:14-24` with rating/pick/color_label fields.
5. Surface in IPTC export — IPTC `urgency` (1-8) maps to LR rating; IPTC has a custom XMP-photoshop:ColorMode for color label.

**Severity**: PRO-CRIT — culling 2,000 photos without these fields takes 4× longer. This is the daily workflow for every event / wedding / sports / fashion shooter.

---

### PP-HIGH-1 — 200 MB hard cap and rejection UX

**Files**:
- `apps/web/src/lib/process-image.ts:75` — `MAX_FILE_SIZE = 200 * 1024 * 1024`
- `apps/web/src/lib/upload-limits.ts:3` — `MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024`
- `apps/web/src/components/upload-dropzone.tsx:46` — client default

200 MB is fine for normal full-frame mirrorless RAW (45-megapixel R5 RAW = ~50 MB; Z9 RAW = ~60 MB). It rejects:
- **Phase One IQ4 150 MP**: ~280 MB IIQ + ~600 MB DNG export. Phase One shooters shoot fashion editorial / commercial product / luxury. Rejected.
- **GFX 100S 16-bit RAF**: 100-200 MB depending on compression. Marginal, often rejected.
- **Stitched panoramas**: 200 MP+ TIFF from a 6-row stitched landscape pano = 1.5+ GB. Rejected.
- **High-bit-depth scans from drum scanners**: medium-format 6×7 negative scanned at 4000 DPI 16-bit RGB TIFF = 800 MB+. Rejected.

**Rejection UX**:
- Client side, `upload-dropzone.tsx:133-152` — files over `maxFileBytes` are silently dropped from `acceptedFiles` and the rejection-count toast says "Some files exceeded the limit." That's it. No filename listed, no per-file reason.
- Server side, `process-image.ts:417-419` — throws `File too large. Maximum size is 200MB`. The action wraps it and the user sees "Upload failed" via toast.
- For an admin uploading a 600-photo batch including a couple of 250 MB IIQ files, the client filter silently drops them; no upload progress indicator on the surviving files (see below); no ability to know which files were dropped without manually counting before/after.

**Streaming-upload progress**: The dropzone uses `react-dropzone` and `formData.append('files', file)` posted via `uploadImages` server action (`upload-dropzone.tsx:202-216`). There is no `XMLHttpRequest.upload.onprogress` or fetch streaming progress. The UI progress bar (`upload-dropzone.tsx:54, 188, 364-379`) only counts COMPLETED files, not bytes-in-flight. For a single 80 MB Canon R5 RAW upload over 30 Mbps consumer Wi-Fi (~22 seconds), the user sees:
- Progress bar at 0% for 22 seconds.
- Then immediately jumps to 100% when the server action returns.

This looks frozen. Pros uploading 100 photos × 60 MB each see 100 jumps from 0 to 1%, no in-between. They will reload the page mid-upload thinking it's stuck.

**Failure scenario**: Liam, fashion photographer, completes a Phase One IQ4 150 MP studio shoot. ~120 IIQ files, 250-400 MB each. He drags them into ATIK. Client side silently drops all of them. He retries with Capture One DNG export at 200 MP — still 280-350 MB each — silently dropped. He compresses to JPEG (defeating the purpose of shooting medium format) — most fit; some don't. He moves to PhotoShelter (no per-file size limit on Pro plan) before lunch.

**Fix**:
1. Make the cap an admin setting, not a hard-coded constant.
2. Document that processing 600 MB DNG requires a server with >2 GB RAM (Sharp peaks at ~3× pixel count × 16-bit on the wide-gamut path).
3. Wire `XMLHttpRequest.upload.onprogress` (server actions don't natively support it; either use a custom POST endpoint at `api/admin/upload` that returns progress events, or add chunked upload with a resumable protocol like tus.io).
4. List rejected filenames + per-file reason in the toast / a sidebar panel.

**Severity**: PRO-HIGH — daily friction for any pro on consumer Wi-Fi or shooting medium format.

---

### PP-HIGH-2 — Capture One / Photo Mechanic / Bridge integrations

**Files**:
- `apps/web/src/app/api/admin/lr/upload/route.ts:60-127` — accepts `file`, `topic`, `title`, `description` only (`route.ts:60, 65, 70, 77`).

The endpoint is technically reusable as a generic "upload via PAT" surface — Photo Mechanic's "publish to URL" plugin or a Bridge AppleScript could POST to it. But:

1. The accepted form fields are minimal (`title`, `description` — see PP-CRIT-1: no IPTC). Pro tools that POST IPTC payloads have nowhere to put them.
2. The route is undocumented — no `apps/web/docs/api/lr-upload.md`. Nothing beyond the docstring at `route.ts:1-17`.
3. The auth scope is hardcoded `lr:upload` (`route.ts:170`). A Photo Mechanic plugin would require the same scope but the name suggests Lightroom-only.
4. There is no `GET /api/admin/lr/topics` or similar — to know which topic slug to use, the integrator needs out-of-band knowledge.
5. There is no `GET /api/admin/lr/images/[id]` to verify the upload succeeded with the intended metadata.

**Failure scenario**: Aiko is a sports photographer. Her workflow is Photo Mechanic (cull + IPTC) → publish direct to web. She wants to point Photo Mechanic's "Send to Server" feature at ATIK. She finds `/api/admin/lr/upload`, gets it working — but Photo Mechanic posts IPTC byline / caption / keywords as multipart fields named `byline`, `caption`, `keywords` per the Photo Mechanic FTP/HTTP plugin spec. The route silently ignores those fields. Her upload-time metadata is lost. She can either set everything in PM and then re-set everything in ATIK admin (unacceptable), or move to PhotoShelter (PM-native).

**Fix**:
1. Rename the API surface to `/api/admin/upload` (vendor-neutral), keep `/api/admin/lr/upload` as a deprecated alias.
2. Accept IPTC fields in the multipart body with documented names.
3. Add `GET /api/admin/topics` (already a simpler version exists publicly; admin form needs PAT auth).
4. Add `GET /api/admin/images/[id]` for verification.
5. Publish an OpenAPI spec at `/openapi.json` so integrators can self-discover.

**Severity**: PRO-HIGH — Photo Mechanic / Capture One are the two most common pro culling/editing tools after Lightroom. Locking them out shrinks the addressable user base materially.

---

### PP-HIGH-3 — Tags are flat, not hierarchical

**File**: `apps/web/src/db/schema.ts:81-93`

```javascript
export const tags = mysqlTable("tags", {
    id: int("id").primaryKey().autoincrement(),
    name: varchar("name", { length: 255 }).notNull().unique(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
});
```

No `parent_id`, no `path`, no `materialized_path`, no `nested_set` column. Tags are a flat namespace.

**Pro convention**: IPTC keywords are hierarchical. LR's keyword pane:
```
Wedding
  Ceremony
    Vows
    Ring exchange
    First kiss
  Reception
    First dance
    Cake cutting
    Toast
  Portraits
    Couple
    Family
    Bridal party
```

When Sarah tags a photo with "First dance", LR's hierarchical IPTC writer outputs:
```
Iptc4xmpCore:Hierarchy = "Wedding|Reception|First dance"
dc:subject = ["Wedding", "Reception", "First dance"]
```

So a search for "Reception" finds all photos including "First dance" / "Cake cutting" / "Toast". A search for "Wedding" finds everything. ATIK's flat tags require explicitly tagging with EVERY level — admin must manually add `wedding`, `reception`, AND `first-dance` to every photo to get the same browsability. For 600 photos, that's 1,800 tag operations.

The bulk tag UI at `apps/web/src/components/bulk-edit-dialog.tsx:298-322` lets you "add tags" / "remove tags" but does not auto-expand a hierarchy.

**Failure scenario**: Sarah uploads 600 wedding photos and bulk-tags 200 with `reception`. She uploads next month's wedding and forgets about `reception` — she just tags `cake-cutting`. Now searching for `reception` misses the new wedding's cake-cutting photos. Her portfolio site's "Reception" smart-collection silently rots.

**Fix**:
1. Schema: `tags.parent_id INT REFERENCES tags(id)` + a derived `tags.path` cached column for fast prefix queries.
2. Tag UI in admin: tree view with drag-to-reparent.
3. Tag input: typing `Reception` auto-suggests `Wedding > Reception`.
4. Search: tag prefix-match expands to children.
5. IPTC export carries `Iptc4xmpCore:Hierarchy` correctly.

**Severity**: PRO-HIGH — every IPTC-aware tool ships hierarchical keywords. Flat tags are amateurish.

---

### PP-HIGH-4 — License model is fixed-enum and English-only

**Files**:
- `apps/web/src/db/schema.ts:54-55` — `license_tier varchar(16) notNull default('none')`
- `apps/web/src/lib/bulk-edit-types.ts:5-6` — `LICENSE_TIERS = ['none', 'editorial', 'commercial', 'rm']`
- `apps/web/src/lib/license-tiers.ts:17` — paid tiers are `editorial | commercial | rm`

Missing license modes that pros routinely use:
- **CC0** / public domain
- **CC-BY** (attribution)
- **CC-BY-NC** (non-commercial)
- **CC-BY-NC-ND** (non-commercial, no derivatives)
- **CC-BY-SA** (share-alike)
- **All Rights Reserved** (no sale, no use — common for portfolio pieces)
- **Editorial Use Only — Inquire**
- **Commercial Use — Inquire** (no auto-purchase)
- **Custom** — per-image rights statement (the IPTC `RightsUsageTerms` field)

Photographers also don't all sell. Many use a portfolio site as a marketing surface for inquiry-driven licensing. A pure portfolio gallery with "All Rights Reserved" + an inquiry CTA must be possible without mapping every photo to a Stripe SKU.

**Failure scenario**: Carolina runs a fine-art portfolio. Most photos are "All Rights Reserved, contact for licensing." Some are public-domain Wikimedia uploads (CC0). She wants the photo viewer to show the right license badge under each photo and the right CTA. ATIK lets her set `none` or `editorial` or `commercial` or `rm`. None of those mean "ask me." None of them mean CC0. She types "All Rights Reserved — contact for licensing" into the photo description manually for every one of 200 photos.

**Fix**:
1. Schema: `license_tier ENUM(...)` extended OR move to a free-text `license_type` + structured `license_url` (Creative Commons license URLs are well-defined identifiers).
2. Add `images.rights_usage_terms TEXT` (IPTC `RightsUsageTerms` round-trip).
3. Photo viewer: render a license badge with a tooltip from a known license-type → label/URL map.
4. Make Stripe-purchasable a separate boolean — `images.is_purchasable` — orthogonal to the license type.
5. Localize license labels (currently `licenseTier_none` etc. in `messages/{en,ko}.json`).

**Severity**: PRO-HIGH — pros routinely mix license types in one portfolio. The current 4-state enum forces them to either misrepresent licensing or skip the field.

---

### PP-HIGH-5 — No download-tier preset system

**File**: `apps/web/src/components/photo-viewer.tsx:223, 844-855`

The "Download JPEG" button on a public photo serves `/uploads/jpeg/{filename_jpeg}` — that's the largest configured size, no choice (`photo-viewer.tsx:224`). On a wedding gallery the visitor either gets the full pipeline JPEG (which is the max output size, often 4096 px) or nothing.

The post-purchase entitlement download at `apps/web/src/app/api/download/[imageId]/route.ts` serves the *original* uploaded file (the `.cr3` / `.dng` / `.tif` etc.), not a print-prepared TIFF.

**Pro deliverable patterns missing**:
- "Web JPEG 1200 px sRGB"
- "Print TIFF 300 DPI ProPhoto" (full-res with print intent)
- "Instagram square 1080×1080"
- "Print TIFF 16-bit Adobe RGB"
- "Proofing watermarked 800 px"

Each of these is a different combination of (size, format, color space, watermark, DPI tag, IPTC subset). Today the pipeline emits one matrix: AVIF + WebP + JPEG, all sRGB / sometimes P3, at the `imageSizes` array (configured via admin settings).

**Failure scenario**: Hiroshi sells fine-art prints. Buyer wants to download a print-ready TIFF (16-bit Adobe RGB, 300 DPI) after Stripe purchase — that's the deliverable for their home printer. ATIK delivers the original uploaded file: an 8-bit ProPhoto TIFF the photographer exported from Capture One. The buyer opens it, prints it on a Canon Pro-300, gets a color-shifted print because their printer profile is for Adobe RGB, not ProPhoto. Refund request. Hiroshi switches to FineArtAmerica.

**Fix**:
1. Add a `download_presets` table: `(id, label, max_width, format ENUM('jpeg','tiff','png','webp'), color_space ENUM('srgb','adobergb','prophoto','displayp3'), bit_depth, dpi, watermark_mode, iptc_strip)`.
2. Per-license-tier or per-shared-group: which presets are available.
3. Photo viewer / lightbox: a download dropdown showing the available presets.
4. Pipeline: extend `processImageFormats` to emit these on demand (cached lazily), or pre-bake a small set during upload.

**Severity**: PRO-HIGH — pros price print-quality output differently from web-quality, and treating them the same gives away the high-margin product.

---

### PP-HIGH-6 — Reactions are admin-blind in aggregate

**Files**:
- `apps/web/src/db/schema.ts:173-181` — `image_reactions` table.
- `apps/web/src/app/api/reactions/[imageId]/route.ts` — reaction endpoint.
- `apps/web/src/components/photo-viewer.tsx:131-180` — reaction toggle.
- `apps/web/src/db/schema.ts:170-171` (comment) — `visitor_id_hash = SHA-256(visitor_uuid + YYYY-MM-DD)`.

Two design choices fight client-proofing:

1. **Daily salt rotation**: `visitor_id_hash` includes `YYYY-MM-DD` in the salt. So a visitor who likes a photo today and a different photo tomorrow has TWO different hashes — the system cannot identify "this visitor's complete favorites list." For a wedding client picking favorites over a week, the per-day visitor view is unbuildable.

2. **No admin reaction view**: there is no admin route that lists "reactions per image" or "all images liked by a given visitor today." The image manager (`apps/web/src/components/image-manager.tsx:53-63`) has no `reaction_count` column. The dashboard probably aggregates totals, but per-image is invisible at the admin grid.

**Failure scenario**: Marcus delivers a 400-photo wedding to the Smith family. They click hearts on 80 photos as their pick list. Marcus opens admin to export the picks list — there's no UI for it. He runs a SQL query manually:
```sql
SELECT image_id, COUNT(*) FROM image_reactions GROUP BY image_id ORDER BY 2 DESC;
```
That gives him aggregate likes per photo across all visitors over all time. But the Smiths' specific picks vs their second cousin twice removed who happened to look? Indistinguishable due to daily salt rotation. He can't deliver "the Smiths' 80 picks" — he has to ask the Smiths to email them.

**Fix**:
1. Per-shared-group reactions: a separate `shared_group_picks` table where `visitor_id_hash` is salted by `shared_group.key` instead of `YYYY-MM-DD`. This keeps anonymous visitors' privacy across the public site but lets a shared-group session aggregate one visitor's picks across days.
2. Admin "Picks" view per shared group: list of `(visitor_hash, image_id, picked_at)` filterable by the group's date window.
3. Export "all photos liked by visitor X" as a downloadable list for delivery.
4. Visitor-side: a "My picks" gallery view for the shared group (which photos this visitor hearted).

**Severity**: PRO-HIGH — the proofing-and-pick workflow is the single most differentiated feature in client-photographer SaaS (Pixieset, ShootProof, Pic-Time all do it well). The current implementation is anonymous social hearting, not client picks.

---

### PP-HIGH-7 — No burst / stack / sequence model

**Evidence**: Grep for `stack|burst|series|sequence_id|parent_image` (case-insensitive) in `apps/web/src/db/schema.ts` returned no matches inside the `images` table. The matches that came back are about: tag manipulation, bulk-edit "stack" (UI flex term), seq-numbered rate limit buckets, etc.

There is no `images.stack_id` or `images.parent_image_id` or `images.sequence_position` or `images.stack_role ENUM('top','child')`.

**Pro convention**: Lightroom auto-stacks bursts (continuous 12 fps from a Canon R3 / Z9 / a1 = 12 frames/second, so 5-second goal celebration = 60 frames). A stack hides 59 of them under one representative (manually picked or auto-picked). The masonry / contact-sheet view shows ONE thumbnail with a "60" badge.

**Failure scenario**: Andre is a sports photographer covering an FA Cup match. Goal celebration: 5 seconds × 30 fps (Z9 H+ mode) = 150 frames. He uploads. The masonry grid renders 150 individual photos of nearly-identical jubilant goalscorers. The visitor scrolls 4 phone-screens of duplicate poses. Bounces.

**Fix**:
1. Schema: `images.stack_id INT NULL`, `images.stack_role ENUM('top', 'child') DEFAULT 'top'` with index on `(topic, stack_id, stack_role, capture_date)`.
2. Server query for masonry: filter `WHERE stack_role = 'top' OR stack_id IS NULL`.
3. Photo viewer: when viewing the stack-top, expose "Browse 60 frames in this stack."
4. Auto-stack on upload: group by `(topic, capture_date within 1.5s, camera_model)` heuristic.
5. Manual stack/unstack UI in admin.

**Severity**: PRO-HIGH — sports / wildlife / wedding shooters working at burst are blocked.

---

### PP-HIGH-8 — Print-grade output: no DPI, original color space sometimes preserved

**Files**:
- `apps/web/src/lib/process-image.ts:565-661` — encode chain — no `.withMetadata({density: 300})` call anywhere.

`Sharp.density` defaults to 72 DPI on JPEG output. Print-grade output typically sets 300 DPI (or stamps the metadata at least, even if the raster size is the determining factor at print time). Photoshop's "Image Size" dialog reads this DPI tag. A print bureau's automatic ICC-aware printer driver checks it.

The grep for `density|dpi|XResolution` against `process-image.ts` returned zero matches.

**Failure scenario**: Buyer pays via Stripe for a "commercial" license, downloads, opens in Photoshop. Image Size dialog shows 72 DPI. Buyer assumes the file is web-quality only and asks for a print-quality re-export. Photographer manually re-exports from LR, emails. Two more email round-trips.

For ICC: AVIF wide-gamut path tags P3 correctly (post the recent CM-CRIT-1 fix). JPEG / WebP output is sRGB-tagged (correct for web). But for the entitlement download path (post-purchase) at `/api/download/[imageId]/route.ts` — it serves the ORIGINAL uploaded file, which retains whatever color space the uploader gave it. The buyer doesn't know what color space they got, and the download doesn't tell them.

**Fix**:
1. Add `density: 300` to the JPEG encoder for the largest size variant.
2. Per-tier preset (PP-HIGH-5) declares its own density.
3. Show original color space in the entitlement download UX so buyers know what they're getting.

**Severity**: PRO-HIGH — print buyers are a high-margin segment and serving them 72 DPI screams amateur.

---

### PP-HIGH-9 — Critical viewing UI lacks 1:1 zoom

**Files**:
- `apps/web/src/components/image-zoom.tsx` (full file).
- `apps/web/src/lib/image-zoom-math.ts` (helpers).

The zoom uses `transform: scale(level) translate(...)` (`image-zoom.tsx:64-67`). `level` is bounded by `clampZoom` from `image-zoom-math.ts` — bounds I'd need to read to confirm, but the API is `MIN_ZOOM = 1`, `DEFAULT_ZOOM = ?` from the imports at line 6. The transform scales the rendered DOM size, not the image's NATIVE pixel size. So when the photo is rendered at 1024 px wide and scaled 4×, the user sees 4096 device-pixels of a photo that natively is 6720 px wide. They are seeing 4096 / 6720 = 60% of native pixels. Pixel-peeping focus / sharpness is impossible from this view.

A 1:1 zoom should display 1 photo pixel = 1 device pixel. That requires either:
- Zoom level dynamically computed from `image.width / containerRect.width`, OR
- Switch to the largest source size (not the size-binned source) when entering 1:1 mode.

Neither happens.

**Other missing critical-viewing features**:
- **Focus-check**: jump to the EXIF AF point. Modern bodies write `Exif.FocalPlaneFocusPoint` or vendor-specific tags (Canon, Sony A1). Not parsed.
- **Histogram clipping warning**: `histogram.tsx:143-211` draws the histogram correctly but never highlights the 0-value or 255-value bins as clipped. LR-style is to overlay a red/blue band on the photo where pixels clip; minimum is to colour the leftmost / rightmost histogram bin red when count > threshold.
- **Camera-feedback overlay**: lens vignetting compensation status, focal length / aperture overlay, AF type. None.

**Failure scenario**: Andre delivers 200 sports photos. Picture editor at the agency wants to verify focus on each frame before licensing. They click into the photo viewer, double-tap, see a fuzzy zoom that's NOT 1:1. They can't tell if the player's eye is in focus or not. They reject the entire delivery as "unverifiable focus." Andre re-delivers via Dropbox.

**Fix**:
1. Add a "100%" / "1:1" zoom button that computes target zoom as `image.original_width / displayed_width`.
2. In 1:1 mode, switch the `<img>` src to the largest available size (or even the original via the entitlement path for admins).
3. Add clipping highlights to histogram.
4. Surface a per-photo focus-confidence indicator if AF point EXIF is present.

**Severity**: PRO-HIGH — agency / editorial / commercial workflows depend on focus verification. Without 1:1, ATIK is a portfolio toy, not a professional delivery surface.

---

### PP-HIGH-10 — HDR gain map not preserved

**Evidence**: Grep for `gain_map|gainmap|gain map|hdr_metadata|HDR` against `apps/web/src` returned only matches in `apps/web/src/app/[locale]/globals.css`. None in the Sharp pipeline. None in the schema.

Apple's HDR Photo (ISO 21496-1, "HDR Gain Maps for HDR Photo") embeds an SDR base image plus a gain map that Safari 17+, Chrome 134+, and macOS Photos use to render HDR on capable displays. The gain map is a secondary JPEG/HEIC stream within the file's MPF (Multi-Picture Format) structure, plus an XMP/Adobe gain-map JSON descriptor.

Sharp does not preserve MPF structure on its default decode/encode path. Calling `.jpeg()` or `.avif()` on an iPhone HDR Photo strips the gain map.

**Failure scenario**: Mei is a travel photographer using an iPhone 15 Pro for behind-the-scenes shots. She shoots HDR Photos that look spectacular on her iPhone. She uploads to her ATIK travel-blog gallery. On her colleague's iPhone 15 Pro, the photos show as plain SDR — the gain map was stripped during upload processing. Her gallery looks flat next to the source files.

**Fix**:
1. Detect HDR gain map on upload (parse MPF structure, look for the secondary image with the gain-map ICC or the XMP `hdrgm:Version` descriptor).
2. Either:
   - (Easy) preserve the original on the download path and serve the gain-mapped HEIC for HDR-capable browsers via a `<picture>` `<source type="image/heic">`, OR
   - (Hard) re-encode AVIF with HDR HDR10/PQ metadata and synthesize the gain map.
3. Schema: `images.has_hdr_gain_map BOOLEAN`.

**Severity**: PRO-HIGH for travel / lifestyle / mobile-first photographers. Lower for studio shooters. Platform-level expectation will rise sharply over the next 2 years as HDR becomes default.

---

### PP-MED-1 — Bulk operations are limited

**File**: `apps/web/src/lib/bulk-edit-types.ts:14-24`

```typescript
export interface BulkUpdateImagesInput {
    ids: number[];
    topic: TriState<string>;
    titlePrefix: TriState<string>;
    description: TriState<string>;
    licenseTier: TriState<LicenseTier>;
    addTagNames: string[];
    removeTagNames: string[];
    applyAltSuggested?: 'title' | 'description' | null;
}
```

Missing:
- Bulk rate (PP-CRIT-5 dependency)
- Bulk pick / reject (PP-CRIT-5 dependency)
- Bulk color label (PP-CRIT-5 dependency)
- Bulk set capture_date (admin needs to fix wrong camera-clock photos)
- Bulk strip / set GPS (privacy)
- Bulk re-watermark (PP-CRIT-4 dependency)
- Bulk regenerate variants (e.g. after pipeline-version bump)
- Bulk set IPTC creator / copyright (PP-CRIT-1 dependency — if you accept 200 self-published portfolio photos in one go and want one creator string)
- Bulk move to / create-from shared group
- Bulk export

The "select all" UI at `apps/web/src/components/image-manager.tsx:105-111` selects all VISIBLE images. Pagination governs what's visible. The dashboard probably paginates at 50-200; selecting 200 across pages requires clicking through. Confirmed:

```
selectedIds.size === images.length
```

— this only counts what's loaded, not the total set. A "select all 12,000 photos in this topic" requires a server-side bulk operation by predicate, which doesn't exist.

**Severity**: PRO-MED — workaround exists (paginate, select per page) but feels amateurish at any scale.

---

### PP-MED-2 — No re-publish / re-edit over an existing image record

**File**: `apps/web/src/app/api/admin/lr/upload/route.ts:134-152`

Every upload INSERTs a new row. An LR re-publish creates a NEW image record with a new ID; the old image's URL (`/p/123` and `/uploads/{avif,webp,jpeg}/{old-uuid}.{ext}`) persists. The shared link to the old version still points to the OLD photo — a year-later re-edit is invisible to anyone with a previous link, and the SEO position of `/p/123` is unaffected by the new image.

**Failure scenario**: Lena re-edits a popular portfolio photo a year after publishing. She re-imports into LR with new colour grading and re-publishes via the (yet-to-exist) plugin. ATIK creates `image_id = 5234`. Her Instagram bio link still points to `/p/892`. Her visitors see the OLD edit. She manually goes to `/p/892`, deletes it, then has to update her Instagram bio because the new image is at `/p/5234`. SEO ranking lost.

**Fix**:
1. PUT `/api/admin/images/[id]` (token-auth) that replaces the original file and reprocesses derivatives, keeping the same ID and URL.
2. Bump `IMAGE_PIPELINE_VERSION` per-image OR rely on mtime-based ETag (already in `serve-upload.ts:97`).
3. LR plugin maps remoteId on republish.

**Severity**: PRO-MED — pros develop their style and re-edit over time. Breaking embeds is a real cost.

---

### PP-MED-3 — Search exposed in smart-collections but not in admin grid

**Files**:
- `apps/web/src/lib/smart-collections.ts:20-29` — admin can build smart collections by EXIF column predicate (iso, focal_length, f_number, exposure_time, camera_model, lens_model, capture_date, topic, tag).
- `apps/web/src/components/image-manager.tsx` — admin grid has no equivalent quick filter.

Smart collections are great for public-facing dynamic galleries but for ad-hoc admin culling, the admin needs:
- "Show me all photos taken with the 85mm f/1.4 GM"
- "Show me all photos at ISO > 6400" (high-noise candidates for review)
- "Show me all unrated photos shot last weekend"

None of these are filterable from the image manager UI today. Admin has to construct a smart collection for each ad-hoc query, save it, view it, delete it. Friction.

**Fix**: surface column-predicate quick filters in the admin grid. Same backend (`smart-collections.ts`) just rendered without persistence.

**Severity**: PRO-MED — workaround exists (smart collections), feels heavy.

---

### PP-MED-4 — No quick rate / label keyboard shortcuts in photo viewer

**File**: `apps/web/src/components/photo-viewer.tsx:325-347`

Current keyboard handlers: `ArrowLeft`, `ArrowRight`, `f`/`F` (lightbox), `i`/`I` (info pin). That's it.

Even WITHOUT the rating schema (PP-CRIT-5), this UI position is screaming for:
- `0-5` rating
- `P` / `X` / `U` pick/reject/unflag
- `6-9` color labels
- `D` mark for delete
- `S` toggle for shared-group inclusion
- `B` toggle for "pick of the bunch"

A photographer culling 600 photos at one frame per second needs keystroke-level control. ATIK requires mouse-level control (click into image, click "Edit," type, save, click "Next").

**Severity**: PRO-MED — feels amateurish for daily use.

---

### PP-MED-5 — Upload preview is 2/3-column grid, no contact-sheet

**File**: `apps/web/src/components/upload-dropzone.tsx:389-473`

```html
<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
```

For 600 photos: 200 grid rows × 3 columns × ~250 px tall = 50,000 px tall preview pane. Unscrollable on mobile, tedious on desktop. Photo Mechanic and Bridge contact-sheet views are 12-15 columns on desktop with adjustable density.

**Fix**: configurable density slider, virtualized grid (`react-window`).

**Severity**: PRO-MED.

---

### PP-MED-6 — Visitor-created shared groups (favorites) — not really

**Files**:
- `apps/web/src/db/schema.ts:100-117` — `shared_groups`, `shared_group_images` — admin-creatable curated set.
- `apps/web/src/app/actions/sharing.ts` (inferred) — admin actions only.

The proofing pattern is: admin creates a shared group of 600 wedding photos for the family → family clicks hearts → admin exports the picks. Today the "picks" travel through the reaction system (PP-HIGH-6) which fights the workflow.

A direct visitor-creates-set mechanism (e.g. "Favorite this set" button on a shared-group page that creates a child group of just-the-likes) is absent.

**Severity**: PRO-MED — workaround via PP-HIGH-6 fix.

---

### PP-LOW-1 — `rm` is photographer jargon

**Files**: `apps/web/src/lib/license-tiers.ts:17`, `apps/web/messages/{en,ko}.json`.

`license_tier = 'rm'`. Visitors will not know "rm" = "rights-managed." UI copy should be `"Rights-Managed (single use)"` or similar.

---

### PP-LOW-2 — Korean place-name round-trip is not modelled

Downstream of PP-CRIT-1: there's no IPTC location field at all, so the question of locale-correct place-name round-trip ("서울특별시 강남구" in Korean IPTC, "Gangnam-gu, Seoul" in English IPTC) is moot — neither is stored. The fix is part of PP-CRIT-1: add `iptc_city`, `iptc_country`, `iptc_sublocation`, `iptc_province_state` AND consider per-locale variants (`iptc_city_en`, `iptc_city_ko`).

---

### PP-LOW-3 — Print/proof watermark setting absent

Downstream of PP-CRIT-4. Admin watermark settings (`watermark_filename`, `watermark_opacity`, etc.) don't exist.

---

## Verdict — would a pro choose ATIK over the alternatives?

| Need | ATIK today | SmugMug | Pixieset | PhotoShelter | Zenfolio |
|------|------------|---------|----------|--------------|----------|
| RAW upload (Canon/Nikon/Adobe DNG) | ✗ Sony only | ✓ | ✓ | ✓ | ✓ |
| IPTC byline / copyright / keywords | ✗ stripped | ✓ | ✓ | ✓ (best in class) | ✓ |
| Lightroom Classic plugin | ✗ stub only | ✓ | partial | ✓ | ✓ |
| Watermarking | ✗ | ✓ | ✓ | ✓ | ✓ |
| Star / pick / color label | ✗ | ✓ | ✓ | ✓ | ✓ |
| Client proofing with admin-visible picks | ✗ | ✓ | ✓ (best) | ✓ | ✓ |
| Hierarchical IPTC keywords | ✗ flat tags | ✓ | partial | ✓ | ✓ |
| Stripe sales / paid licensing | ✓ (4 fixed tiers) | ✓ | ✓ | ✓ | ✓ |
| 1:1 native-pixel zoom | ✗ | ✓ | ✓ | ✓ | ✓ |
| Stack / burst | ✗ | partial | ✗ | ✓ | partial |
| HDR gain map | ✗ | partial | ✗ | partial | ✗ |
| Self-host control | ✓ ★ | ✗ | ✗ | ✗ | ✗ |
| Color-management correctness post-fix | ✓ | ✓ | partial | ✓ | partial |
| Open-source / no per-photo fee | ✓ ★ | ✗ | ✗ | ✗ | ✗ |

**For a working pro today**: ATIK is unsuitable as a standalone client-deliverable platform. It's a self-hosted **portfolio + exhibition site** with a Stripe integration bolted on. The pro workflow gaps (IPTC, RAW, watermark, picks, rating, hierarchical keywords) are not minor polish — they are foundational data-model omissions.

**The pro who would still choose ATIK**: a Sony-shooting fine-art photographer who wants self-hosting and who delivers via separate channels (email JPEGs, Dropbox for prints), using ATIK only as a public portfolio with a "buy this" Stripe button. That's a narrow segment.

**The pro who would migrate immediately to a SaaS**:
- Wedding / event / sports / editorial / commercial → Pixieset or SmugMug.
- Agency / wire-service deliverable → PhotoShelter.
- High-volume print sales → SmugMug or Zenfolio.

**Priority order for closing the gap to "viable for pros"**:
1. **PP-CRIT-1 (IPTC)** — single biggest table-stakes gap. Without IPTC, ATIK is a non-starter for editorial, commercial, agency, wire-service, and any pro shooting for clients with metadata-driven CMS. Two weeks of work for the parser + schema + UI surface.
2. **PP-CRIT-5 (rating / pick / color label)** — workflow blocker, but contained to schema + UI. One week.
3. **PP-CRIT-4 (watermarking)** — without it, paid proofing is broken. Three days for the basic implementation, two weeks for per-tier polish.
4. **PP-CRIT-2 (RAW formats)** — one day to add `.dng` to the allowlist (lowest-hanging fruit). Two weeks for full libraw integration.
5. **PP-CRIT-3 (LR plugin)** — three days to ship a minimum publish service. One week with metadata + smart-preview support.
6. **PP-HIGH-1 (file size + progress)** — half a week to make the cap configurable + wire upload progress.
7. **PP-HIGH-3 (hierarchical keywords)** — one week (schema + UI tree).
8. **PP-HIGH-9 (1:1 zoom)** — half a week.
9. The rest — PP-HIGH and PP-MED items can land over a quarter.

**Bottom line**: shipping the seven PP-CRIT items would move ATIK from "no working pro would use this" to "self-hosted Pixieset alternative for the privacy-conscious pro." That's a clear product-market positioning. The current state is between "high-quality personal portfolio" and "pro tool" — and not far enough into the latter to be considered.

