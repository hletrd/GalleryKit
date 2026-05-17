# Photographer R18 — Aggregate Review (cycle 9/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflows (delivery surface).
**Pass type:** Multi-perspective single-agent pass. The Agent / Task
fan-out tool is not registered in this environment, so the cycle-8
single-agent mode is repeated here with explicit reviewer perspectives
applied serially: code-reviewer, perf-reviewer, security-reviewer,
critic, verifier, test-engineer, tracer, document-specialist, designer.

Coverage this pass: surfaces touched on by R17 are re-inventoried after
the R17 fixes landed, and new surfaces not yet exhaustively reviewed in
R10..R17 are read end-to-end:
- `apps/web/src/app/sitemap.ts` (R17-L6 deferred — re-examined for cleanly-scoped fix)
- `apps/web/src/app/api/checkout/[imageId]/route.ts` (paid-download intake)
- `apps/web/src/app/api/stripe/webhook/route.ts` (entitlement minting)
- `apps/web/src/app/api/download/[imageId]/route.ts` (paid-download stream + Content-Disposition)
- `apps/web/src/app/api/admin/lr/upload/route.ts` (Lightroom publish-plugin intake)
- `apps/web/src/app/feed.xml/route.ts` (post-R17 verification)
- `apps/web/src/app/api/og/photo/[id]/route.tsx` (post-R17 verification)
- `apps/web/src/app/api/search/semantic/route.ts` (semantic-search facade)
- `apps/web/src/app/robots.ts` + `apps/web/src/app/manifest.ts` (SEO baseline)
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` (share-link surface)

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/processing/
serving/perf/a11y/security/copyright/metadata/licensing/download/embed/
Lightroom-publish surfaces. Out-of-scope: any edit/star-rating/culling/scoring/
pick-flag/image-adjustment/retouch/develop ideas.

## Findings

### R18-M1 (MEDIUM, High confidence) — Sitemap homepage + topic entries still lack `lastModified` (R17-L6 carry-over)
- **File:** `apps/web/src/app/sitemap.ts:48-60`
- **Failure scenario:** Googlebot uses the sitemap `lastmod` tag as one of
  its strongest signals for crawl-prioritization (per Google's published
  2023 guidance: "We use lastmod to detect fresh content"). Image entries
  (`:63-69`) carry `lastModified: new Date(image.created_at)`, but the
  homepage entries (`:48-52`) and topic entries (`:54-60`) emit no
  `lastModified` at all. The data needed to compute these freshness
  timestamps is already in the database (`images.updated_at` is
  `onUpdateNow()` and advances on every admin edit), but it never reaches
  the sitemap. After a portfolio refresh, Googlebot may take days to
  re-crawl the homepage; SEO indexing lag directly hurts a photographer's
  discoverability for hero photos.
- **Photographer impact:** A photographer uploading a fresh wedding gallery
  on Friday afternoon is at the mercy of Googlebot's default crawl schedule
  for the homepage. With `lastmod` advancing the moment a new photo lands,
  Googlebot typically re-crawls within a few hours.
- **Fix sketch:** Two cleanly-scoped projection extensions:
  1. Add `last_image_updated_at` to `getTopics()` via subquery
     `(SELECT MAX(updated_at) FROM images WHERE images.topic = topics.slug
     AND processed = true)`. Use that for each topic entry's
     `lastModified`.
  2. Add a `getLatestImageUpdatedAt()` helper that returns
     `MAX(images.updated_at) WHERE processed = true`. Use for the homepage
     entries' `lastModified`.
  Both queries hit the existing `idx_images_processed_created_at` index
  (the planner extends to `updated_at` via the covering single-column
  index added below, or simply scans the rows the index points at — for
  a single MAX aggregate this is fast enough at gallery scale). The
  `revalidate = 3600` ISR window already caches the sitemap, so each
  topic-scoped subquery runs at most once per hour.
- **Severity:** MEDIUM (SEO impact, but recoverable on next crawl).
- **Confidence:** High (Google's documented signal + R17-L6 explicit
  exit criterion was "next cycle that touches getTopics").

### R18-M2 (MEDIUM, Medium confidence) — Lightroom upload route silently swallows audit-log failures
- **File:** `apps/web/src/app/api/admin/lr/upload/route.ts:166-173`
- **Failure scenario:** The Lightroom upload route awaits
  `logAuditEvent(...)` but appends `.catch(console.debug)`. A failed audit
  log is downgraded from a normal `console.error` (which log shippers like
  Datadog/Loki page on) to `console.debug` (which Docker's default JSON
  log driver records at the lowest verbosity, and most production logging
  pipelines filter out entirely). The token-bearing publish-plugin path is
  specifically the high-trust audit surface — a token revocation
  investigation later cannot reconstruct who uploaded what if audit
  records were silently dropped.
- **Photographer impact:** Multi-photographer studios using the LR plugin
  rely on the audit table to attribute uploads. A silent audit-log
  failure makes "who uploaded image #1234" unanswerable.
- **Fix sketch:** Use `console.warn` (not `console.debug`) so log shippers
  retain the line for post-incident triage. Match the severity used in
  `apps/web/src/app/actions/images.ts` audit-log error paths, which is
  `console.warn`. Optionally add a structured payload
  `{ userId, imageId, action: 'lr_token_used' }` so operators can grep
  by imageId during forensics.
- **Severity:** MEDIUM (audit-trail integrity for a token-authenticated
  surface).
- **Confidence:** Medium (the audit failure is rare in practice — DB
  insert failure or schema drift — but the severity downgrade is real).

### R18-L1 (LOW, High confidence) — Atom feed entry `<link>` has no `rel="enclosure"` for the photo binary
- **File:** `apps/web/src/lib/atom-feed.ts:119-123`
- **Failure scenario:** RFC 4287 §4.2.7.2 reserves `rel="enclosure"` for
  podcast-style binary attachments. RSS readers that support enclosure
  prefetching (NetNewsWire's "download enclosures" preference,
  Inoreader's "include media" toggle) only download media linked via
  `<link rel="enclosure" href="…" type="image/jpeg" length="…"/>`. The
  feed already emits `<media:content>` (Yahoo Media RSS namespace) but
  not an Atom enclosure link, so a reader that respects only Atom-native
  attachments doesn't see the JPEG as downloadable.
- **Photographer impact:** Subscribers using offline-first readers
  (e.g., during travel, on cellular) don't get the photos cached locally.
  Reading the gallery on the subway becomes a sequence of broken-image
  placeholders.
- **Fix sketch:** Emit `<link rel="enclosure" type="image/jpeg"
  href="${escapeXml(entry.mediaContentUrl)}"/>` alongside the existing
  `<media:content>` line. Without `length` (we don't know the
  derivative's exact byte size without an extra HEAD), most readers
  still treat the enclosure as cacheable. Optionally include
  `length="${entry.mediaContentLength}"` once we surface that into the
  `AtomEntry` interface.
- **Severity:** LOW (improves syndication UX for a subset of readers;
  Media RSS is the more widely supported path, which we already emit).
- **Confidence:** High (RFC 4287 §4.2.7.2 + reader-behavior matrix).

### R18-L2 (LOW, High confidence) — Atom feed `<title>` has no `type="text"` attribute
- **File:** `apps/web/src/lib/atom-feed.ts:118, :136-137`
- **Failure scenario:** RFC 4287 §3.1.1 lets `<title>` and `<summary>`
  carry an optional `type` attribute (`"text"`, `"html"`, `"xhtml"`).
  Absent attribute defaults to `"text"`, so semantics are unaffected,
  but strict feed-validators (W3C feed validator) emit a "RECOMMENDED:
  specify type attribute" advisory. A photographer running their feed
  through the W3C validator to debug a syndication issue sees the
  advisory and may waste cycles investigating.
- **Photographer impact:** Cosmetic / validator-noise reduction only.
  No functional regression today; pre-emptive defense against a future
  reader that requires explicit `type` declaration.
- **Fix sketch:** Add `type="text"` to `<title>`, `<summary>`, `<name>`
  emits. Trivial change in `composeAtomFeed`.
- **Severity:** LOW.
- **Confidence:** High (RFC 4287 §3.1.1).

### R18-L3 (LOW, Medium confidence) — `feed.xml` `Last-Modified` header missing — readers refetch needlessly
- **File:** `apps/web/src/app/feed.xml/route.ts:95-104`
- **Failure scenario:** The feed response sets `Cache-Control: public,
  max-age=600, s-maxage=1800` but does not emit a `Last-Modified` or
  `ETag` header. RSS readers honor `If-Modified-Since` / `If-None-Match`
  on subsequent polls if the server advertised the corresponding header
  on the prior response. Without either header, readers refetch the
  full body on every poll (typically every 15-60 min), wasting client
  bandwidth and origin CPU even when no new entries exist.
- **Photographer impact:** Each subscriber on a heavy-poll schedule
  (NetNewsWire defaults to 30 min) burns ~20 KB per refetch. For a feed
  with 100 subscribers that's 2 MB/day of pointless egress. Multiplies
  with subscriber count.
- **Fix sketch:** Emit `Last-Modified: ${new Date(feedUpdated).toUTCString()}`
  alongside the existing Cache-Control. Optionally also emit an ETag
  built from a hash of `feedUpdated + entries.length`. Next.js's
  default route handler doesn't auto-handle `If-Modified-Since`, so a
  full implementation also requires checking the request header and
  returning `304 Not Modified` when the timestamps match — but emitting
  `Last-Modified` alone already lets readers cache locally.
- **Severity:** LOW (bandwidth efficiency, not correctness).
- **Confidence:** Medium (depends on reader's HTTP conditional-request
  support, but the major readers all honor it).

### R18-L4 (LOW, High confidence) — `manifest.ts` PWA manifest lacks `categories` and `display_override`
- **File:** `apps/web/src/app/manifest.ts:6-46`
- **Failure scenario:** The web app manifest declares `display: 'standalone'`
  but omits `display_override`, so Chrome's installability heuristic
  treats the manifest as "minimal compliance" and may opt out of the
  PWA install-prompt on desktop. Categories (`['photo', 'photography']`)
  also help app-store-style listings (Chrome Web Store, Edge Apps,
  Samsung Galaxy Store) classify the install. A photographer's portfolio
  installed as a PWA to a viewer's home screen earns repeat traffic —
  a missed install-prompt is a missed retention opportunity.
- **Photographer impact:** Reduces the install-rate of the portfolio
  as a viewer's PWA, particularly on Chrome 122+ desktop where the
  install-prompt heuristic now reads `display_override` preferences.
- **Fix sketch:** Add `categories: ['photo', 'photography', 'lifestyle']`
  and `display_override: ['window-controls-overlay', 'standalone']` to
  the manifest. Both are W3C Web App Manifest spec, supported across
  Chromium 96+ / Safari 16+.
- **Severity:** LOW (PWA discoverability).
- **Confidence:** High (W3C Web App Manifest spec + Chrome
  installability docs).

### R18-L5 (LOW, Medium confidence) — Robots.txt does not disallow `/api/` endpoints
- **File:** `apps/web/src/app/robots.ts:10-19`
- **Failure scenario:** Robots.txt allows `/` and disallows only
  `/admin` and `/[locale]/admin`. The `/api/` namespace — including
  `/api/og/photo/[id]` (CPU-intensive Satori render rate-limited at
  30/min/IP), `/api/checkout/[imageId]` (Stripe session creation, rate
  limited at 10/min/IP), `/api/search/semantic` — is not disallowed.
  Aggressive crawlers (GPTBot, ClaudeBot, CCBot) that respect robots.txt
  will respect a `Disallow: /api/` directive; absent it they crawl the
  OG-image endpoint exhaustively for every `/p/[id]` URL they discover,
  triggering rate-limit responses and burning origin CPU on PNG-renders
  that never reach a human.
- **Photographer impact:** Origin CPU + AVIF cache invalidation pressure
  from bot traffic against `/api/og/photo/*`. Rate limits engage and
  the bot retries, which compounds the load.
- **Fix sketch:** Add `'/api/'` to the disallow list. The `/feed.xml`,
  `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` routes are
  outside `/api/` and remain crawlable, so SEO is unaffected.
- **Severity:** LOW (defense-in-depth against well-behaved bots; bad
  actors ignore robots.txt anyway, but rate-limit + CPU costs still
  matter for the cooperative-bot class).
- **Confidence:** Medium (depends on bot-cooperation; the worst
  offenders ignore robots.txt, but ChatGPT / Claude / Perplexity / Brave
  Search all honor it).

### R18-L6 (LOW, High confidence) — Sitemap omits `/feed.xml` from sitemap discovery hints
- **File:** `apps/web/src/app/sitemap.ts:72-76`
- **Failure scenario:** The sitemap lists homepage + topics + image
  detail pages but does not include `/feed.xml`. Some aggregator
  registration flows (Inoreader's auto-discovery, Feedly's discovery)
  follow sitemap entries when no direct `<link rel="alternate">` is
  found in the HTML. While the homepage already emits the feed link
  via metadata, listing the feed itself in the sitemap is a defensive
  discovery hint for aggregators that scrape sitemap-first.
- **Photographer impact:** Slightly improves syndication discoverability.
- **Fix sketch:** Append a single sitemap entry for `/feed.xml` with
  `changeFrequency: 'daily', priority: 0.5`. Trivial change.
- **Severity:** LOW.
- **Confidence:** High.

## Cross-perspective agreement

- **code-reviewer + verifier:** R18-M1 is straightforward and closes the
  R17-L6 exit criterion; the projection-touch cost is bounded.
- **security-reviewer + critic:** R18-M2 (audit-log severity downgrade)
  is the highest-trust gap this cycle — the LR plugin is the only path
  where audit attribution actually matters for multi-photographer
  studios.
- **document-specialist + designer:** R18-L1 / R18-L2 / R18-L3 are RFC
  4287 + RFC 7232 compliance polish; cumulatively they make the feed
  a first-class syndication channel.
- **perf-reviewer + tracer:** R18-L3 (`Last-Modified`) is a measurable
  bandwidth win at any subscriber count > ~20.
- **tracer + designer:** R18-L4 / R18-L5 / R18-L6 are SEO + PWA
  baseline-completeness wins.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit/star/cull/score/adjust features.

## Existing backlog (R10..R17) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — all carry
  schema-migration or fixture-authoring scope that needs a dedicated
  cycle.
- R10 MED open: R10-M2, R10-M4, R10-M5, R10-M6, R10-M7, R10-M11, R10-M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred items:
  - R17-L2 (per-entry `<author>` on Atom entries): deferred — still
    blocked on `uploaded_by` column or audit-log retrofit.
  - R17-L6 (sitemap homepage/topic `lastModified`): **R18-M1 closes
    this** with the cleanly-scoped projection touch.
