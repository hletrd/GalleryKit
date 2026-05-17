# Photographer R19 — Aggregate Review (cycle 10/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflows (delivery surface).
**Pass type:** Multi-perspective single-agent pass. Task / Agent fan-out
remains unregistered in this environment, so cycle-8/-9 single-agent
mode is repeated with explicit reviewer perspectives applied serially:
code-reviewer, perf-reviewer, security-reviewer, critic, verifier,
test-engineer, tracer, document-specialist, designer, architect.

Coverage this pass: surfaces not exhaustively re-reviewed in R10..R18:
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
  (Timeline navigator — new since R10 baseline)
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
  (Year-in-review — new since R10 baseline)
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
  (Smart-collection public surface — limited prior coverage)
- `apps/web/src/app/feed.xml/route.ts` +
  `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
  (post-R18-L3 verification: `Last-Modified` header emitted but
  conditional-request handling unfinished)
- `apps/web/src/app/sitemap.ts` (post-R18-M1/L6 verification —
  per-topic feed.xml URLs still missing)
- `apps/web/src/components/on-this-day-widget.tsx` (rendered into
  homepage SSR — verify a11y + image-fallback handling)

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/processing/
serving/perf/a11y/security/copyright/metadata/licensing/download/embed/
Lightroom-publish surfaces. Out-of-scope: any edit/star-rating/culling/scoring/
pick-flag/image-adjustment/retouch/develop ideas.

## Findings

### R19-M1 (MEDIUM, High confidence) — Feed routes emit `Last-Modified` but don't honor `If-Modified-Since`
- **Files:**
  - `apps/web/src/app/feed.xml/route.ts:26, :95-118`
  - `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:25-44, :98-117`
- **Failure scenario:** R18-L3 added `Last-Modified: <UTC>` to both feed
  responses but did not add the conditional-request branch. The cycle-9
  plan note explicitly acknowledged this: "Next.js's default route
  handler doesn't auto-handle `If-Modified-Since`, so a full
  implementation also requires checking the request header and
  returning `304 Not Modified` when the timestamps match — but emitting
  `Last-Modified` alone already lets readers cache locally." In
  practice, the most common RSS readers (NetNewsWire 7+, Inoreader,
  Feedly, Miniflux, FreshRSS, Tiny Tiny RSS) all issue
  `If-Modified-Since` on subsequent polls; without a 304 response they
  re-download the full feed body on every poll. The bandwidth-savings
  rationale that motivated R18-L3 is therefore only half-realized.
- **Photographer impact:** Per the R18-L3 math, a 100-subscriber feed
  on a 30-min poll generates ~2 MB/day of pointless egress. With the
  current header-only implementation the readers' local cache window
  is shorter (only Cache-Control `max-age=600` ≈ 10 min, then they
  refetch); honoring conditional requests collapses every "I checked
  but nothing changed" poll into a ~200-byte 304.
- **Fix sketch:** In both routes, before composing the XML body, parse
  `request.headers.get('if-modified-since')` into a `Date`. Compute
  `feedUpdated` (already done) and compare. If the request's
  IMS-timestamp is greater-or-equal to `new Date(feedUpdated)`
  truncated to second precision (HTTP-date is second-precision; ISO
  ms must be floored to match), return a 304 with no body carrying
  the same `Last-Modified`, `Cache-Control`, and `Vary` headers. The
  304 response carries no body so Content-Type is intentionally
  omitted (RFC 7232 §4.1). The DB query for entries still runs (since
  `feedUpdated` is derived from the same rows); a follow-up
  optimization to compute `feedUpdated` from a cheap `MAX(updated_at)`
  projection without fetching the entries would close the remaining
  round-trip, but that's a separate plan.
- **Severity:** MEDIUM (bandwidth + origin CPU, recoverable but
  visible at any subscriber count > ~20).
- **Confidence:** High (RFC 7232 §3.3 spec + RSS-reader behavior
  matrix; the R18-L3 plan note explicitly flagged this gap).

### R19-M2 (MEDIUM, Medium confidence) — Timeline + Year picture fallback uses sized JPEG without a base-filename safety net
- **Files:**
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx:175-184`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:137-146`
- **Failure scenario:** Both pages emit a `<picture>` fan-out whose
  `<img>` fallback hard-codes the sized JPEG derivative
  (the `_${smallSize}.jpg` filename). Legacy photos that pre-date the
  sized-derivative encoder (or photos caught mid-backfill after a
  `pipeline_version` bump) only have `photo.filename_jpeg` on disk,
  not `..._${smallSize}.jpg`. The fallback `<img>` then 404s, browsers
  fail the entire `<picture>` to the broken-image glyph, and the
  photographer's storytelling timeline surfaces broken tiles. The
  histogram code took the same pitfall in R9-M9 and ships an `<img>`
  `onerror` shortcut to the base filename (see
  `components/histogram.tsx`). The pattern is documented in `CLAUDE.md`
  under "Color & HDR Pipeline" -> "Histogram": URLs that fail an
  `<img>` load are short-circuited so legacy photos missing a
  `_640.jpg` derivative cleanly fall through to the base filename
  (always exists per encoder atomic-rename contract).
- **Photographer impact:** Timeline / Year pages are
  photographer-storytelling surfaces — broken tiles undermine the
  retrospective. The masonry homepage already routes through
  `OptimisticImage` which has the safe fallback chain; only these two
  hand-rolled `<picture>` blocks miss it.
- **Fix sketch:** Two equally valid options:
  1. Replace the hand-rolled `<picture>` block with `OptimisticImage`
     (or the next/image wrapper) so the project's existing fallback
     plumbing handles legacy rows uniformly.
  2. Keep the `<picture>` but use the base filename for the `<img>`
     `src` attribute (the encoder contract guarantees this always
     exists on disk) while the AVIF/WebP `<source>` rows continue to
     prefer the sized derivatives via `srcset` fallback semantics.
     The browser's `<picture>` decoder picks the first viable
     `<source>`; the `<img>` `src` is only loaded if all `<source>`
     rows fail, so the base-filename fallback adds no extra bytes for
     modern browsers.
  Option 2 is the smaller diff and preserves the page's
  responsive-srcset behavior. Mirror the same fix on both files.
- **Severity:** MEDIUM (broken tiles on a photographer-storytelling
  surface; degrades trust in the gallery).
- **Confidence:** Medium (the failure only triggers for un-backfilled
  rows; current production may be fully backfilled, but the next
  `IMAGE_PIPELINE_VERSION` bump re-opens the window during the
  backfill run).

### R19-L1 (LOW, High confidence) — Smart-collection `/c/[slug]` returns empty title for missing/private collections
- **File:** `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17-26`
- **Failure scenario:** When the slug doesn't exist or
  `is_public=false`, `generateMetadata` returns
  `{ title: '', robots: { index: false, follow: false } }`. While the
  noindex directive prevents most crawlers from indexing the page, a
  human visitor who lands on the link (e.g., share-leak) sees an empty
  `<title>` element rendered in the browser tab as the URL itself.
  Empty titles are also flagged as accessibility regressions by
  Lighthouse / axe-core. Other not-found surfaces in the codebase
  (`/p/[id]/page.tsx:51-57`, `/[topic]/page.tsx:59-62`) return a
  translated `t('notFoundTitle')` value.
- **Photographer impact:** Cosmetic / a11y; a shared collection link
  whose collection was unpublished shows a confusing blank-title page.
- **Fix sketch:** Add a `notFound` translation block to
  `messages/{en,ko}.json` under `smartCollection`, then return
  `{ title: t('notFoundTitle'), robots: ... }` here. Mirror the
  pattern in `/[topic]/page.tsx:59`.
- **Severity:** LOW (a11y + UX polish).
- **Confidence:** High.

### R19-L2 (LOW, High confidence) — Smart-collection `/c/[slug]` metadata missing hreflang alternates + OG image
- **File:** `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:33-57`
- **Failure scenario:** Compared to `/[topic]/page.tsx:99-125` which
  emits both `alternates.languages` (hreflang) and an `openGraph.images`
  array, the smart-collection metadata block emits neither. Search
  engines treat `/en/c/{slug}` and `/ko/c/{slug}` as separate pages
  with no associated translation pair, which can trigger
  duplicate-content penalties. Social previews of the share URL show
  no OG image — the `/api/og?...` fallback is never invoked.
- **Photographer impact:** Smart collections are the curated-set
  surface that photographers point clients at via share links;
  missing OG images make social shares look unfinished.
- **Fix sketch:**
  1. Add `alternates.languages = buildHreflangAlternates(seo.url,
     /c/{collection.slug})`.
  2. Add `openGraph.images` block similar to the topic page:
     `seo.og_image_url ? [{ url: seo.og_image_url, ... }] : [{ url:
     `${seo.url}/api/og?collection=${collection.slug}`, ... }]`
     (the `/api/og` handler already accepts `topic`; adding a
     `collection` discriminator is a one-line `else if` in
     `apps/web/src/app/api/og/route.tsx` — but for this LOW we can
     ship with `og_image_url` fallback only and defer the new param).
- **Severity:** LOW (SEO + social-preview polish).
- **Confidence:** High.

### R19-L3 (LOW, Medium confidence) — Sitemap omits per-topic `/{locale}/{topic}/feed.xml` URLs
- **File:** `apps/web/src/app/sitemap.ts:88-93`
- **Failure scenario:** R18-L6 added the root `/feed.xml` to the
  sitemap, but each topic has its own per-locale feed at
  `/{locale}/{topic}/feed.xml` (see
  `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`) and
  these are invisible to sitemap-first aggregators (Inoreader, Feedly
  auto-discovery). A photographer who curates a "weddings" topic and
  wants subscribers to follow that feed specifically must rely on the
  `<link rel="alternate" application/atom+xml>` tag in the topic page
  HTML, but aggregators that scrape sitemap first never see it.
- **Photographer impact:** Per-topic syndication discoverability;
  niche-interest subscribers can't auto-subscribe to a single topic.
- **Fix sketch:** Append a `topicFeedEntries` block to the sitemap
  return, one entry per `(locale, topic)` pair with
  `lastModified: topic.last_image_updated_at` (already projected by
  `getTopics()` per R18-M1), `changeFrequency: 'daily'`, `priority:
  0.4`. The 50000-URL budget already reserves `topics.length *
  LOCALES.length` slots for the topic listing pages; adding the
  per-topic feed doubles that count but each topic-listing/feed pair
  is bounded (gallery typically has < 50 topics, so < 200 new URLs for
  a 2-locale build).
- **Severity:** LOW (syndication discoverability).
- **Confidence:** Medium (aggregator-cooperation dependent).

### R19-L4 (LOW, High confidence) — Timeline + Year pages emit no JSON-LD `ImageGallery`
- **Files:**
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx:71-201`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:67-163`
- **Failure scenario:** Homepage, `/[topic]`, and `/c/[slug]` all emit
  a `schema.org/ImageGallery` JSON-LD block (`grep -rn ImageGallery`
  on `(public)`) that lets Google's image-search surface "Gallery"
  rich results pointing back at the page. The timeline/year pages —
  arguably the most photographer-relevant SEO surfaces because they
  drive the "photos from {year}" long-tail traffic — emit none.
- **Photographer impact:** Year-in-review pages are exactly the SEO
  surface that catches "wedding photographer 2024 portfolio" long-tail
  queries; missing the gallery markup leaves rich-result eligibility
  on the table.
- **Fix sketch:** Mirror the existing pattern in
  `/[topic]/page.tsx:188-199`: build a `galleryLd` object from
  `monthSections.flatMap(({ images }) => images).slice(0, 10)`, then
  render via the existing CSP-nonce JSON-LD pattern used in `[topic]`
  and `/c/[slug]`. Use `localizeUrl(baseUrl, locale, /year/{yearNum})`
  for the `url` field on the year page; use
  `localizeUrl(baseUrl, locale, /timeline)` plus the selected-year
  query param for the timeline page.
- **Severity:** LOW (SEO polish; gallery rich results are not
  guaranteed to appear, but eligibility costs nothing).
- **Confidence:** High (existing pattern, applied 3 times already).

## Cross-perspective agreement

- **code-reviewer + verifier:** R19-M2 is straightforward — the fallback
  pattern already exists in `components/histogram.tsx`; applying it to
  timeline/year is a code-pattern reuse, not new design.
- **perf-reviewer + tracer:** R19-M1 is the highest-leverage bandwidth
  win of this cycle for any reasonable subscriber count; it directly
  finishes the R18-L3 implementation.
- **document-specialist + designer:** R19-L1 / R19-L2 are SEO + a11y
  hygiene on the smart-collection surface, which is the
  photographer-share path that arguably matters most for client
  delivery.
- **architect + tracer:** R19-L3 + R19-L4 are SEO surface-area gaps;
  both extend the established patterns from the topic/home pages
  rather than introducing new surface.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit/star/cull/score/adjust ideas
under the review framing.

## Existing backlog (R10..R18) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — all carry
  schema-migration or fixture-authoring scope that needs a dedicated
  cycle.
- R10 MED open: R10-M2, R10-M4, R10-M5, R10-M6, R10-M7, R10-M11, R10-M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred:
  - R17-L2 (per-entry `<author>` on Atom entries): deferred — still
    blocked on `uploaded_by` column or audit-log retrofit.
- R18: all items closed in cycle 9 (commits b8a9f33b..ba9be684).
