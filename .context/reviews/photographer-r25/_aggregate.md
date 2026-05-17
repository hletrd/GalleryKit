# Photographer R25 — Aggregate Review (cycle 16/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflow (delivery surface).
**Pass type:** Multi-perspective single-agent pass (Task/Agent fan-out
not registered in this environment; perspectives applied serially:
code-reviewer, perf-reviewer, security-reviewer, critic, verifier,
tracer, document-specialist).

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/
processing/serving/perf/a11y/security/copyright/metadata/licensing/
download/embed/Lightroom-publish surfaces. Out-of-scope: any edit /
star-rating / culling / scoring / pick-flag / image-adjustment /
retouch / develop ideas.

## Coverage this pass

R24-M1 closed the per-photo OG route's sized-derivative fallback chain
by routing every fetch through `pickFirstAvailablePhotoBuffer` (ascending
config-driven iteration). R25 swept the OTHER server-side consumers of
sized JPEG derivatives that are used to populate publicly-rendered
delivery surfaces, looking for the same defect class.

Surfaces inventoried for sized-derivative consumption on syndication
/ social / public-rendered paths:

- `apps/web/src/app/feed.xml/route.ts:45` — root Atom feed.
  `<media:content>` URL built via
  `sizedImageFilename(img.filename_jpeg, 1536)` with NO `imageSizes`
  argument, so it defaults to `DEFAULT_IMAGE_SIZES = [640, 1536, 2048,
  4096]` regardless of the live admin `image_sizes` setting. If admin
  drops 1536 from the config, every entry's media URL points at a
  derivative that does not (and will not, after backfill) exist.
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:55` —
  topic Atom feed. Same defect, same call pattern. Both feeds share
  the bug because both copy the same line.
- `apps/web/src/app/api/og/photo/[id]/route.tsx` — re-verified post
  R24-M1; clean (uses `pickFirstAvailablePhotoBuffer` over
  `config.imageSizes`).
- `apps/web/src/app/[locale]/(public)/page.tsx:87` — homepage OG.
  Correctly passes `config.imageSizes`. Clean.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:175` — per-photo
  preload. Correctly passes `config.imageSizes`. Clean.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:188` — timeline.
  Passes its own `imageSizes`. Clean.
- All other client-component callers (`<img onError>` masonry, lightbox,
  search dropdown, on-this-day) — sized-derivative URLs come from
  client state and either carry the `<picture>` fallback or the
  R21-M1..R23-M1 onError swap. Out of this scope.

## Findings

### R25-M1 (MEDIUM, High confidence) — Atom feed media URLs ignore admin `image_sizes` setting and silently point at non-existent derivatives when 1536 is dropped from the configured size list

- **Files:**
  - `apps/web/src/app/feed.xml/route.ts:45`
  - `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:55`
- **Failure scenario:** Both feeds call
  `sizedImageFilename(img.filename_jpeg, 1536)` without passing the
  third `imageSizes` parameter. The `sizedImageFilename` helper
  (`apps/web/src/lib/image-url.ts:25`) defaults to `DEFAULT_IMAGE_SIZES
  = [640, 1536, 2048, 4096]` when the parameter is omitted and runs
  `findNearestImageSize(DEFAULT_IMAGE_SIZES, 1536)` which returns 1536
  trivially. The selected filename is always `<base>_1536.jpg`
  regardless of the live admin `image_sizes` setting.

  Concrete production trigger (same shape as R24-M1): admin
  reconfigures `image_sizes` from `[640, 1536, 2048, 4096]` to
  `[640, 2048, 4096]` (drops 1536 — common after a "we don't need that
  middle size" decision). Backfill re-encodes existing photos at the
  new sizes; `_1536.jpg` is removed for re-encoded photos. The feeds
  continue to point at `<base>_1536.jpg` for every entry.

  Consequence for the photographer's delivery surface:
  - RSS-reader thumbnails (NetNewsWire, Inoreader, Feedly, Miniflux,
    FreshRSS, TT-RSS) all 404 silently. The reader either shows no
    image at all or a broken-image icon depending on the reader's
    rendering.
  - Apple News, Slack, Discord, Mastodon, and other surfaces that
    pre-fetch `<media:content>` URLs to build link cards likewise get
    a 404 and degrade to text-only.
  - The feed entries' `<link>` to the photo viewer page works fine —
    only the inline thumbnail / preview is broken. The photographer
    has no operator-visible signal that the syndication channel is
    degraded.

- **Photographer impact:** Syndication channels (Atom / RSS) are the
  primary "follow me" subscription surface for clients and viewers.
  A silently-broken `<media:content>` thumbnail degrades EVERY entry
  in EVERY reader for the entire window between the admin config
  change and someone noticing. Mirrors the social-embed brand-
  invariant call-out from R24-M1: "the photo IS the share card", and
  in the syndication context "the photo IS the feed-entry preview".
  Same severity class as R24-M1.

- **Fix sketch:** Pass `config.imageSizes` to `sizedImageFilename`.
  Apply the same R24-M1 ascending-fallback principle: prefer the
  smallest configured size ≥ 1024 px (or fall back to the largest
  configured size if no size meets that threshold) so RSS-reader
  inline previews stay under the typical 1 MB embed budget while
  remaining sharp on retina.

  Minimal viable patch (matches `(public)/page.tsx:87` and
  `(public)/p/[id]/page.tsx:175` precedent):

  ```ts
  // root feed
  const config = await getGalleryConfig();
  const feedJpegSize = findNearestImageSize(config.imageSizes, 1536);
  // …in the entries.map closure:
  const jpegSized = sizedImageFilename(img.filename_jpeg, feedJpegSize, config.imageSizes);
  ```

  This is the same correctness-only patch the R21-M1..R23-M1 / R24-M1
  family applied to the other consumers of sized derivatives — keep
  the byte cap, keep the priority chain, just remove the hard-coded
  `_1536` assumption that pins to a single configured-size value.

  We do NOT need to add a `<picture>`-style fallback chain inside the
  feed itself (RSS readers don't render `<picture>`); passing the
  config-aware nearest-size is sufficient because `findNearestImageSize`
  is documented to "fall back to the largest size if no close match
  exists" (`gallery-config-shared.ts:251`).

  Fixture-style source-grep test asserting both feed routes call
  `findNearestImageSize(config.imageSizes, …)` and pass `config.imageSizes`
  to `sizedImageFilename` — same shape as the R24-M1
  `og-photo-fallback.test.ts` fixture.

- **Severity:** MEDIUM (public syndication surface; degrades EVERY
  feed entry's media preview for an affected gallery until admin
  notices; photographer brand impact on syndication subscribers;
  same severity class as R21-M1 / R22-M1 / R23-M1 / R24-M1
  encoder-contract / fallback closures).
- **Confidence:** High (verified by source read of both feed routes
  + `sizedImageFilename` signature + `findNearestImageSize` behavior;
  failure mode reproduces deterministically under the documented
  admin reconfigure path; precedent fix shape already shipped in
  R24-M1 for the structurally identical OG-route bug).

## Cross-perspective agreement

- **code-reviewer + verifier:** R25-M1 is a direct sibling of R24-M1
  — same defect (hard-coded `1536` selecting a non-config-aware
  derivative), same consumer class (publicly-rendered metadata
  surface), same fix pattern (pass `config.imageSizes`,
  iterate/select from the configured list). After this fix, the
  feed surface and the OG surface share a uniform config-driven
  contract for sized-derivative selection.
- **perf-reviewer:** Net cost is one additional `getGalleryConfig()`
  per feed render. That call is already memoized by React `cache()`
  and the feed itself is gated by `Cache-Control: public, max-age=600,
  s-maxage=1800` plus an If-Modified-Since 304 short-circuit, so
  amortized cost is negligible.
- **security-reviewer:** No new attack surface. The new
  `findNearestImageSize` input is admin-controlled (validated integer
  set) — same trust boundary as the existing `image_sizes` config
  consumers. Filename composition continues to flow through
  `sizedImageFilename`'s regex-anchored extension replacement.
- **architect:** The fix moves the feed routes onto the same
  config-driven discipline already shipped by `(public)/page.tsx`,
  `(public)/p/[id]/page.tsx`, `(public)/timeline/page.tsx`,
  `(public)/year/[year]/page.tsx`, and the per-photo OG route. After
  R25-M1, every server-side sized-derivative consumer in the
  publicly-rendered SEO/syndication surface uses the same pattern.
- **document-specialist:** The fix carries a comment referencing the
  R21-M1 / R22-M1 / R23-M1 / R24-M1 lineage and the encoder
  atomic-rename contract, and explains why the feed surface doesn't
  need a multi-fetch chain (RSS readers don't render `<picture>`,
  and `findNearestImageSize` already falls back to the largest
  available size).

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit / star / cull / score /
adjust ideas under the review framing.

## Existing backlog (R10..R24) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — schema-
  migration / fixture-authoring scope, blocked on a dedicated cycle.
- R10 MED open: R10-M2/M4/M5/M6/M7/M11/M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred: R17-L2 (per-entry Atom `<author>`) — still blocked
  on `uploaded_by` schema column or audit-log retrofit.
- R19-L2-OG deferred: dedicated `/api/og?collection=...`
  discriminator cycle.
- R11..R16, R18..R24: closed.

## Why R25 returned only one finding

After R24-M1 closed the per-photo OG route, the search for OTHER
server-side consumers of sized derivatives on the publicly-rendered
SEO/syndication surface narrowed to: feed routes, OG routes, and
metadata-population surfaces. The OG and the metadata-population
surfaces already pass `config.imageSizes`. The two feed routes were
the last remaining consumers carrying the hard-coded `_1536`
assumption. Once R25-M1 lands, every server-side sized-derivative
consumer in the publicly-rendered SEO/syndication surface uses the
config-driven `findNearestImageSize(config.imageSizes, …)` /
`sizedImageFilename(…, config.imageSizes)` pattern, fully closing the
admin-reconfigure-without-backfill failure class on the server side.
