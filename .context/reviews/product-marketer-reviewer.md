# Product Marketer Reviewer - Cycle 24

Reviewer surface: `product-marketer-reviewer` using `~/.codex/agents/product-marketer-reviewer.md` as a marketing-review lens. The installed prompt is BurstPick-specific, so I ignored non-existent BurstPick source requirements and reviewed GalleryKit's current repository surfaces instead.

Reviewed HEAD: `7ff1eeecd23d2a1ed21fe11df1b299f63ede154e`.

## Review Inventory

I inventoried review-relevant files first, then examined current docs, public/admin copy, SEO/social metadata code, feeds, sitemap/robots, privacy/onboarding text, admin wording, i18n messages, and adjacent implementation gates.

- Product/operator docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Localized message catalogs: `apps/web/messages/en.json`, `apps/web/messages/ko.json` in full; key parity checked at 830 keys each, 0 missing/extra.
- Public route and metadata surfaces: all public `page.tsx` / `layout.tsx` files under `apps/web/src/app/[locale]/(public)/`, plus `app/[locale]/layout.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`, `manifest.ts`, `robots.ts`, `sitemap.ts`, root/topic Atom feed routes, upload route handlers, search routes, and OG image routes.
- Admin copy/UX surfaces: all admin pages under `apps/web/src/app/[locale]/admin/`, admin actions relevant to SEO/settings/sharing/upload tokens, and public/admin components under `apps/web/src/components/`.
- Implementation support checked for claims: `lib/data.ts`, `lib/photo-title.ts`, `lib/seo-og-url.ts`, `lib/gallery-config*.ts`, `lib/use-display-capability.ts`, `lib/atom-feed.ts`, `lib/image-url.ts`, `lib/caption-generator.ts`, `lib/color-label.ts`, and semantic/similar search routes.

## Executive Summary

GalleryKit's product story is much more honest than earlier cycles: README copy now clearly says "finished-photo publishing" and rejects editing/culling/proofing claims. The remaining market risk is precision drift in high-trust surfaces: color fidelity claims are still broader than browser/HDR reality, share-preview admin copy promises photo previews the implementation intentionally withholds, and some localized SEO/feed fallbacks still leak English/internal terms. Go-to-market readiness for a self-hosted photographer/operator audience: 7/10 after fixing the share-preview and color-claim wording.

## Confirmed Issues

### PMR-24-01 - Color fidelity positioning still overpromises browser/HDR reality

- Severity: Medium
- Confidence: High
- Risk type: Confirmed messaging / expectation mismatch
- Evidence:
  - `README.md:8` promises publishing finished photography with "accurate color"; `README.md:31` says "color-faithful delivery"; `README.md:38` labels the feature "Photographer-grade color management".
  - `CLAUDE.md:270` frames the premise as delivering photographer intent "accurately to every viewer's display, on every supported browser."
  - The same implementation docs narrow that claim: HDR ingest is rejected by default and, when enabled, public derivatives are still SDR at `CLAUDE.md:297-301`.
  - Firefox is explicitly treated as a delivery/detection gap at `CLAUDE.md:376-380`.
  - Public viewer copy already admits the browser/display fallback: `apps/web/messages/en.json:389-390` tells visitors they are seeing an sRGB version on some displays.
- Failure scenario: A photographer evaluates GalleryKit as a portfolio system for color-critical work, reads "accurate color" / "every supported browser", and expects wide-gamut/HDR intent to survive uniformly. Firefox visitors and HDR uploads then receive sRGB/SDR-constrained behavior. The product is doing the technically honest thing, but the top-level promise is broader than the delivery contract.
- Fix: Reword the top README/CLAUDE positioning to "best-effort browser-managed color-faithful delivery" and add the caveats beside the claim: Display P3 is the wide-gamut delivery ceiling, Firefox may fall back to sRGB behavior, and HDR sources currently deliver SDR derivatives until HDR output ships.

### PMR-24-02 - Admin SEO copy promises photo share previews that share routes do not emit

- Severity: Medium
- Confidence: High
- Risk type: Confirmed admin UX / social sharing mismatch
- Evidence:
  - Admin copy says individual photo and share pages use the photo itself: `apps/web/messages/en.json:473-477`; Korean repeats the same promise at `apps/web/messages/ko.json:473-477`.
  - The SEO form renders that helper directly under the OG image field at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:163-180`.
  - Public photo pages do use per-photo OG image metadata: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:79-120`.
  - Shared photo metadata intentionally does not look up the photo, emits generic title/description, has no `openGraph.images`, and uses `twitter.card: 'summary'`: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:36-78`.
  - Shared group metadata is also generic and image-less: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:41-83`.
- Failure scenario: An admin configures the default OG image believing private share links will show the shared photo itself. They send a client, family, or social app a share link and get a generic text preview instead of the image, reducing trust in the sharing feature and making the admin think the SEO setting is broken.
- Fix: Change admin helper copy to the true contract: "Public photo pages use generated photo cards. Share links use generic noindex metadata to avoid unthrottled share-key lookups." If richer previews are desired, add a privacy-conscious image strategy for shares, such as a configured default `og_image_url` on share routes or a rate-limited/token-safe share OG endpoint.

### PMR-24-03 - Smart collections and archive pages can ship text-only social cards unless a default OG image is configured

- Severity: Low
- Confidence: High
- Risk type: Confirmed social-preview weakness
- Evidence:
  - Smart collection metadata emits images only when `seo.og_image_url` exists: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:46-53`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:59-74`.
  - Timeline and year pages follow the same default-image-only pattern: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:28-51`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:41-64`.
  - Topic pages have a generated `/api/og?...` fallback when no default image is configured: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:79-91`.
  - Home can fall back to a latest-photo card: `apps/web/src/app/[locale]/(public)/page.tsx:116-145`.
- Failure scenario: An operator builds public smart collections or timeline/year archive pages as curated share destinations, but has not configured a site-wide OG image. Topic/home/photo links render visual cards; smart collection/archive links become text-only previews on social apps. That inconsistency makes newer gallery surfaces feel less polished than core topics.
- Fix: Add generated OG fallbacks for smart collections and archive pages. For smart collections, use the first matching photo or a collection-specific `/api/og?collection=...` card. For timeline/year pages, use the most recent photo in that archive or the same site-default fallback intentionally documented in admin copy.

### PMR-24-04 - Localized JSON-LD and Atom fallbacks still hard-code English "Photo"

- Severity: Low
- Confidence: High
- Risk type: Confirmed i18n / SEO consistency issue
- Evidence:
  - Home JSON-LD uses `Photo ${img.id}` as the fallback image name: `apps/web/src/app/[locale]/(public)/page.tsx:183-198`.
  - Topic JSON-LD uses the same English fallback: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:187-200`.
  - Smart collection JSON-LD uses the same English fallback: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:114-127`.
  - Root Atom feed and localized topic Atom feeds use `Photo ${img.id}`: `apps/web/src/app/feed.xml/route.ts:60-93`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:74-104`.
  - Timeline/year pages already use localized fallbacks via `tCommon('photo')`: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:116-124`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:108-116`.
- Failure scenario: A Korean gallery with untitled/untagged photos emits Korean visible UI but English JSON-LD/feed titles such as "Photo 123". Search engines, feed readers, and social metadata consumers see a mixed-language brand experience. It is not a functional break, but it weakens the Korean launch polish.
- Fix: Thread `getTranslations('common')` into home/topic/smart collection and localized topic feed routes and use `${tCommon('photo')} ${img.id}`. For the root unlocalized feed, either keep the default locale explicitly or document it as English/default-locale feed output.

### PMR-24-05 - Korean privacy copy leaks the internal "topic" term instead of the public "category" term

- Severity: Low
- Confidence: High
- Risk type: Confirmed i18n / audience-fit issue
- Evidence:
  - Korean admin/public navigation consistently uses category language: `apps/web/messages/ko.json:79-85`, `apps/web/messages/ko.json:144-159`, `apps/web/messages/ko.json:861-867`.
  - The Korean privacy analytics copy switches to "토픽" twice: `apps/web/messages/ko.json:801-802`.
  - The Korean metadata privacy copy also says map-visible "토픽": `apps/web/messages/ko.json:803-804`.
- Failure scenario: Korean visitors/admins read the privacy page and encounter an internal implementation term that does not match the rest of the UI. Privacy copy is a trust surface; inconsistent terminology makes the product feel translated from internals rather than written for Korean users.
- Fix: Replace "토픽" with "카테고리" in the Korean privacy analytics and metadata strings. Keep English "topic" only in code/docs where it is an implementation concept; user-facing Korean should stay with "카테고리".

## Likely Issues

- Share-link preview richness needs product validation. The generic/noimage share metadata appears intentionally chosen to avoid unthrottled key lookups, so the issue is not the security decision itself. The likely product issue is that admins will expect visual previews unless the admin copy and share-link UI explain the privacy tradeoff.
- Smart-collection OG gaps should be manually validated with real link scrapers after implementation. The code confirms missing `images` when no default OG exists, but individual platforms vary in how unattractive the resulting card looks.

## Risks Needing Manual Validation

- Verify the live demo's semantic-search claim in `README.md:42` before using that line in external launch copy; demo operator state can drift independently from HEAD.
- Validate social previews for `/s/{key}`, `/g/{key}`, `/c/{slug}`, `/timeline`, and `/year/{year}` in at least Slack, KakaoTalk, iMessage, X/Twitter, and Open Graph Debugger. The code-level metadata is clear, but platform behavior and caching determine the user-visible failure mode.
- Validate Korean feed/JSON-LD display in a feed reader and Google's Rich Results tooling after localizing the fallback strings.

## Validated Claims With No Finding

- The README now correctly positions GalleryKit as finished-photo publishing, not editing/culling/scoring: `README.md:29-32`, `README.md:47`.
- Google Analytics is now documented with an empty copy-paste default and deliberate opt-in: `README.md:55-69`, `apps/web/src/site-config.example.json:1-10`, `apps/web/src/app/[locale]/layout.tsx:147-159`.
- Semantic search production mode is described as disabled/operator-enabled rather than one-click admin functionality: `README.md:42`, `apps/web/README.md:59-80`, `apps/web/messages/en.json:745-752`.
- Upload API / Lightroom copy no longer claims a bundled Lightroom plugin: `README.md:205-216`, `apps/web/messages/en.json:827-840`, `apps/web/messages/ko.json:877-890`.
- Privacy selectors and copy align on GPS behavior: public general gallery/photo pages omit coordinates, and map exposure is topic/category-gated: `apps/web/src/lib/data.ts:368-416`, `apps/web/src/app/[locale]/(public)/map/page.tsx:38-50`, `apps/web/messages/en.json:796-804`.

## Missed-Issue Sweep

Final sweeps covered: hard-coded English strings in app/source, all `generateMetadata` implementations, OG image routes, sitemap/robots/feed routes, SEO settings actions/client, semantic/similar search copy and gates, privacy/map wording, admin token wording, README onboarding/deploy/config snippets, and i18n key parity. I did not carry forward fixed cycle-23 findings without revalidating current HEAD.

## Skipped Files

Skipped as not product-marketer-review-relevant after inventory: migrations except where they affect product claims, binary fixtures/images/fonts, most unit/e2e tests beyond using them as claim-lock evidence, generated service-worker output except PWA claim checks, low-level UI primitives under `components/ui/` unless they carried public copy, and unrelated prior review/plan history. No source files were modified; only this review artifact was intentionally changed.
