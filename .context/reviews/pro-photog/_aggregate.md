# Pro-photographer review aggregate

5 reviewers in parallel: workflow (analyst), print-hdr-raw (code-reviewer), critical-viewing (designer), client-commerce (code-reviewer), metadata-fidelity (security-reviewer).

Per-agent files: `workflow.md`, `print-hdr-raw.md`, `critical-viewing.md`, `client-commerce.md`, `metadata-fidelity.md`.

Severity:
- **PRO-CRIT** — daily-use blocker for working pros (would push them to SmugMug / Pixieset / PhotoShelter / Zenfolio)
- **PRO-HIGH** — frequent friction, costs hours per shoot
- **PRO-MED** — workaround exists but feels amateurish
- **PRO-LOW** — nice-to-have polish

✓ marks indicate cross-reviewer agreement (higher signal). Findings hit by ≥3 reviewers are bolded as "convergent".

## Latent bugs found (not feature gaps — real regressions)

These are the most actionable items because they reveal that the recently-shipped color fixes have unintended dark spots.

### PP-BUG-1 — capture_date timezone shift on non-UTC servers
**Files:** `apps/web/src/lib/process-image.ts:171-177` (`parseExifDateTime` Date-input branch)
**Reviewers:** metadata-fidelity (PHOTOG-HIGH-5)

`exif-reader` returns EXIF DateTimeOriginal as a JS `Date` interpreting the local-time string as server-local. Code then calls `getUTCHours()` etc., which shifts the value by the server's TZ offset. Docker production runs UTC so this is masked there, but a NAS deployment in JST will store every `capture_date` 9 hours off. **Latent data-corruption bug.**

Concrete failure: photographer in Seoul deploys on a Synology NAS (`Asia/Seoul`). Every photo shot at 14:00 KST is persisted as 23:00 KST in the DB and served to viewers as if shot late evening. Sort order between same-day photos is preserved but absolute time on the photo page is wrong.

Fix: parse the EXIF datetime as a string with explicit field extraction (year/month/day/hour/min/sec via regex on the EXIF DateTimeOriginal text), not via the `Date` round-trip.

### PP-BUG-2 — 10-bit AVIF gate is inverted on Docker production
**Files:** `apps/web/src/lib/process-image.ts:39` (`HAS_HIGH_BITDEPTH_AVIF = !sharp.versions.heif`)
**Reviewers:** print-hdr-raw (PP-16)

The CM-MED-1 fix gated 10-bit AVIF behind "Sharp prebuilt binaries ship libheif without 10/12-bit AVIF support — passing bitdepth:10 throws there." But `sharp.versions.heif` is **truthy** on the Docker production path (libheif IS bundled in the linux-arm64 prebuilt + the explicit `@img/sharp-libvips-linux-arm64-glibc` dep added in cycle history). So `HAS_HIGH_BITDEPTH_AVIF = !truthy = false` → wide-gamut AVIFs ship as 8-bit on prod. The whole banding-mitigation is a no-op in production.

Fix: actually probe libheif's AVIF capabilities at startup (try a tiny `sharp({create:...}).avif({bitdepth:10}).toBuffer()` in a try/catch) instead of guessing from the version string. Cache the result.

### PP-BUG-3 — `strip_gps_on_upload` doesn't strip from disk
**Files:** `apps/web/src/lib/process-image.ts` (extractExifForDb GPS handling), `apps/web/src/app/api/download/[imageId]/route.ts`
**Reviewers:** metadata-fidelity (PHOTOG-HIGH-1), client-commerce (alluded)

`strip_gps_on_upload` nulls `latitude`/`longitude` columns. The original file at `data/uploads/original/{uuid}.{ext}` STILL has GPS EXIF intact. `/api/download/[imageId]` streams that original byte-for-byte. So an admin who paid for "GPS scrubbed for safety" exposes GPS to anyone with download access (paid downloads + admin downloads).

Real-world failure: a wildlife photographer uploads photos of a black rhino population near a poaching corridor with `strip_gps_on_upload=true`. Buyer purchases full-res download → bytes contain GPS → social-media re-upload → poaching coordinates exposed.

Fix: when `strip_gps_on_upload=true`, sanitize the on-disk original at upload time too (Sharp can strip GPS while preserving everything else, OR re-emit a pixel-identical-but-GPS-stripped copy).

## CRITICAL — convergent

### PP-CRIT-1 — IPTC and XMP are never read or preserved
**Reviewers:** workflow (PP-CRIT-1) ✓, metadata-fidelity (PHOTOG-CRIT-1) ✓

`extractExifForDb` (`process-image.ts:737-846`) only touches 13 EXIF fields and ignores `metadata.iptc` / `metadata.xmp` entirely. None of: ObjectName (title), Headline, Caption-Abstract, Keywords, By-line (creator), Credit, Source, CopyrightNotice, ContactInfo, City, Sub-location, ProvinceState, CountryName are read. Schema has no columns for them.

Even if they were read, the recent CM-HIGH-2 fix (replace `withMetadata({icc})` with `withIccProfile()`) explicitly drops IPTC + XMP bits on every output derivative. So even photographer-self-uploaded captioned bytes lose their captions on the served file.

For pro context: every Reuters / AP / Getty / Magnum / National Geographic photo carries IPTC. A working stringer's photos arriving at a picture desk with empty `creator`, empty `copyright`, empty `caption`, empty `headline` is a daily-use blocker — the picture editor has to manually re-tag every file before publishing.

Fix path:
1. Read `metadata.iptc` + `metadata.xmp` in `extractExifForDb`. Persist a curated set: byline, credit, copyright, headline, caption, keywords (array), city/state/country, contact info.
2. Add an admin setting `preserve_iptc_on_derivatives: 'all' | 'minimal' | 'strip'`. Default `minimal` = byline+credit+copyright only.
3. When `'all'` or `'minimal'`, switch encode chain to `withMetadata({icc, iptc, xmp})` rather than `withIccProfile()`. Document the privacy/branding tradeoff.

### PP-CRIT-2 — No watermarking — anywhere
**Reviewers:** workflow (PP-CRIT-4) ✓, client-commerce (PRO-CRIT) ✓

`grep -r "watermark\|composite\|overlay" apps/web/src/lib/` returns 0 hits in the image pipeline. Pros doing client proofing send watermarked previews, then deliver clean bytes after payment / picks. Without this, a wedding photographer's proof gallery is identical to the deliverable — the client can right-click-save the unwatermarked previews and skip the photographer's invoice entirely.

Fix path:
1. Schema: `admin_settings.watermark_logo_path` (path to a PNG/SVG in `public/`), `watermark_position` (5 corners + center), `watermark_opacity` (0-100), `watermark_scale` (% of image width), `watermark_margin_pct`.
2. `process-image.ts`: add a `watermark` boolean parameter. After resize + colorspace-convert, `image.composite([{input: logoPath, gravity: ..., blend: 'over'}])` before the encode chain.
3. Generate TWO derivative tracks: `public/uploads/{format}/{uuid}_v{N}.{ext}` (clean, served only to authenticated download) and `public/uploads/{format}/{uuid}_v{N}_wm.{ext}` (watermarked, served on grid + photo viewer).
4. Per-tier mapping: free / share-link / non-paid → watermarked. Admin / paid-entitlement → clean.

### PP-CRIT-3 — No star rating / pick / reject / color label
**Reviewers:** workflow (PP-CRIT-5) ✓, critical-viewing (PRO-CRIT) ✓

Schema lacks `rating`, `flag`, `color_label`, `published`. Photo viewer keyboard handler (`photo-viewer.tsx:327-347`) responds to ArrowLeft/Right/F/I only. The entire culling vocabulary (Lightroom 1-5 stars, P/X picks/rejects, 0-9 color labels) is absent at every layer.

For pro context: a wedding photographer with 1,800 frames culls down to ~250 keepers. Without star/pick/reject in the gallery, they cull in Lightroom first then upload only the 250 — but then re-edits + re-deliveries lose the rating context. With proper rating, they upload all 1,800, set 5★ on 80, P-flag 250 deliverables, hide everything else from public.

Fix path:
1. Schema: add `rating tinyint default 0`, `flag enum('none','pick','reject') default 'none'`, `color_label enum('none','red','yellow','green','blue','purple') default 'none'`, `published boolean default true` (back-compat: existing rows public).
2. Photo viewer keyboard: 0-5 stars, P pick, X reject, 6-9 color labels, U un-rate.
3. Admin grid: filter by rating ≥ N, by flag, by label, by published status.
4. Public-facing: only `published=true` photos appear in topics + shared groups.

### PP-CRIT-4 — Lightbox has NO zoom + lightbox loads pre-shrunk derivative
**Reviewers:** critical-viewing (PRO-CRIT, two findings)

`lightbox.tsx:386-436` is a bare `<img>` with no `ImageZoom` wrapper. Pinch-to-zoom and mouse-wheel zoom completely absent. The `ImageZoom` component exists in the card viewer but was never composed into the lightbox.

Worse, `lightbox.tsx:336-340` picks `imageSizes[imageSizes.length - 2]` (e.g., 1536px on a configured 2048-max). Even if zoom existed, it would zoom into a downscaled 1536px buffer, not the actual full-res file. Pixel-peeping at "100%" would show interpolated upscaling, not real pixels.

Fix path:
1. Compose `<ImageZoom>` around the `<img>` in `lightbox.tsx`. Pass `image.width / containerWidthPx` as default zoom-to-100% mode.
2. Compute `DEFAULT_ZOOM` from `image.naturalWidth` / container size in CSS pixels × DPR, not the hardcoded `2.5`.
3. Add a "load full-res for pixel-peep" toggle that swaps the `<img src>` from the resized derivative to the served-from-original-bytes endpoint. Cap to admin / paid-entitlement viewers.

### PP-CRIT-5 — RAW allowlist is Sony-only AND ARW silently fails on Docker
**Reviewers:** workflow (PP-CRIT-2) ✓, print-hdr-raw (PP-5) ✓

`ALLOWED_EXTENSIONS` (`process-image.ts:71-73`) lists `.arw` (Sony) but not `.cr2 / .cr3` (Canon), `.nef` (Nikon), `.dng` (Adobe universal RAW), `.orf` (Olympus), `.pef` (Pentax), `.raf` (Fuji), `.rw2` (Panasonic). Canon shoots roughly half of all working pros — locked out.

Worse: even Sony shooters fail. `@img/sharp-libvips-linux-arm64@1.2.4` (the actual Docker arm64 prebuilt) ships **without libraw**. So an `.arw` upload reaches Sharp, which throws "Invalid image file" with no useful error message. The dropzone advertises ARW as supported. The Lightroom plugin route hits the same dead end.

Fix path:
1. Drop the `.arw` lie immediately — remove from `ALLOWED_EXTENSIONS` until libraw is bundled, OR add libraw to the Docker base image.
2. Once libraw is bundled, add `.dng` (universal — most pros export RAW to DNG for archival anyway). Then per-vendor as testing allows.
3. UX: when a RAW upload fails, surface "RAW format not yet supported on this server. Export to TIFF or JPEG from your editor (highest quality)" instead of the generic Sharp error.

### PP-CRIT-6 — No password protection on shared galleries
**Reviewers:** client-commerce (PRO-CRIT)

`sharedGroups` has only the random URL slug (`key`). For a high-trust client deliverable (wedding gallery, executive portrait set, embargo-protected editorial), forwarded link = identical to guessed link. Pixieset, ShootProof, PASS all gate proof galleries behind a per-gallery password.

Fix: add `sharedGroups.password_hash` (Argon2 hash, optional). When set, `/[locale]/g/[key]/page.tsx` shows a password gate before rendering. Argon2 verify on submit. 5-attempt rate limit per IP per gallery.

### PP-CRIT-7 — Stripe webhook only handles checkout.session.completed
**Reviewers:** client-commerce (PRO-CRIT)

The webhook handler ignores `charge.refunded` (Stripe-dashboard refunds bypass `entitlements.refunded`), `charge.dispute.created` (chargebacks leave downloads active), `checkout.session.async_payment_succeeded` (ACH/SEPA always perma-fail since the original session.completed event reports unpaid).

Concrete failure: photographer issues a refund from the Stripe dashboard (not the gallery's refund button). Customer's entitlement still enforces in DB. Refunded customer can still download. Worse, on chargeback, customer keeps the photo AND gets the money back AND there's no audit trail in the gallery.

Fix path: handle `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Use Stripe's `event.id` for idempotency.

## HIGH — convergent

### PP-HIGH-1 — Histogram has no clipping warnings
**Reviewers:** critical-viewing (PRO-HIGH)

`histogram.tsx`'s `drawHistogram()` fills channel curves with no threshold logic. Industry standard:
- Red highlight indicator for histogram bins > 250
- Blue shadow indicator for bins < 5
- Image-overlay "blinkies" mode (Lightroom's J): red mask on clipped highlights, blue mask on clipped shadows

Fix: add a clipping toggle in the histogram header; when on, render colored masks over the photo at clipping pixels.

### PP-HIGH-2 — DPI metadata never written to derivatives
**Reviewers:** workflow (PP-HIGH-8) ✓, print-hdr-raw (PP-1) ✓, metadata-fidelity (PRO-MED)

JPEG's pHYs / EXIF XResolution + YResolution + ResolutionUnit are not set on output. Print labs (Whitewall, Bay Photo, FotoPrizma) reject 72-DPI uploads as "low resolution" even when the pixel count is correct, because their software reads DPI tag.

Fix: `image.withMetadata({density: 300})` (Sharp 0.34+) on the output JPEG path. For non-print web AVIF/WebP it's irrelevant.

### PP-HIGH-3 — No output sharpening after downscale
**Reviewers:** print-hdr-raw (PP-2)

Lightroom export defaults to "Output Sharpening: low/standard/high" because aggressive downscaling softens the result. The pipeline does `pipelineColorspace('rgb16')` linear-light resize (good) but never applies any unsharp mask afterwards. Industry standard for a 1080-tall web export: `image.sharpen({sigma: 0.5, m1: 0, m2: 1})` or similar.

Fix: parameterized `output_sharpening` admin setting (none / low / standard / high), apply after resize, before colorspace-convert.

### PP-HIGH-4 — HDR gain map silently dropped
**Reviewers:** workflow (PP-HIGH-10) ✓, print-hdr-raw (PP-3) ✓

iPhone Pro shoots HDR Photo with embedded gain map (ISO 21496-1). Modern Safari + Chrome render them with HDR brightness boost on capable displays. The pipeline decodes via libheif and the gain map is silently dropped during the resize/encode.

Fix path:
1. Detect: `metadata.gainMap` (Sharp 0.34+ provides this). Persist `images.has_hdr_gain_map` boolean.
2. Preserve on download: streamthe original bytes for HEIC inputs, or re-emit AVIF with the HDR sub-image attached (Sharp 0.34 can do this with `cicp` + secondary image).
3. Mark on grid: small "HDR" badge on tiles with gain map.

### PP-HIGH-5 — Backfill not resumable
**Reviewers:** print-hdr-raw (PP-10)

After CM-HIGH-6 fix, `backfill-p3-icc.ts` reprocesses every image. For 50K-photo catalogs at 2-image concurrency, that's ~8 hours. If it crashes at photo 30,000, restart resumes from photo 0. No `pipeline_version` column on `images` for incremental gating.

Fix: add `images.pipeline_version int default 1`. Backfill `WHERE pipeline_version < CURRENT_PIPELINE_VERSION ORDER BY id LIMIT N`. After each successful row, `UPDATE pipeline_version=CURRENT`. Resume = re-run the same script.

### PP-HIGH-6 — No download-tier preset / output preset system
**Reviewers:** workflow (PP-HIGH-5) ✓, client-commerce (PRO-HIGH) ✓

Pro deliverable workflow: "1200px web JPEG with watermark" + "full-res TIFF" + "Instagram square" + "print-ready 300 DPI". The pipeline emits AVIF/WebP/JPEG at multiple sizes uniformly — no preset system for download tiers, no per-tier watermark, no per-tier crop.

Fix: schema `download_presets` table (name, max_pixels, format, quality, sharpening, watermark_enabled, color_space, dpi). Admin UI to create + assign presets to license tiers.

### PP-HIGH-7 — License model is enum, not flexible
**Reviewers:** workflow (PP-HIGH-4) ✓, client-commerce (PRO-HIGH multi-tier) ✓

`license_tier: 'none' | 'editorial' | 'commercial' | 'rm'`. Real pros mix CC0, CC-BY, CC-NC, CC-SA, "all rights reserved", "personal use only", "editorial only — no advertising", "rights-managed" with custom durations. Fixed enum with global tier prices means no per-image override; same price for $50 stock and $2,500 portfolio piece.

Fix: schema `licenses` table (id, slug, name, description, price_cents, currency, is_redistributable, is_commercial, is_editorial, attribution_required, custom_terms_md). Many-to-many with images. Stripe checkout looks up the `license_id` on the image.

### PP-HIGH-8 — Lightroom Classic plugin doesn't exist on disk
**Reviewers:** workflow (PP-CRIT-3) ✓, others (alluded)

`adminTokens` table comments mention "Lightroom Classic publish plugin" but no `*.lua` files are committed. Search for `Info.lua`, `LrSDK`, the SDK manifest — none. Only the server endpoint `api/admin/lr/upload/route.ts` and token plumbing exist.

Fix path: commit the actual plugin under `lightroom-plugin/` at repo root with the standard Adobe SDK structure (Info.lua, PublishService.lua, ExportTask.lua, MetadataDefinition.lua). Alternatively, adopt an existing OSS plugin (e.g. https://github.com/jeffjas/lr-photo-publish) and configure it for this gallery's API.

### PP-HIGH-9 — 200MB upload cap rejects medium-format DNG
**Reviewers:** workflow (PP-HIGH-1)

Phase One IQ4 backs ≈ 600MB DNG. Hasselblad H6D-100c shoots ~290MB 16-bit TIFF. Medium-format scans can exceed 1GB. The 200MB cap is fine for 35mm + APS-C + most full-frame mirrorless RAW (Sony A7R5 at ~120MB), but cuts off the high-end fine-art / commercial product photographer.

Fix: make `MAX_FILE_SIZE` an admin setting. Default 200MB, max raise to 2GB. Add streaming-upload progress UI for files >50MB.

### PP-HIGH-10 — No 1:1 native-pixel zoom in card viewer either
**Reviewers:** workflow (PP-HIGH-9) ✓, critical-viewing (PRO-CRIT) ✓

Beyond the lightbox-has-no-zoom issue, the card viewer's `ImageZoom` uses `DEFAULT_ZOOM = 2.5` (`image-zoom-math.ts:3`) — an arbitrary value not computed from `image.naturalWidth / container.clientWidth`. True 1:1 needs the ratio.

Fix: `DEFAULT_ZOOM = imgNaturalWidth / containerCSSWidth / dpr`. Add a "1:1" button in the zoom controls.

### PP-HIGH-11 — No bundled-zip download for picks
**Reviewers:** client-commerce (PRO-HIGH)

Wedding pro: 50 picks from 500 photos. Currently the only path is 50 separate Stripe checkouts and 50 separate downloads. No zip-bundle endpoint. No `archiver` / `yazl` dep.

Fix: `archiver` dep, `/api/download/bundle/[entitlementId]` endpoint that streams a tar.gz / zip of all photos in the entitlement. Single Stripe checkout for the bundle.

### PP-HIGH-12 — No client-picks workflow + reactions are anonymous-day-rotated
**Reviewers:** workflow (PP-HIGH-6) ✓, client-commerce (PRO-CRIT picks-flow) ✓

`imageReactions.visitor_id_hash = SHA-256(visitor_uuid + YYYY-MM-DD)`. The daily salt rotation breaks pick continuity — Monday's picks become unidentifiable on Tuesday. Admin has no "show me visitor X's picks for shared group Y" report.

Fix path:
1. Per-shared-group: optional persistent visitor identity (email or sign-in) so picks survive across sessions.
2. Admin: per-shared-group "picks export" (CSV or zip of full-res of all picks).
3. Visitor-side: "my picks" view showing all selected photos.

### PP-HIGH-13 — `expires_at` on shared groups is read-enforced but never written
**Reviewers:** client-commerce (PRO-HIGH)

`data.ts:996-997` checks `expires_at > NOW()`. But `createGroupShareLink` doesn't set it, no admin UI exposes it, no cleanup sweep. Expired-share enforcement is dead code.

Fix: admin UI exposes "expires in {7 days, 30 days, 90 days, never}". Set `expires_at` accordingly. Cron-style sweep in `/api/cron/expire-shares` or on every read.

### PP-HIGH-14 — Schema captures EXIF only — IPTC City/State/Country/Sublocation never persisted
**Reviewers:** workflow (PP-HIGH for editorial) ✓, metadata-fidelity (PRO-CRIT 1) ✓

This is a sub-finding of PP-CRIT-1 but worth calling out separately — the geo-text taxonomy (Tokyo > Shibuya > Hachiko Square) is what magazines use to caption. EXIF GPS lat/lng without IPTC location text means a desk editor has to reverse-geocode every photo manually.

Fix: with PP-CRIT-1 schema additions, add `images.iptc_city`, `iptc_state`, `iptc_country`, `iptc_sublocation`. Optionally derive from GPS via reverse geocode if missing.

### PP-HIGH-15 — Lens model not normalized
**Reviewers:** metadata-fidelity (PHOTOG-HIGH-4)

`Sony FE 70-200mm F2.8 GM OSS II` vs `FE 70-200 GM` vs `70-200 F2.8 GM`. Smart collections filtering by lens silently splits the same lens across firmware revisions and 3rd-party (Sigma/Tamron) reporting.

Fix: at upload time, normalize lens model via a maintained mapping table. Surface both raw + canonical in the EXIF panel.

### PP-HIGH-16 — Hierarchical IPTC keywords not supported
**Reviewers:** workflow (PP-HIGH-3)

Lightroom keywords are hierarchical: Wedding > Reception > First Dance. The `tags` schema is flat. A wedding photographer with 3,000 photos can't bulk-tag effectively.

Fix: schema `tag_parent_id` + `tag_path` (materialized path "Wedding/Reception/First Dance"). Admin UI tree picker.

### PP-HIGH-17 — No published/draft state on images
**Reviewers:** critical-viewing (PRO-HIGH)

`processed` boolean indicates pipeline completion, not editorial intent. Admin uploads a shoot → photos immediately public. No private cull-then-publish flow.

Fix: `images.published boolean default true` (back-compat). New uploads set false. Admin UI to flip. Public queries filter `published=true`.

### PP-HIGH-18 — Webhook lacks email pipeline + token-resend story
**Reviewers:** client-commerce (PRO-HIGH)

Webhook flag: `// TODO: send email`. Customer relies on opt-in plaintext logging in Stripe email. If they lose the download link, no token-resend action exists. Lookup by order ID + email isn't built.

Fix: add transactional email (Resend / SES / Postmark) with the download link. Lookup by `email + sessionId`.

## MEDIUM (selected — full list in per-agent files)

- **PP-MED-1** — Webhook idempotency uses `sessionId`, not `event.id` (cycle 6 RPF added Idempotency-Key on the SEND side; webhook RECEIVE side should additionally dedupe by event.id).
- **PP-MED-2** — `OffsetTimeOriginal` and `SubSecTimeOriginal` discarded — bursts (12-30 fps) collapse to single-second timestamps; cross-timezone galleries sort wrong.
- **PP-MED-3** — Camera Make column missing from schema (`camera_model` only). "Sony A1" works but "Make: Sony" isn't queryable.
- **PP-MED-4** — GPS Altitude / ImgDirection / DestBearing / Speed / AreaInformation never persisted. Drone, landscape, aviation pros lose data.
- **PP-MED-5** — Bursts / sequences / stacks not modeled. Sports / wildlife / wedding pros need stacks.
- **PP-MED-6** — Lightbox uses pre-shrunk derivative for "100%" mode (already in PP-CRIT-4 but worth restating).
- **PP-MED-7** — Histogram fed 640px thumbnail (`photo-viewer.tsx:808-812`), not largest derivative. Tone evaluation on downsampled buffer.
- **PP-MED-8** — EXIF panel shows raw focal length but never 35mm-equivalent (crop-factor multiplied).
- **PP-MED-9** — Exposure compensation displayed as raw DB string, not formatted `±N.N EV`.
- **PP-MED-10** — Stripe customer portal not linked from order confirmation.
- **PP-MED-11** — License `currency` only USD; no multi-currency support.
- **PP-MED-12** — Stripe Tax / VAT collection not configured.
- **PP-MED-13** — Right-click protection toggle not present.
- **PP-MED-14** — No embed code surface for individual photos / topics.
- **PP-MED-15** — `Software` EXIF tag (e.g., "Lightroom Classic 14.1") not captured.
- **PP-MED-16** — TIFF compression scheme (LZW/ZIP/uncompressed) not captured.
- **PP-MED-17** — Animated GIF / HEIC silent flatten (page 0 only).
- **PP-MED-18** — Multi-page TIFF silent flatten.
- **PP-MED-19** — `user_filename` not used in `Content-Disposition` of download — buyers get UUID filenames.
- **PP-MED-20** — Per-image download counter not surfaced.
- **PP-MED-21** — Per-shared-group view limit (max-N-views) not implemented.
- **PP-MED-22** — Auto-slug generator for event-keyed galleries (e.g. `john-and-jane-wedding-2026-04-15`) not present.
- **PP-MED-23** — Per-topic branding (per-topic theme color, logo override, custom CSS) not present.
- **PP-MED-24** — No `creator` / `photographer_id` on `images` for second-shooter attribution.
- **PP-MED-25** — Mobile photo viewer info bottom-sheet doesn't show histogram.
- **PP-MED-26** — Slideshow lacks progress bar + per-session interval control.

## LOW (selected)

PP-LOW-1 through PP-LOW-12: makernote support, ICC fingerprinting, rendering intent, XMP sidecar acceptance, SHA-256 of original, topic thumbnail metadata, soft-proof simulation, before/after toggle, side-by-side compare, hover loupe, calibration warnings, accessibility filtering by color label name not hue.

## Files most affected

| File | Critical | High | Med | Low |
|------|---:|---:|---:|---:|
| `apps/web/src/lib/process-image.ts` | 5 | 6 | 6 | 3 |
| `apps/web/src/db/schema.ts` | 4 | 7 | 8 | 1 |
| `apps/web/src/components/photo-viewer.tsx` | 1 | 2 | 4 | 2 |
| `apps/web/src/components/lightbox.tsx` | 2 | 0 | 0 | 0 |
| `apps/web/src/components/histogram.tsx` | 0 | 1 | 2 | 0 |
| `apps/web/src/app/api/stripe/webhook/route.ts` | 1 | 1 | 1 | 0 |
| `apps/web/src/app/api/download/[imageId]/route.ts` | 1 | 1 | 1 | 0 |
| `apps/web/src/app/[locale]/(public)/g/[key]/*` | 1 | 2 | 1 | 0 |
| `apps/web/src/app/actions/sales.ts` | 0 | 1 | 1 | 0 |
| `apps/web/scripts/backfill-p3-icc.ts` | 0 | 1 | 0 | 0 |
| `apps/web/src/app/[locale]/admin/(protected)/*` | 1 | 4 | 5 | 1 |
| (NEW) `lightroom-plugin/*.lua` | 1 | 0 | 0 | 0 |

## Recommended fix sequencing

The findings cluster into ~14 PRs. Sequence so each PR keeps gates green:

1. **PR 1 (latent bugs first)** — Fix PP-BUG-1 (TZ shift), PP-BUG-2 (10-bit AVIF gate via runtime probe), PP-BUG-3 (`strip_gps_on_upload` strip from disk).
2. **PR 2 (RAW lockout)** — Drop `.arw` from ALLOWED_EXTENSIONS (until libraw bundled). Improve error message for unsupported uploads.
3. **PR 3 (DPI + sharpening + HDR-detect)** — Output DPI tag, output unsharp, persist `has_hdr_gain_map`.
4. **PR 4 (resumable backfill)** — `images.pipeline_version` column, gated backfill, new pipeline-version=4 cutover.
5. **PR 5 (IPTC/XMP read + persist + preserve on derivatives)** — Schema columns, admin setting, encode-chain bit selection.
6. **PR 6 (rating/flag/color-label/published)** — Schema, keyboard shortcuts, admin grid filters, public-side `published=true` filter.
7. **PR 7 (lightbox zoom + 1:1)** — Compose `<ImageZoom>` in lightbox. Compute DEFAULT_ZOOM from natural width. Add "1:1" button.
8. **PR 8 (histogram clipping)** — R/G/B channels, clipping warnings, blinkies overlay.
9. **PR 9 (watermark pipeline)** — Schema setting, dual-track derivatives (`_wm` suffix), tier-based serve.
10. **PR 10 (Stripe webhook hardening)** — `charge.refunded` + `charge.dispute.created/closed` + `async_payment_*` handlers. event.id-based idempotency.
11. **PR 11 (shared-gallery polish)** — Password protection, `expires_at` write path + cleanup, picks-export.
12. **PR 12 (download presets + bundled zip + license flexibility)** — `download_presets` schema, archiver dep, `licenses` schema.
13. **PR 13 (Lightroom plugin)** — Commit the .lua plugin under `lightroom-plugin/`. README updates.
14. **PR 14 (med/low polish)** — Hierarchical keywords, per-topic branding, makernote read, etc.

PRs 1, 2, 3 are quick wins (latent bug fixes + correctness gaps). PRs 5, 6, 9 are the schema-level investments that unlock pro workflow. PR 13 is the headline feature that closes the SmugMug/Pixieset gap.

## Verdict

The current gallery is a polished personal portfolio site with Stripe checkout bolted on — solid color pipeline (after the recent fixes), good security posture, reasonable admin UI. **Not yet a pro deliverable platform.** A working pro shooting weddings, editorials, or commercial campaigns will hit at least one of PP-CRIT-1 through PP-CRIT-7 in their first day and route to SmugMug, Pixieset, ShootProof, or PhotoShelter.

Closing the gap is real engineering work — ~14 PRs spanning ~3-4 weeks for a single dedicated developer — but the per-PR scope is tractable, the latent bugs are cheap one-day fixes, and the architectural foundation (schema, processing pipeline, auth) is sound enough to extend without rewrites.
