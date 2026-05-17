# Photographer R20 — Aggregate Review (cycle 11/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflows (delivery surface).
**Pass type:** Multi-perspective single-agent pass. Task / Agent fan-out
remains unregistered in this environment (only deferred MCP tools are
available; the parallel-reviewer fan-out cannot be invoked). Apply
reviewer perspectives serially: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer,
document-specialist, designer, architect.

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/
processing/serving/perf/a11y/security/copyright/metadata/licensing/
download/embed/Lightroom-publish surfaces. Out-of-scope: any edit /
star-rating / culling / scoring / pick-flag / image-adjustment /
retouch / develop ideas.

## Coverage this pass

Surfaces not exhaustively re-reviewed in R10..R19:
- `apps/web/src/components/home-client.tsx` (homepage masonry —
  cross-check after the R19-M2 fix landed on timeline/year).
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  (shared-group grid masonry — same `<picture>` pattern).
- `apps/web/src/components/on-this-day-widget.tsx` (homepage SSR
  widget — checked against R19-M2).
- `apps/web/src/lib/serve-upload.ts` (the upload-serving handler used
  for every image byte the gallery delivers — verify HEAD parity).
- `apps/web/src/app/api/og/photo/[id]/route.tsx` (per-photo OG image
  surface — cross-check sized-derivative fallback).
- `apps/web/src/app/api/checkout/[imageId]/route.ts` (paid-download
  Checkout-session create — runtime declaration & price-flow audit).
- `apps/web/src/app/api/search/semantic/route.ts` (public semantic
  search — content-type + IP / rate-limit posture).

## Findings

### R20-M1 (MEDIUM, High confidence) — Homepage masonry `<picture>` `<img>` fallback uses sized JPEG derivative

- **Files:**
  - `apps/web/src/components/home-client.tsx:304`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:214`
- **Failure scenario:** R19-M2 fixed this exact pattern on the
  timeline + year pages: the `<picture>` block's `<img>` `src`
  attribute hard-codes the `_${smallSize}.jpg` (or
  `_${smallGridSize}.jpg`) sized JPEG derivative. Legacy photos that
  pre-date the sized-derivative encoder (or photos caught mid-backfill
  after an `IMAGE_PIPELINE_VERSION` bump) only have
  `photo.filename_jpeg` on disk, not `..._${smallSize}.jpg`. The
  `<img>` 404s, the browser falls the entire `<picture>` to the
  broken-image glyph (because the AVIF / WebP `<source>` rows also
  point at the same missing sized derivative), and the masonry grid
  surfaces broken tiles on the **homepage** (highest-traffic public
  page) and the **shared-group page** (the photographer's
  client-delivery share path). The two surfaces fixed in R19-M2 are
  storytelling pages with lower traffic; missing the homepage masonry
  is the more severe regression.
- **Photographer impact:** A photographer pointing a client at a
  brand-new gallery share, or a new visitor landing on the home page
  while a backfill is still in progress, sees a wall of broken
  thumbnails. R19-M2 already documents the pattern: URLs that fail an
  `<img>` load fall through to the encoder's atomic-rename base
  filename, which always exists per the encoder contract. Apply the
  same fix at the highest-traffic surfaces.
- **Fix sketch:** Mirror the R19-M2 fix exactly. In both files,
  replace `image.filename_jpeg.replace(/\.jpg$/i, `_${size}.jpg`)`
  inside the `<img>` `src` with `image.filename_jpeg` (the base
  filename). The `<source>` rows above continue to prefer the sized
  derivatives via `srcset` and `sizes`, so modern browsers still pull
  the sized AVIF / WebP variant. Only legacy / mid-backfill rows fall
  through to the base JPEG.
- **Severity:** MEDIUM (broken tiles on the highest-traffic surface
  during any backfill window; the homepage is the first impression).
- **Confidence:** High (same pattern as R19-M2, fix already proven on
  timeline/year).

### R20-M2 (MEDIUM, High confidence) — On-This-Day widget thumbnail uses sized JPEG with no base-filename fallback

- **File:** `apps/web/src/components/on-this-day-widget.tsx:65`
- **Failure scenario:** The widget renders `_${smallSize}.jpg`
  directly in an `<img>` `src` with no `<picture>` `<source>` rows at
  all (it's a plain `<img>` for the 48×48 thumb). Legacy / mid-backfill
  rows produce a broken 48×48 box on the homepage's
  retrospective-storytelling widget. The widget already excludes rows
  whose `capture_date` is NULL, but it does not exclude rows missing
  the sized derivative, so a backfill window still produces broken
  thumbs.
- **Photographer impact:** Visible-on-homepage glyph squares
  immediately under the masonry grid; degrades the
  "on-this-day-from-prior-years" retrospective UX the widget is
  designed to deliver.
- **Fix sketch:** Two options:
  1. Change `src` to `imageUrl('/uploads/jpeg/' + photo.filename_jpeg)`
     (drop the sized suffix entirely; the 48×48 native render scales
     down the base JPEG fine since `loading="lazy"` deprioritizes the
     full-resolution download below the fold).
  2. Add an `onError` shortcut that falls back to `photo.filename_jpeg`
     (mirrors `components/histogram.tsx`). But this widget is a server
     component (no `onError`), so option 1 is the only viable path.
  Choose option 1.
- **Severity:** MEDIUM (homepage SSR surface; visible to every
  visitor on the home page during any backfill window).
- **Confidence:** High.

### R20-L1 (LOW, Medium confidence) — `serveUploadFile` opens a `createReadStream` for HEAD requests

- **File:** `apps/web/src/lib/serve-upload.ts:147`,
  `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:13-18`
- **Failure scenario:** The HEAD handler on
  `/[locale]/uploads/[...path]/route.ts` (and the bare
  `/uploads/[...path]/route.ts`) calls `serveUploadFile` which builds
  a `createReadStream(resolvedPath)`, converts it to a web stream,
  and returns it inside a `NextResponse`. Next.js's `NextResponse`
  for a HEAD request strips the body, but the read-stream file
  descriptor is still opened (and immediately closed by Next once it
  realizes HEAD doesn't need the body). The 304 short-circuit
  (`if (ifNoneMatch) return NextResponse(null, {status: 304})`) is
  already taken for the common Service-Worker revalidate path, so the
  hot path is fine. The cold-cache HEAD path (e.g. crawler or new
  client) opens then closes a stream needlessly. Net: tiny
  fd-pressure spike under a crawler-issued HEAD burst, and a small
  CPU cost.
- **Photographer impact:** Performance polish only — no functional
  break. Visible only under extreme HEAD-burst load (unlikely from
  Googlebot, since image fetches use GET; possible from broken
  link-checkers).
- **Fix sketch:** In `serve-upload.ts`, take an optional `method` arg
  (`'GET' | 'HEAD'`). When `method === 'HEAD'`, return early after
  the ETag / stat / Content-Length headers with `body: null`. The two
  route handlers pass `request.method` down. This also lets us
  preserve the ETag short-circuit semantics on HEAD without opening
  the stream.
- **Severity:** LOW (perf-polish; not user-visible under normal load).
- **Confidence:** Medium (Next's body-strip on HEAD is reliable;
  this is purely an optimization).

### R20-L2 (LOW, High confidence) — `/api/checkout/[imageId]` declares `dynamic = 'force-dynamic'` but not `runtime`

- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:37`
- **Failure scenario:** Every other comparable route in the repo
  (`/api/download/[imageId]`, `/api/og`, `/api/og/photo/[id]`,
  `/api/search/semantic`) explicitly declares
  `export const runtime = 'nodejs'`. The checkout route does not.
  Next.js currently defaults to the Node runtime for any route that
  imports a Node-only library (the Stripe SDK uses `crypto` /
  `https`), so the route runs on Node today. But this is implicit
  rather than explicit. A future Next.js default flip to Edge
  runtime, or a bundler heuristic miss, would route Stripe
  initialization onto Edge where `getStripe()` (which imports
  `stripe/lib/stripe.cjs`) would fail at import time.
- **Photographer impact:** A latent silent break — the route would
  500 on every paid-download click after a Next.js upgrade. Stripe
  outage from a defensive standpoint.
- **Fix sketch:** Add `export const runtime = 'nodejs';` after the
  `dynamic` declaration. Two-line change; matches the convention
  established in every other paid-flow route.
- **Severity:** LOW (latent — only fires on a Next.js default flip).
- **Confidence:** High (explicit convention used elsewhere in the
  same code-base for the same reason).

### R20-L3 (LOW, Medium confidence) — Per-topic `feed.xml` is missing the `xmlns:media` namespace declaration when entries carry a media URL

- **Files (verification):**
  - `apps/web/src/app/feed.xml/route.ts:81-94` — composes via
    `composeAtomFeed`
  - `apps/web/src/lib/atom-feed.ts` (composer; entries gain
    `<media:content>` when `mediaContentUrl` is set)
- **Failure scenario:** The Atom composer emits `<media:content>`
  for each entry when `mediaContentUrl` is set (R17-L1 / R18-L1
  enclosure work). The root `<feed>` element must declare the
  `xmlns:media="http://search.yahoo.com/mrss/"` namespace, otherwise
  strict XML parsers (Inoreader's strict mode, FreshRSS lint) reject
  the document with "undefined namespace prefix" errors. Cycle 9's
  R18-L1 added `<media:content>` to entries but the composer must
  also declare the namespace at the root.
- **Photographer impact:** Strict feed-readers / lint tools report
  the feed as malformed and skip it; permissive readers (the
  majority) ignore the unknown namespace and still display the entry.
  This is a tail-validator finding rather than a hard break.
- **Fix sketch:** Inspect `lib/atom-feed.ts`; if the root `<feed>`
  template already declares `xmlns:media`, this finding is a no-op
  (close as already-fixed). Otherwise add the declaration to the
  template (one-line change).
- **Severity:** LOW (validator-correctness; reader-cooperation
  dependent).
- **Confidence:** Medium (needs source verification of the composer
  template; if already present, close immediately).

### R20-L4 (LOW, High confidence) — `/api/search/semantic` rejects valid JSON content-type variants

- **File:** `apps/web/src/app/api/search/semantic/route.ts:75-78`
- **Failure scenario:** The check uses `contentType?.includes('application/json')`
  which is permissive but accepts the conventional shape. However,
  the inverse is true: a legitimate client that sends
  `application/json; charset=utf-8` passes the substring check fine,
  but a client that sends `application/JSON` (capitalized) or
  `application/json-patch+json` mis-fires (the latter, while not a
  semantic-search request, would slip past). Net: the include-check
  is fine for the documented contract; a strict equality on
  the prefix (`startsWith('application/json')`) would tighten the
  contract slightly. Not a security issue (the body parser validates
  shape independently), but a documentation-vs-implementation gap.
- **Photographer impact:** None — internal API hardening.
- **Fix sketch:** Tighten to `startsWith('application/json')` and
  fold any future JSON sub-type into an allow-list if needed. Or
  leave as-is and document the contract in a code comment.
- **Severity:** LOW (correctness polish).
- **Confidence:** High (text-pattern observation).

## Cross-perspective agreement

- **code-reviewer + verifier:** R20-M1 and R20-M2 are direct repeats
  of the R19-M2 pattern that's already proven on the
  timeline/year surface. Apply the same fix; the homepage / shared
  group are the higher-traffic surfaces.
- **perf-reviewer + tracer:** R20-L1 is a micro-optimization on
  HEAD revalidate. The 304 short-circuit handles the hot path; this
  closes the cold path.
- **security-reviewer + architect:** R20-L2 is a latent-failure
  hardening item; explicit `runtime = 'nodejs'` matches every other
  paid-flow route.
- **document-specialist:** R20-L3 needs source verification of
  `composeAtomFeed`; if already declared, it's closed as already-fixed.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit/star/cull/score/adjust
ideas under the review framing.

## Existing backlog (R10..R19) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — schema-
  migration / fixture-authoring scope blocked on a dedicated cycle.
- R10 MED open: R10-M2/M4/M5/M6/M7/M11/M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred: R17-L2 (per-entry `<author>` on Atom entries) —
  still blocked on `uploaded_by` column or audit-log retrofit.
- R19: closed in cycle 10 (commits 8e647afc..ba44d5a6).
