# Cycle 30 Designer Review

Reviewer: designer
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-30
Scope: UI/UX review only. No product-code fixes.

## Executive Summary

GalleryKit's public UI is visually coherent and generally usable: the live desktop/mobile pages expose a clear masonry gallery, topic nav, Korean/English locale switch, search trigger, privacy page, timeline, and empty map state. The largest design problem is that several high-trust workflows stop before they become complete user experiences: live search fails with generic copy, share creation has no visible lifecycle management, and public GPS map design still assumes every enabled marker and every accessible fallback link can be rendered at once. Design readiness score: 7/10 for current small-gallery browsing, 5/10 for operator trust workflows.

## Browser Evidence

- Playwright headless inspected `https://gallery.atik.kr/en`, `/ko`, `/en/privacy`, `/en/map`, `/en/timeline` at 1440x900 and 390x844.
- Live pages returned 200 with no page errors.
- Sampled visible controls were 44 px or larger: nav title, search, theme, locale, topic chips, photo cards, load-more, privacy/admin links.
- `/en/map` rendered the localized empty state "No geotagged photos are available on the map."
- Searching `JIHOON` in the live search dialog returned a server-action payload with `{"status":"error","results":[]}` and displayed "Search failed. Please try again."

## Findings

### C30-DES-01 - Search failure state blocks a primary discovery workflow

Severity: High
Confidence: High for live UI failure, Medium for root cause
Region: selector `button[aria-label="Search photos"]` -> `#search-dialog`; `apps/web/src/components/search.tsx:240-248`, `apps/web/src/components/search.tsx:473-476`, `apps/web/messages/en.json:421-424`, `apps/web/src/app/actions/public.ts:305-316`

Concrete failure scenario: A visitor sees repeated visible photo titles/tags on the home grid, opens search, types `JIHOON`, and gets the generic failure message. The user has no distinction between no results, rate limiting, semantic setup, DB/search failure, or a retryable network issue.

Suggested fix: Fix the production search error first, then split the UI copy into actionable states. For caught server-action errors, return a stable error code and show "Search is temporarily unavailable" with a retry affordance; keep "No results" only for valid empty results.

### C30-DES-02 - Public map design can overwhelm both visual and assistive users at scale

Severity: Medium
Confidence: High
Region: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:75-99`, `apps/web/src/components/map/map-client.tsx:76-90`, `apps/web/src/components/map/map-client.tsx:119-140`

Concrete failure scenario: A photographer enables public GPS for a travel/event category with thousands of photos. The page renders a dense Leaflet layer and a giant `#map-photo-list`, forcing keyboard and screen-reader users through hundreds or thousands of links and making mobile rendering fragile.

Suggested fix: Treat the accessible list as a paginated result set, not a dump of every marker. Add clustering or viewport loading, plus a visible count/truncation message and filters by topic/year before the marker layer mounts.

### C30-DES-03 - Share affordance lacks a matching revoke/manage affordance

Severity: Medium
Confidence: High
Region: `apps/web/src/components/photo-viewer.tsx:586-618`, `apps/web/src/components/image-manager.tsx:194-210`, `apps/web/src/app/actions/sharing.ts:317-397`, `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:204-235`

Concrete failure scenario: In admin, "Share" copies a public URL and then disappears into toast history. Later, the admin needs to audit or revoke the link, but the dashboard does not show active links; analytics only lists top shared albums by key/view count and opens them in a new tab.

Suggested fix: Add a "Shares" admin section or a panel in Dashboard/Analytics with active links, type, item count/photo, created time, last viewed/view count, copy/open, and revoke/delete. Use destructive confirmation for revoke/delete.

### C30-DES-04 - Semantic search copy advertises a power feature beside a failing baseline search path

Severity: Medium
Confidence: Medium-High
Region: `apps/web/src/components/search.tsx:491-528`, `apps/web/messages/en.json:429-431`, `README.md:41-42`, `apps/web/README.md:60-70`

Concrete failure scenario: The live search dialog shows a semantic-search switch and production hint, but the default keyword query fails. Visitors infer the advanced search story is unreliable because the simpler search path cannot complete.

Suggested fix: Hide or de-emphasize semantic controls when keyword search is failing or when semantic setup is incomplete. Add a runtime status check that can label semantic search as "available", "setup required", or "temporarily unavailable" before the visitor toggles it.

### C30-DES-05 - Generic page error state loses gallery context

Severity: Low-Medium
Confidence: Medium
Region: `apps/web/src/app/[locale]/error.tsx:22-57`, public DB reads in `apps/web/src/app/[locale]/(public)/page.tsx:161-178` and `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`

Concrete failure scenario: During a transient DB problem, public pages collapse to a generic card with Home/Try Again. The user loses normal topic nav, search, theme, locale, footer, and product-specific context.

Suggested fix: Add route-local public data-unavailable states that preserve the public shell. Reserve the generic error shell for unknown crashes.

## Coverage Matrix

- IA: Reviewed public nav, topic chips, home grid, map, timeline, privacy, photo/share entry points, admin share/analytics source. Main IA gap is share management.
- Affordances: Search, topic filters, language/theme, load more, map skip link, lightbox, info/share buttons reviewed. Search and share need stronger recovery/lifecycle affordances.
- Keyboard/focus: Source and live DOM show focus rings, skip link, dialog focus trap, keyboard instructions, and 44 px targets. Map fallback scale remains the keyboard risk.
- WCAG 2.2: Current controls generally meet target size. Potential issues are generic error messaging and very large map fallback lists.
- Responsive states: Live desktop/mobile pages rendered; no overlap observed in sampled text. Source uses responsive masonry and nav expansion.
- Loading/empty/error: Map empty is clear; route error and search error are weak.
- Forms: Admin forms reviewed by source only; live admin not exercised.
- i18n/RTL: English/Korean parity exists; Korean live page renders. RTL is not supported or claimed.
- Perceived performance: Good for current live gallery; map and semantic search are scale-sensitive.
- Product-message alignment: Finished-photo gallery positioning matches UI. Search and share claims exceed current observed UX completeness.

## Rechecked Fixed Items

- GPS map publish now uses an explicit confirmation dialog: `topic-manager.tsx:290-321`.
- Public privacy copy now mentions short-lived full-IP rate-limit buckets: `apps/web/messages/en.json:811-812`.
- App README now directs Settings review before first real upload: `apps/web/README.md:24`.
- Theme control now uses mounted state to avoid server/client theme label drift: `nav-client.tsx:41-48`, `nav-client.tsx:51-54`.

## Skipped Areas

- No admin login, upload, delete, share creation, revoke, restore, or settings mutation was performed against production.
- No screenshots were committed; browser evidence was captured as console output only.
- No full Playwright E2E suite was run because this is an artifact-only review turn.

## Final Sweep

Final sweep covered IA, public discovery, map, search, share, keyboard/focus, touch targets, WCAG-adjacent states, responsive behavior, loading/empty/error states, i18n, and product-message alignment. No code changes were made.
