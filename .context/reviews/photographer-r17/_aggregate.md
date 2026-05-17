# Photographer R17 — Aggregate Review (cycle 8/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflows (delivery surface).
**Pass type:** Multi-perspective single-agent pass. The Agent / Task
fan-out tool is not registered in this environment, so the cycle-7
single-agent mode is repeated here with explicit reviewer perspectives
applied serially: code-reviewer, perf-reviewer, security-reviewer,
critic, verifier, test-engineer, tracer, document-specialist, designer.
Coverage targets surfaces NOT covered by R10–R16:
- `apps/web/src/app/feed.xml/route.ts` (Atom feed correctness)
- `apps/web/src/lib/atom-feed.ts` (XML composer)
- `apps/web/src/app/api/og/photo/[id]/route.tsx` (per-photo OG image)
- `apps/web/src/app/api/admin/lr/upload/route.ts` (Lightroom publish surface)
- `apps/web/src/app/api/download/[imageId]/route.ts` (paid-download single-use)
- `apps/web/src/app/sitemap.ts` (sitemap freshness)

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/processing/
serving/perf/a11y/security/copyright/metadata/licensing/download/embed/
Lightroom-publish surfaces. Out-of-scope: any edit/star-rating/culling/scoring/
pick-flag/image-adjustment/retouch/develop ideas.

## Findings

### R17-M1 (MEDIUM, High confidence) — Atom feed is invalid per RFC 4287: missing `<author>`
- **File:** `apps/web/src/lib/atom-feed.ts:56-84`, consumed by
  `apps/web/src/app/feed.xml/route.ts:53-60`
- **Failure scenario:** RFC 4287 §4.1.1 says an `atom:feed` MUST contain
  one or more `atom:author` elements UNLESS every `atom:entry` carries
  its own. This composer emits neither. Strict validators (Feedly, NetNewsWire,
  Atom W3C feed validator) flag the feed as invalid and may refuse to subscribe
  or display the author column as "Unknown". `seo_author` is already an
  admin-configurable string (`getSeoSettings().author`), so the data exists —
  it's just never propagated to the XML.
- **Photographer impact:** A photographer publishing their own work via RSS
  reasonably expects the feed to identify them as the author. RSS aggregators
  use the author field for filtering / muting / OPML grouping. Silent
  invalidity costs syndication discoverability.
- **Fix sketch:** Extend `AtomFeedInput` with `feedAuthorName: string` and an
  optional `feedAuthorUri?: string`. Emit a single feed-level
  `<author><name>…</name>[<uri>…</uri>]</author>` block. Wire it through
  `feed.xml/route.ts` using `seo.author` (already loaded) and `seo.url`.
- **Severity:** MEDIUM (feed correctness; affects every subscriber).
- **Confidence:** High (RFC 4287 §4.1.1 is explicit).

### R17-M2 (MEDIUM, High confidence) — Feed entry `<updated>` uses `created_at`, ignores admin edits
- **File:** `apps/web/src/app/feed.xml/route.ts:39-41` and `:25-29`
- **Failure scenario:** RFC 4287 §4.2.15 defines `atom:updated` as "the most
  recent instant in time when [the entry] was modified in a way the publisher
  considers significant." When a photographer fixes a typo in the photo
  caption, edits the title for SEO, or rewrites the description after a client
  request, the feed entry's `<updated>` MUST advance so RSS readers re-fetch
  and re-render. Today it stays pinned to upload time forever — subscribers
  never see corrections.
- **Photographer impact:** Wedding/event delivery typically iterates the
  description for hero photos based on client feedback. The fix never reaches
  subscribers, who continue seeing the stale title in their reader.
- **Fix sketch:** Use `img.updated_at ?? img.created_at` for the entry's
  `<updated>`. Also use `MAX(updated_at)` across rows for the feed-level
  `<updated>`. `images.updated_at` is `onUpdateNow()` in `schema.ts:92-95`,
  so the column already advances on every UPDATE. Select `updated_at` into
  `getImagesLite`'s `publicSelectFields` — verify it's already public; if not,
  add it.
- **Severity:** MEDIUM (correctness; affects every subscriber after every edit).
- **Confidence:** High.

### R17-M3 (MEDIUM, Medium confidence) — Feed entry order surfaces stale photos with today's `<updated>`
- **File:** `apps/web/src/app/feed.xml/route.ts:18-29`
- **Failure scenario:** `getImagesLite` orders by `capture_date DESC,
  created_at DESC`. A photographer uploading a 5-year-old archive shot
  today places that 5-year-old row at the BOTTOM of the feed, while the
  `feedUpdated` value (`rows[0].created_at`) is today's date because rows[0]
  is the newest-captured. Worse, when the photographer THEN edits a
  newer-captured entry's caption, the entry doesn't bubble to the top of the
  feed because the feed is sorted by capture_date, not by `updated_at`. RSS
  conventions are reverse-chronological by `updated`, not by capture date.
- **Photographer impact:** Subscribers see "new content" notifications for
  archived photos and miss notifications for recently edited fresh ones.
- **Fix sketch:** For the Atom feed specifically, order by `created_at DESC`
  (or `updated_at DESC` once R17-M2 is wired). Capture-date-first ordering
  belongs to the gallery's hero list; the feed is a syndication channel and
  must follow syndication conventions. Either:
  - (a) add an `orderBy` parameter to `getImagesLite`, or
  - (b) write a small `getImagesForFeed(limit)` helper that selects the same
    public fields with the correct ordering.
- **Severity:** MEDIUM.
- **Confidence:** Medium (depends on whether the gallery owner explicitly
  wants capture-date ordering in the feed — but standard RSS practice is
  publication-time ordering).

### R17-M4 (MEDIUM, High confidence) — Atom feed missing `<rights>` / copyright
- **File:** `apps/web/src/lib/atom-feed.ts:56-84` (composer),
  `apps/web/src/app/feed.xml/route.ts` (caller)
- **Failure scenario:** RFC 4287 §4.2.10 defines `atom:rights` for
  copyright. A professional photographer's syndication channel without
  copyright is a missed legal-clarity opportunity. RSS scrapers and image
  search engines harvest feeds for indexing; an explicit `<rights>` makes
  the licensing posture machine-readable. `site-config.json` already has
  copyright fields (used in `<footer>` per existing patterns) — the data is
  present but not propagated.
- **Photographer impact:** Some aggregators (Inoreader, NewsBlur) display
  the rights field next to entries. Absence reads as "no copyright" /
  permissive default, which contradicts the standard "all rights reserved"
  posture a professional photographer asserts.
- **Fix sketch:** Add optional `feedRights?: string` to `AtomFeedInput`, emit
  `<rights>…</rights>` between `<title>` and `<updated>` when set. Pull from
  `siteConfig.copyright` or `seo` if available; fall back to
  `© ${new Date().getFullYear()} ${seo.author}` when undefined.
- **Severity:** MEDIUM (legal clarity for a professional-photographer
  surface).
- **Confidence:** High (RFC 4287 §4.2.10).

### R17-L1 (LOW, High confidence) — `escapeXml` is incomplete for control characters
- **File:** `apps/web/src/lib/atom-feed.ts:9-17`
- **Failure scenario:** XML 1.0 forbids most C0 control characters (everything
  in `0x00-0x1F` except `\t`, `\n`, `\r`) in document content. If an admin
  pastes a string with a `\x01` (some Lightroom Classic exports embed control
  characters in EXIF metadata that flows through to admin-edited titles/
  descriptions if sanitization missed them), the feed becomes ill-formed and
  RSS readers reject the entire feed (not just the entry). The admin-string
  sanitizer (`UNICODE_FORMAT_CHARS`) already strips bidi/invisible chars
  but does NOT strip C0 controls.
- **Photographer impact:** Total syndication breakage — every subscriber
  sees a malformed XML error until the offending entry is fixed.
- **Fix sketch:** Strip `[\x00-\x08\x0B\x0C\x0E-\x1F]` from the input
  before XML escaping. Safe to drop these globally; nothing in human-readable
  content needs them.
- **Severity:** LOW (only fires when an upstream sanitizer fails — defense
  in depth).
- **Confidence:** High.

### R17-L2 (LOW, High confidence) — Atom feed entry lacks `<author>` for per-entry attribution
- **File:** `apps/web/src/lib/atom-feed.ts:59-71`
- **Failure scenario:** Once R17-M1 lands the feed-level `<author>` covers
  the spec requirement, but multi-photographer galleries (the schema allows
  multiple `adminUsers`) lose per-photographer attribution. Today the
  `images` table doesn't track which admin uploaded which photo, so this is
  forward-looking — but the composer should accept an optional per-entry
  `author` so the wiring is ready.
- **Fix sketch:** Add optional `author?: { name: string; uri?: string }` to
  `AtomEntry`. Emit the per-entry block only when set.
- **Severity:** LOW (forward-looking; no current data path produces this).
- **Confidence:** High.

### R17-L3 (LOW, High confidence) — `feed.xml` HTTP response missing `Vary` header
- **File:** `apps/web/src/app/feed.xml/route.ts:62-68`
- **Failure scenario:** The feed doesn't `Vary`, but it's a static endpoint
  (no per-locale variants). However, if a future revision adds locale-aware
  titles, the cached response will leak the wrong locale's title to every
  subscriber. Pre-emptive defense: emit `Vary: Accept-Language` now so a
  future i18n change to the feed doesn't accidentally pollute the CDN cache.
- **Severity:** LOW (defensive).
- **Confidence:** High (HTTP cache contract).

### R17-L4 (LOW, High confidence) — `/api/og/photo/[id]` does not strip C0 control characters from titles
- **File:** `apps/web/src/app/api/og/photo/[id]/route.tsx:28-30`
- **Failure scenario:** `sanitizeForOg` only strips `UNICODE_FORMAT_CHARS`.
  A title with a stray `\x01` would render as a Satori box-character or be
  silently dropped, depending on the font. Defensive parity with R17-L1.
- **Fix sketch:** Extend `sanitizeForOg` to also strip
  `[\x00-\x08\x0B\x0C\x0E-\x1F]`.
- **Severity:** LOW.
- **Confidence:** High.

### R17-L5 (LOW, Medium confidence) — `/api/download/[imageId]` `Content-Disposition` filename does not include the title
- **File:** `apps/web/src/app/api/download/[imageId]/route.ts:224`
- **Failure scenario:** `downloadName` is built as `photo-${imageId}${safeExt}`
  — identical to the gallery's old download anchors (R12-M2). The
  `buildDownloadFilename(title, id, ext)` helper introduced in R12-M2 is NOT
  used here. A paid-asset customer who downloaded 8 favorites gets
  `photo-101.jpg`, `photo-204.jpg`, etc. in Downloads with no slug — exactly
  the problem R12-M2 closed for the gallery download path.
- **Photographer impact:** Paid-download recipients (wedding clients,
  stock-photo buyers) lose the human-readable filename. Support burden
  rises because clients can't identify which photo is which.
- **Fix sketch:** Reuse `buildDownloadFilename(image.title, imageId, safeExt)`
  in `download/[imageId]/route.ts`. Already-validated path; falls back to
  `photo-${imageId}.${ext}` when title is empty or CJK-only-slug, identical
  to the R12-M2 helper contract.
- **Severity:** LOW (paid-download path is lower-volume than gallery
  download, but it's the highest-stakes download for the customer).
- **Confidence:** Medium (the title field is admin-controlled; verify the
  paid-download UX wants the title in the filename or prefers anonymity for
  some shop SKUs).

### R17-L6 (LOW, High confidence) — Sitemap homepage / topic entries lack `lastModified`
- **File:** `apps/web/src/app/sitemap.ts:48-60`
- **Failure scenario:** Homepage and topic entries in the sitemap have no
  `lastModified`. Googlebot uses `lastmod` as a signal for crawl
  prioritization (per Google's 2023 guidance: "We use lastmod to detect
  fresh content"). Without it the home page is crawled on Googlebot's own
  schedule, which can be slower than necessary after a fresh upload.
- **Photographer impact:** SEO indexing latency on the homepage after
  a portfolio refresh.
- **Fix sketch:** For the homepage entries, use the most recent
  `images.updated_at` (or `created_at`) across the gallery. For each topic
  entry, use the most recent `images.updated_at` of photos in that topic.
  Cache the lookup via the same `revalidate = 3600` ISR window.
- **Severity:** LOW.
- **Confidence:** High (Google's documented signal).

## Cross-perspective agreement

- **code-reviewer + critic + document-specialist:** Atom feed composer
  is structurally clean but spec-incomplete (R17-M1, R17-M4, R17-L1, R17-L2).
- **perf-reviewer + tracer:** Feed `<updated>` semantics (R17-M2, R17-M3)
  cause unnecessary CDN cache hits to look "fresh" when they're stale, and
  vice versa.
- **security-reviewer + verifier:** Defensive C0 control stripping (R17-L1,
  R17-L4) is cheap and closes a "if upstream sanitizer regresses"
  category of failure.
- **designer + test-engineer:** Paid-download filename parity (R17-L5)
  with the gallery download path is a UX consistency hole.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit/star/cull/score/adjust features.

## Existing backlog (R10..R16) — not re-reviewed this pass

See `.context/plans/photographer-r1{0..6}/README.md` for the live carry-over.
R10 backlog (HIGH still open): R10-C1, R10-H2, R10-H4 (full), R10-H5.
R10 backlog (MED still open): R10-M2, R10-M4, R10-M5, R10-M6, R10-M7,
R10-M11, R10-M12.
R10 backlog (LOW still open): R10-L8, R10-L19, R10-L20.
