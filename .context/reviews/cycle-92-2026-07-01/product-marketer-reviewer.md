# Cycle 92 Product-Marketer Reviewer Report

## Inventory built first

Required context read: `AGENTS.md` and `CLAUDE.md`.

Relevant public/product-facing inventory reviewed:

- Product/docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`.
- Site defaults and SEO settings: `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Metadata and discovery routes: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/constants.ts`.
- Public pages: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, `c/[slug]/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `map/page.tsx`, `privacy/page.tsx`, `layout.tsx`.
- Public presentation components: `apps/web/src/components/nav.tsx`, `nav-client.tsx`, `home-client.tsx`, `search.tsx`, `photo-viewer.tsx`, `image-manager.tsx`, `footer.tsx`.
- Sharing/privacy/search data flow: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.

## Executive summary

No critical product-trust break was found. Privacy claims around public GPS omission, map opt-in, private originals, semantic-search setup, and no bundled Lightroom plugin are largely aligned with code and docs. The strongest remaining marketing/SEO issues are discoverability/social-preview gaps on newer archive/collection surfaces and a few copy-level expectation mismatches in admin-facing settings.

## Confirmed issues

### PMR-92-01 — Indexable public archive/collection surfaces are omitted from the sitemap

- Severity: Medium
- Confidence: High
- Type: Confirmed issue
- Evidence:
  - The sitemap imports only `getImageIdsForSitemap`, `getLatestImageUpdatedAt`, and `getTopics` from data access (`apps/web/src/app/sitemap.ts:1`), then emits homepage entries, topic entries, image entries, the root feed, and topic feed entries only (`apps/web/src/app/sitemap.ts:57-120`).
  - Public smart collections are explicitly a public route when `is_public` is true: schema comments say public collections are reachable at `/[locale]/c/[slug]` and non-public collections require admin auth (`apps/web/src/db/schema.ts:301-305`), with `is_public` stored on the row (`apps/web/src/db/schema.ts:306-315`). The page returns indexable metadata for public collections, including canonical and hreflang alternates, and only applies `robots: noindex` for missing/private collections (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:35-81`).
  - The timeline page is also indexable metadata with canonical/hreflang and no `robots: noindex` on the valid path (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:31-58`).
  - Valid year-in-review pages likewise return canonical/hreflang metadata and no `robots: noindex`; only invalid years are noindexed (`apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:38-71`).
  - Years are enumerable from existing processed photos via `getTimelineYears()` (`apps/web/src/lib/data-timeline.ts:125-145`), but that helper is not used by the sitemap.
- Impact: Search engines and sitemap-first consumers get strong discovery hints for home/topics/photos/feeds, but not for the product’s public collection/archive surfaces. These pages can still be found through internal links or external shares, but the product’s SEO surface is inconsistent with its own indexable metadata.
- Recommendation: Add localized sitemap rows for `/timeline`, valid `/year/{year}` values, and `is_public` smart collections. If smart collections are intended as direct-link-only pages, make that explicit and consider `robots: noindex`; otherwise include them in sitemap discovery.

### PMR-92-02 — Public archive/collection pages request large social cards but often provide no image

- Severity: Medium
- Confidence: High
- Type: Confirmed issue
- Evidence:
  - Smart collection metadata only sets `ogImages` when `seo.og_image_url` exists (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:52-59`) and conditionally omits `openGraph.images` / `twitter.images` otherwise while still using `summary_large_image` (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:65-80`).
  - Timeline metadata has the same optional-only fallback image behavior (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:34-58`).
  - Year-in-review metadata has the same optional-only fallback image behavior (`apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:47-70`).
  - The SEO fallback is nullable by design (`og_image_url: settingsMap.get('seo_og_image_url') || null` at `apps/web/src/lib/data.ts:1793-1801`), so fresh/default installs can hit the no-image path.
  - Sibling public surfaces are stronger: home falls back to `/api/og/photo/{latestId}` when no default OG image is configured (`apps/web/src/app/[locale]/(public)/page.tsx:104-128`), topic pages fall back to generated `/api/og?topic=...` cards (`apps/web/src/app/[locale]/(public)/[topic]/page.tsx:85-97`), and photo pages always use the per-photo OG route (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:85-93`).
- Impact: Public collection/archive links can unfurl without imagery on default installs, even though they opt into a large-image card type. This weakens sharing and product polish exactly on pages meant to package a curated set or archive moment.
- Recommendation: Generate collection/timeline/year OG cards or reuse a first/representative photo card. If no image should be emitted, downgrade Twitter card type to `summary` instead of `summary_large_image`.

### PMR-92-03 — “Private share links” wording overstates unauthenticated bearer-link semantics

- Severity: Low
- Confidence: High
- Type: Confirmed issue
- Evidence:
  - Admin SEO copy calls these “private share links” while describing generic noindex metadata (`apps/web/messages/en.json:483-487`; Korean equivalent at `apps/web/messages/ko.json:483-487`).
  - Share metadata intentionally does not look up the share row in `generateMetadata`, staying generic/noindex to avoid key enumeration and private preview leakage (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:44-52`; group equivalent at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:49-56`).
  - The share pages are still public bearer-URL pages after key validation/rate-limit: the single-photo page rate-limits, then fetches by key and renders if found (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:87-113`); the data accessor selects by `images.share_key` and `processed=true` (`apps/web/src/lib/data.ts:1234-1267`).
  - Group links accept `expires_at IS NULL` as valid (`apps/web/src/lib/data.ts:1309-1321`), and group creation stores only `{ key: groupKey }` without an expiry (`apps/web/src/app/actions/sharing.ts:254-290`).
  - The UI feedback only says the link was copied/created, with no “anyone with this link can view” caveat (`apps/web/src/components/photo-viewer.tsx:587-619`; `apps/web/src/components/image-manager.tsx:194-215`).
- Impact: The implementation is privacy-conscious for search/social metadata, but “private” can imply authentication or recipient access control. For photographers sharing client galleries, that wording can create a false expectation about link secrecy, expiry, or revocation.
- Recommendation: Use “unlisted share links” or “noindex share links” in admin copy. Add a short creation-time hint: “Anyone with this link can view it; no social preview photo is exposed.” If group expiry/revocation is not supported in the UI, avoid language that implies it.

### PMR-92-04 — SEO “OG Locale” field copy implies broader control than the code provides

- Severity: Low
- Confidence: High
- Type: Confirmed issue
- Evidence:
  - The admin field is labeled “OG Locale” and says “Open Graph locale code (e.g. en_US, ko_KR). Leave empty for default.” (`apps/web/messages/en.json:481-482`; Korean equivalent at `apps/web/messages/ko.json:481-482`). The UI exposes it as a normal editable SEO setting (`apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:148-159`).
  - The setting is stored/read as `seo_locale` (`apps/web/src/app/actions/seo.ts:40-45`; public SEO resolver at `apps/web/src/lib/data.ts:1793-1801`).
  - For supported route locales, `getOpenGraphLocale()` ignores the configured value and returns the route locale; comments explicitly say the configured value should only act as the default for unknown/unsupported route locales (`apps/web/src/lib/locale-path.ts:63-75`).
  - Tests lock that behavior: `getOpenGraphLocale('ko', 'en_US')` returns `ko_KR`, and `getOpenGraphLocale('en', 'ko_KR')` returns `en_US` (`apps/web/src/__tests__/locale-path.test.ts:51-69`).
- Impact: An admin may set `seo_locale` expecting to force OG locale across the site, but normal `/en` and `/ko` pages continue to advertise their route-derived locales. The code behavior is correct for multilingual SEO; the copy is just underspecified.
- Recommendation: Change the hint to “Fallback Open Graph locale for unsupported/unknown route locales; `/en` and `/ko` pages use their route locale automatically.”

## Likely issues / lower-confidence risks

### PMR-92-L1 — Timeline `?year=` variants have canonical/JSON-LD drift

- Severity: Low
- Confidence: Medium
- Type: Likely issue
- Evidence:
  - Timeline metadata always canonicalizes to `/timeline` (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:31-41`).
  - The rendered JSON-LD uses `/timeline?year={selectedYear}` when a year is selected (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:116-125`) and year-specific links point to `/year/{year}` (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:184-192`).
- Risk: Crawlers that reach `/timeline?year=2025` may see a canonical pointing at `/timeline` but structured data naming the query URL. This is probably not catastrophic because `/year/{year}` exists as the cleaner indexable year page, but it is a scent mismatch.
- Recommendation: Either noindex `?year=` timeline variants and keep JSON-LD only on `/year/{year}`, or align JSON-LD URL with the canonical `/timeline` when rendering query variants.

## Manual-validation risks

- MV-92-01 — Live SEO/social head validation: verify deployed `BASE_URL`, canonical URLs, `og:image`, Twitter card tags, and CDN/image-base behavior with real production settings. Code guards placeholder production URLs (`apps/web/scripts/ensure-site-config.mjs:23-42`), but this review did not fetch the live site.
- MV-92-02 — Social crawler behavior: manually unfurl home/topic/photo/smart-collection/timeline/year/share URLs in target platforms. The code paths are clear, but platform handling of missing images, 302 OG fallbacks, and noindex share metadata needs live validation.
- MV-92-03 — Privacy runtime sample: use real GPS-bearing images to confirm public photo pages omit coordinates, map markers appear only for `map_visible` topics, and retained originals reflect the first-upload GPS setting. Static evidence supports the claim (`apps/web/src/lib/data.ts:368-488`, `apps/web/src/lib/data.ts:1709-1745`, `apps/web/src/components/photo-viewer.tsx:876-899`).
- MV-92-04 — Semantic search expectation: code/docs are honest about disabled/stub/production modes, but the live deployment’s DB row, env opt-in, model weights, and backfill status determine what visitors actually see.

## Confirmed aligned claims / non-issues

- Public GPS/privacy claims are aligned: public selectors omit GPS and other sensitive fields (`apps/web/src/lib/data.ts:368-408`), compile-time guards protect `publicSelectFields` and map exceptions (`apps/web/src/lib/data.ts:459-489`), map exposure requires `topics.map_visible=true` and non-null coordinates (`apps/web/src/lib/data.ts:1709-1745`), and the viewer only renders GPS for admins (`apps/web/src/components/photo-viewer.tsx:876-899`). The privacy page copy matches this (`apps/web/messages/en.json:816-824`).
- First-upload GPS expectations have been front-loaded since the older product-marketer review: root README now warns under EXIF extraction that GPS stripping must be reviewed before first upload (`README.md:39-40`), app README repeats the first-upload warning (`apps/web/README.md:25`), settings copy says existing images are unchanged (`apps/web/messages/en.json:744-748`), and upload copy warns when GPS stripping is off (`apps/web/messages/en.json:175-179`).
- Semantic-search positioning remains honest: root README says disabled by default and operator setup is required (`README.md:42`), app README documents disabled/stub/production modes and bounded newest-first scan (`apps/web/README.md:62-84`), visitor search copy warns about stub and newest-first production behavior (`apps/web/messages/en.json:430-435`), and settings copy says production is operator-gated (`apps/web/messages/en.json:759-769`).
- Upload API expectations remain bounded: README describes an API contract, not a bundled Lightroom plugin, and lists consumed fields/limits (`README.md:207-218`); app README repeats the same (`apps/web/README.md:90-99`); admin token copy warns tokens behave like passwords and no Lightroom plugin is distributed (`apps/web/messages/en.json:847-850`).

## Final missed-issue sweep

Performed a final route-level sweep over public `generateMetadata`, `robots`, `openGraph`, `twitter`, `canonical`, `og_image_url`, `summary_large_image`, sitemap, and OG route terms. The sweep covered home, topic, photo, smart collection, share single/group, map, privacy, timeline, year, sitemap, robots, and both OG image routes. It reinforced the confirmed sitemap and archive/social-image gaps above and surfaced the timeline canonical/JSON-LD drift as a likely issue. No additional critical/high product-marketing or privacy-claim issue was confirmed in this pass.
