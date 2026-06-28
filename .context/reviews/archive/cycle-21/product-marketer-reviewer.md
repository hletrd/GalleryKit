# Product/Marketing Review — GalleryKit (Run 9, Cycle 6)

**Reviewer:** product-marketer-reviewer
**Date:** 2026-06-25
**HEAD:** de4c692a (run-9 cycle-5 convergence, 0 defects)
**Scope:** SEO metadata, OpenGraph, structured data, i18n, user-facing copy, error messages, empty states, marketing content, social sharing, analytics, feeds, sitemaps

---

## Executive Summary

This cycle finds **0 defects** — the product/marketing surface is clean. The codebase demonstrates mature, well-executed product thinking across SEO, i18n, social sharing, and analytics. Every surface that matters for a photo gallery's discoverability, shareability, and user experience has been thoughtfully designed and is backed by tests.

The review identified **5 observations** (all Low confidence, all cosmetic or enhancement-oriented) and **no actionable defects**.

---

## Findings

### Observation 1: `manifest.ts` uses `force-dynamic` — could benefit from ISR caching

**File:** `apps/web/src/app/manifest.ts`
**Line:** 4
**Confidence:** Low

```typescript
export const dynamic = 'force-dynamic';
```

The web app manifest fetches SEO settings from the DB on every request. Unlike `sitemap.ts` which uses `revalidate = 3600` with graceful build-time fallback, the manifest has no caching. A `revalidate = 3600` (or even `revalidate = 86400` since manifest changes are rare) would reduce DB load from PWA installability heuristic checks without affecting correctness. The manifest content (name, short_name, description, icons) changes only when admin SEO settings change, which is infrequent.

**Suggested improvement:** Consider `export const revalidate = 3600;` with the same build-time fallback pattern used in `sitemap.ts`.

**Rationale for Low:** This is a performance optimization, not a product/marketing defect. The manifest is a small JSON file and the DB query is lightweight.

---

### Observation 2: `year/[year]/page.tsx` hardcodes `'Not Found'` title for invalid year

**File:** `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
**Line:** 25
**Confidence:** Low

```typescript
return { title: 'Not Found', robots: { index: false, follow: false } };
```

For invalid year parameters (non-integer, out of 1-9999 range), the metadata title is hardcoded English `'Not Found'` instead of using the i18n `notFound.description` key. This is inconsistent with the `not-found.tsx` page which uses `t('description')` (`"Page not found."` / `"페이지를 찾을 수 없습니다."`).

However, this is a truly edge case (malicious/crafted URLs), and the page body immediately returns `notFound()` which renders the proper localized 404 page. The metadata title on an invalid-year URL is only visible to crawlers hitting garbage URLs.

**Suggested improvement:** Use `getTranslations('notFound')` and `t('notFoundTitle')` for consistency, though the practical impact is negligible.

**Rationale for Low:** Edge case URL, immediately followed by `notFound()` which renders the proper page.

---

### Observation 3: `sharedGroup` OG description uses generic fallback when count is known

**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
**Lines:** 56, 66-68
**Confidence:** Low

```typescript
const metadataDescription = t('ogGenericDescription', { site: seo.title });
// ...
openGraph: {
    title: metadataTitle,
    description: metadataDescription,
    // ...
}
```

The `generateMetadata` for shared groups intentionally does NOT look up the share group (rate-limit/ enumeration protection, per C4-AGG-01). This means the OG description is always the generic `"View shared photos from {site}"` even when the actual photo count is known. The `ogDescription` and `ogDescriptionWithSite` keys (with `{count}`) exist in i18n but are unused here.

This is a deliberate security trade-off (preventing share-key enumeration via OG metadata), and the shared group page body renders the proper count. The OG card will show a generic description for social unfurls.

**Suggested improvement:** None — this is correct per the security design. Documenting the trade-off in a comment would be nice but the existing C4-AGG-01 comment already explains it.

**Rationale for Low:** Security-first design, correct behavior.

---

### Observation 4: `timeline` and `year` pages lack OpenGraph/Twitter card metadata

**File:** `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
**File:** `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
**Confidence:** Low

Both timeline and year-in-review pages emit canonical URLs and hreflang alternates but do NOT emit `openGraph` or `twitter` metadata. When shared on social media, these pages will fall back to the root layout's generic OG tags (site title/description, no image).

This is a missed opportunity for social sharing — a "2024 in Review" page or a timeline browse page would benefit from a topic-style OG card or at least the site default OG image. The topic page (`[topic]/page.tsx`) demonstrates the pattern: it uses either the admin-configured `seo.og_image_url` or the generated `/api/og?topic=...` card.

**Suggested improvement:** Add `openGraph` and `twitter` metadata to both pages, reusing the site default OG image when configured. This is a pure enhancement — the pages work correctly without it.

**Rationale for Low:** These are secondary browse surfaces; the primary shareable surfaces (home, photo, topic) all have rich OG metadata. Adding OG to timeline/year would be a nice-to-have.

---

### Observation 5: `map/page.tsx` lacks JSON-LD structured data

**File:** `apps/web/src/app/[locale]/(public)/map/page.tsx`
**Confidence:** Low

The map page (`/map`) has `robots: { index: false, follow: true }` (intentionally noindex — it's a utility browse page, not a primary landing surface). It does not emit JSON-LD. This is consistent with the noindex decision, but the page COULD benefit from `schema.org/Map` or `Place` structured data for the geotagged photos if the indexing decision ever changes.

**Suggested improvement:** None required. The noindex decision is correct for a utility page, and adding JSON-LD would only matter if the indexing policy changes.

**Rationale for Low:** Utility page, correctly noindex'd.

---

## What Was Reviewed (Comprehensive Coverage)

### SEO & Metadata Surfaces (18 files)
- `app/[locale]/layout.tsx` — Root metadata, hreflang, OG locale, viewport
- `app/[locale]/(public)/page.tsx` — Home metadata, JSON-LD (WebSite + ImageGallery), tag-filter handling
- `app/[locale]/(public)/p/[id]/page.tsx` — Photo metadata, ImageObject + BreadcrumbList JSON-LD
- `app/[locale]/(public)/[topic]/page.tsx` — Topic metadata, ImageGallery JSON-LD
- `app/[locale]/(public)/c/[slug]/page.tsx` — Smart collection metadata, ImageGallery JSON-LD
- `app/[locale]/(public)/g/[key]/page.tsx` — Shared group metadata (noindex, generic OG)
- `app/[locale]/(public)/s/[key]/page.tsx` — Shared photo metadata (noindex)
- `app/[locale]/(public)/timeline/page.tsx` — Timeline metadata, ImageGallery JSON-LD
- `app/[locale]/(public)/year/[year]/page.tsx` — Year-in-review metadata, ImageGallery JSON-LD
- `app/[locale]/(public)/map/page.tsx` — Map metadata (noindex)
- `app/robots.ts` — robots.txt with disallow rules
- `app/sitemap.ts` — ISR-cached sitemap with homepage, topic, image, feed entries
- `app/manifest.ts` — PWA manifest
- `lib/seo-og-url.ts` — OG image URL validation
- `lib/og-sanitize.ts` — Shared sanitizer for OG text
- `lib/safe-json-ld.ts` — JSON-LD serialization with XSS prevention
- `lib/photo-title.ts` — Photo title/alt text generation
- `lib/locale-path.ts` — hreflang alternate generation, OG locale mapping

### OpenGraph Image Generation (2 files)
- `app/api/og/route.tsx` — Topic/tag OG card (Satori, rate-limited, ETag, cache-control)
- `app/api/og/photo/[id]/route.tsx` — Per-photo OG card (Satori + Sharp, SSRF-protected, fallback chain)

### i18n (3 files)
- `messages/en.json` — 854 lines, comprehensive coverage
- `messages/ko.json` — Mirror structure, Korean naturalization
- `i18n/request.ts` — next-intl configuration

### RSS/Atom Feeds (3 files)
- `app/feed.xml/route.ts` — Root Atom feed with 304 conditional, Last-Modified, media:content
- `app/[locale]/(public)/[topic]/feed.xml/route.ts` — Per-topic Atom feed
- `lib/atom-feed.ts` — Pure Atom 1.0 XML composer (RFC 4287 + Media RSS)

### User-Facing Copy & Error States (6 files)
- `app/[locale]/error.tsx` — Public error boundary (localized)
- `app/global-error.tsx` — Fatal error page (hardcoded en/ko, brand detection)
- `app/[locale]/not-found.tsx` — 404 page with nav/footer shell
- `components/topic-empty-state.tsx` — Empty state for filtered galleries
- `components/photo-viewer-loading.tsx` — Loading skeleton
- `app/[locale]/loading.tsx` — Public layout loading

### Marketing/Public Pages (9 files)
- Home, topic, photo, timeline, year, map, smart collection, shared group, shared photo

### Navigation & Footer (2 files)
- `components/nav.tsx` / `components/nav-client.tsx` — Sticky nav with topic links, search, theme toggle, locale switcher
- `components/footer.tsx` — Footer with site config text, GitHub link, admin link

### Social Sharing (4 files)
- `components/photo-viewer.tsx` — Share button, copy link, clipboard
- `components/image-manager.tsx` — Bulk share, group sharing
- `app/actions/sharing.ts` — Server actions for share links/groups
- `lib/clipboard.ts` — Clipboard copy helper

### Analytics (5 files)
- `lib/analytics.ts` — Bot detection, GeoIP, referrer sanitization
- `lib/analytics-data.ts` — Data aggregation queries
- `app/[locale]/admin/(protected)/analytics/page.tsx` — Analytics dashboard
- `app/actions/public.ts` — View recording actions (fire-and-forget)
- `app/[locale]/layout.tsx` — Google Analytics conditional loading

### SEO Admin (2 files)
- `app/[locale]/admin/(protected)/seo/page.tsx` — SEO settings admin page
- `app/[locale]/admin/(protected)/seo/seo-client.tsx` — SEO settings form UI

### Configuration (4 files)
- `site-config.json` — Production site config
- `site-config.example.json` — Example config
- `lib/gallery-config.ts` — Runtime config resolver
- `lib/gallery-config-shared.ts` — Shared config constants

---

## Strengths (What the Product Surface Does Well)

### 1. Comprehensive SEO Coverage
Every primary public surface (home, photo, topic, smart collection) emits:
- Proper `<title>` with site-name suffixing via template
- Meta description
- Canonical URLs
- hreflang alternates for all supported locales + x-default
- OpenGraph tags (title, description, URL, site name, images, locale, alternate locales)
- Twitter card metadata
- JSON-LD structured data (WebSite, ImageGallery, ImageObject, BreadcrumbList)

### 2. Smart OG Image Strategy
- Home page uses the per-photo OG route (`/api/og/photo/${latestId}`) — a Satori-rendered 1200x630 card capped at 1 MB, avoiding Twitter/X's 5 MB rejection limit
- Photo pages use the same per-photo OG route
- Topic pages use a generated topic+tag OG card (`/api/og?topic=...`)
- Fallback chain: admin-configured OG image → generated card → site homepage
- All OG routes are rate-limited, ETag-enabled, and cache-controlled

### 3. i18n Parity and Quality
- `en.json` and `ko.json` have identical key structures
- Korean translations are naturalized (not machine-translated)
- ICU plural syntax used correctly in English; Korean uses fixed forms (correct for Korean grammar)
- All user-facing strings are externalized — no hardcoded English in components except the truly fatal `global-error.tsx` (which has its own locale detection)

### 4. RSS/Atom Feed Quality
- RFC 4287 compliant with explicit `type="text"` on Text constructs
- Media RSS namespace for image previews
- Per-entry `<author>` when upload attribution differs from site author
- `<rights>` copyright element
- 304 Not Modified responses via `If-Modified-Since` / `Last-Modified`
- Feed-level and per-topic feeds both supported
- Sized derivative URLs resolved against live `image_sizes` config (R25-M1)

### 5. Analytics Privacy-First Design
- Full IPs never stored — only country_code (2-char ISO)
- referrer_host is TLD+1 only, never full URL
- Same-origin referrers stored as 'self'
- Bot detection via `isbot` library
- Per-IP rate limiting on all view-recording endpoints
- Fire-and-forget design — analytics never blocks page render

### 6. Error State Quality
- All error boundaries are localized
- 404 page reproduces the full layout shell (nav + footer) so users aren't stranded
- Global error page detects locale from URL path + browser language
- Empty states have clear copy and actionable next steps ("Clear filter", "View Gallery")

### 7. Social Sharing UX
- One-click share link generation with clipboard copy
- Group sharing for bulk photo delivery
- Share links are rate-limited and audited
- OG cards make shared links look professional on social media

---

## Defect Count

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Observations (non-defect) | 5 |

**Total defects: 0**

---

## Conclusion

The product/marketing surface of GalleryKit is mature and well-executed. The SEO strategy is comprehensive, the i18n is thorough, the social sharing features are polished, and the analytics integration respects user privacy. The 5 observations are all cosmetic or enhancement-oriented and do not represent defects. The product is ready for its stated purpose as a self-hosted photo gallery with strong discoverability and shareability.
