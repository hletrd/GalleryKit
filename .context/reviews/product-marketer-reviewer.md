# Cycle 31 Product Marketer Review

Custom reviewer prompt was readable at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`. The prompt is BurstPick-specific, so this pass adapts its market-readiness lens to GalleryKit: clarity of promise, first-impression trust, differentiation, conversion/discovery paths, and credibility of product claims. Product code was not edited.

## Evidence

- Runtime: production `https://gallery.atik.kr/en` at desktop `1440x1000` and mobile `390x844`; local dev blocked by missing MySQL with `ECONNREFUSED`.
- Live screenshots: `/tmp/gallery-live-home-desktop.png`, `/tmp/gallery-live-home-mobile.png`, `/tmp/gallery-live-photo-mobile.png`, plus `/tmp/gallery-live-lightbox-mobile.png`.
- Source inventory reviewed: public home, nav, search, photo viewer, lightbox, color metadata, upload/admin, messages, and global CSS.

## Positioning Read

GalleryKit's strongest differentiator is not generic photo hosting. It is a photographer-operated, color-aware, self-hosted gallery that preserves authored images, exposes camera/color details, supports Korean/English, and avoids culling/scoring/edit features. That positioning is credible in source and UI, but the public first impression currently spends too much mobile space on filters and then lets search fail for an obvious term.

## Findings

### PM-31-01: Mobile first impression emphasizes taxonomy before the photography

- Severity: Medium
- Confidence: High
- Evidence: live mobile `390x844`; first photo begins around `y=412` after H1, count, and a multi-row tag filter. Source order is `Latest`, count, `TagFilter`, then the photo grid in `apps/web/src/components/home-client.tsx:255` through `apps/web/src/components/home-client.tsx:286`; all tag chips render as prominent buttons in `apps/web/src/components/tag-filter.tsx:63` through `apps/web/src/components/tag-filter.tsx:120`.
- Failure scenario: a visitor arriving from social/referral wants visual proof first, but the viewport frames the site as a database/filter UI before it frames it as a gallery.
- Fix: make the first mobile viewport photo-led. Collapse or horizontally scroll filters, keep the active state visible, and show at least one strong card immediately under the page title.

### PM-31-02: Search failure undermines the gallery's discovery promise

- Severity: Medium
- Confidence: High
- Evidence: live search for `jihoon` on production returned "Search is temporarily unavailable. Please try again later." while `JIHOON` was visible as a top tag. Search errors are mapped generically in `apps/web/src/components/search.tsx:160` through `apps/web/src/components/search.tsx:270`, and the visible error renders at `apps/web/src/components/search.tsx:473`.
- Selector/metric: search dialog `#search-input`, query `jihoon`, no results, generic unavailable state.
- Failure scenario: a fan, client, or collaborator searches a visible performer name and concludes the archive is unreliable or incomplete.
- Fix: repair the production search failure, then add a resilient fallback: when backend search fails, match visible tags/topics locally and offer "Open JIHOON tag" or "Browse recent photos" instead of a dead end.

### PM-31-03: The brand signal is clean but under-explains the specialist value

- Severity: Low
- Confidence: Medium
- Evidence: live nav presents `ATIK.KR Gallery`; home H1 is `Latest`; footer is byline only. Source nav brand comes from `apps/web/src/components/nav-client.tsx:91` through `apps/web/src/components/nav-client.tsx:108`; home title/count are in `apps/web/src/components/home-client.tsx:255` through `apps/web/src/components/home-client.tsx:264`; footer byline is in `apps/web/src/components/footer.tsx:34` through `apps/web/src/components/footer.tsx:58`.
- Failure scenario: new visitors understand "gallery" but not why this gallery is distinct: color-accurate concert/event photography, photographer-authored presentation, Korean/English browsing, and metadata transparency.
- Fix: add a concise, non-marketing support line near the home H1 or footer, for example one sentence about authored concert/event photography and color-accurate delivery. Keep it quiet; this is a portfolio, not a SaaS landing page.

### PM-31-04: Color/HDR credibility is strong and should remain a visible trust cue

- Severity: Positive finding
- Confidence: High
- Evidence: global CSS includes P3/HDR handling and high-quality rendering in `apps/web/src/app/globals.css:145` through `apps/web/src/app/globals.css:202`; viewer/color details exist in `apps/web/src/components/color-details-section.tsx:303` through `apps/web/src/components/color-details-section.tsx:344`; the lightbox color pip is integrated in `apps/web/src/components/lightbox.tsx:663` through `apps/web/src/components/lightbox.tsx:674`.
- Failure scenario if regressed: the gallery becomes visually generic and loses its strongest professional-photographer differentiator.
- Fix: preserve color/HDR UI as a trust cue, but keep it opt-in and subordinate to the photo unless the user opens details.

### PM-31-05: Error and empty states are trust-preserving, but production search needs a friendlier recovery path

- Severity: Low
- Confidence: High
- Evidence: local DB failure rendered a branded error shell with retry/home actions from `apps/web/src/app/[locale]/error.tsx:22` through `apps/web/src/app/[locale]/error.tsx:57`; empty gallery copy exists in `apps/web/src/components/home-client.tsx:426` through `apps/web/src/components/home-client.tsx:442`. Search, by contrast, shows a generic unavailable message in `apps/web/src/components/search.tsx:473`.
- Failure scenario: whole-page failures communicate recovery, but command-level failures communicate only outage.
- Fix: give search a recovery action: clear query, open current tag list, or link to latest photos. This keeps the product promise alive during partial failure.

## Market Readiness Summary

- Strong: visual product, bilingual nav, precise color pipeline, photo-first detail pages, privacy/admin separation, touch-target discipline.
- Weak: mobile home hierarchy, production search reliability, slightly generic public positioning.
- Best next move: fix live search and compress mobile filters before adding new public features. Those two changes would improve conversion from "visitor sees archive" to "visitor finds the right photo."
