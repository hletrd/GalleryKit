# GalleryKit Product Marketer Review

Date: 2026-07-07
Reviewed workspace: `/Users/hletrd/flash-shared/gallery`
Lane: product-marketer-reviewer
Prompt adaptation: used `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` for evidence-first product/positioning review only. BurstPick-specific desktop-app, culling, pricing, and path requirements were not applied.

## Executive Summary

GalleryKit's core product claims are mostly honest and well scoped: self-hosted finished-photo publishing, private originals, color-aware derivatives, first-party analytics, operator-gated CLIP search, and no editing/culling/scoring/plugin overclaim. The go-to-market risk is weaker than "the docs lie" but still material: the demo and public UI under-present the features that make the product differentiated. Market-readiness score from a product-claim perspective: **7/10**. The product should not add broader marketing claims until the existing map/timeline/search/similar-photo surfaces are easier for evaluators to discover.

## Scope And Inventory

Inventoried claim surfaces:

- Control docs: `AGENTS.md`, `CLAUDE.md`.
- Public/operator docs: `README.md`, `apps/web/README.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Visible product copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, live demo pages at `https://gallery.atik.kr/en`, `/en/map`, `/en/timeline`, `/en/about-gallerykit`, `/en/privacy`.
- Public UI/source: `apps/web/src/app/[locale]/(public)/**`, `components/nav-client.tsx`, `footer.tsx`, `search.tsx`, `photo-viewer.tsx`, `info-bottom-sheet.tsx`, `similar-photos.tsx`, `on-this-day-widget.tsx`, map/timeline/year/shared/smart-collection pages.
- Admin/operator UI/source: admin nav, categories, tags, SEO, settings, tokens, DB, analytics, upload/image-manager surfaces, semantic-search settings, deploy/init scripts.
- Claim verification paths: semantic/similar API routes, CLIP gates/backfill/preflight docs, upload-token API, privacy/analytics data access, smart-collection route/actions/copy, storage quarantine, PWA/offline scope, install/init, deploy scripts, and tests covering those claims.

Skipped from product-claim review after final sweep: generated build output, `node_modules`, raw fixture assets, and unrelated dirty review files already present in the worktree. Prior reviews/plans were checked for duplicates; resolved smart-collection copy was not re-filed.

## Findings

### PMR-C12-01 - Map and timeline are marketed as visitor experiences but are effectively undiscoverable

Severity: Medium
Confidence: High
Validation: Confirmed

Evidence:

- `README.md:36` promises the visitor experience includes "map/timeline browsing."
- `apps/web/src/app/[locale]/(public)/map/page.tsx:68-115` implements a public map page.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:61-260` implements a public timeline page.
- `apps/web/src/components/nav-client.tsx:128-164` renders topic links in primary navigation; map/timeline are not included.
- `apps/web/src/components/nav-client.tsx:167-191` renders search, theme, and locale controls after the topic links; map/timeline are not included there either.
- `apps/web/src/components/footer.tsx:41-61` links About, Privacy, GitHub, and Admin, but not Map or Timeline.
- `apps/web/src/components/on-this-day-widget.tsx:24` returns `null` when no same-day historical photos exist; its Timeline link exists only in that conditional widget at `on-this-day-widget.tsx:39-44`.
- `apps/web/src/app/sitemap.ts:129-135` returns homepage/topic/photo/feed entries only, so static experience pages are not surfaced through sitemap discovery.
- Live demo on 2026-07-07: `https://gallery.atik.kr/en`, `/en/map`, and `/en/timeline` returned HTTP 200. Playwright on the home page found no `a[href*="/map"]` or `a[href*="/timeline"]` anchors.

Failure scenario / user impact:

A README or demo visitor sees "map/timeline browsing" positioned as a visitor capability, opens the live gallery, and has no visible path to either feature. Timeline may appear only on calendar days where `OnThisDayWidget` has matching photos; Map has no normal public entry point. The feature is real, but it looks aspirational from the main product experience.

Suggested fix:

Add persistent public affordances for Map and Timeline. A low-risk fix is footer links beside About/Privacy, plus optional primary-nav links when data exists. If these are intentionally secondary, add direct links and scope language on `/about-gallerykit`, and include Timeline in the sitemap. Keep Map `noindex` if that is a privacy choice, but still give visitors an in-product route to the feature.

### PMR-C12-02 - Production semantic search works on the demo but is hidden behind an icon-only affordance

Severity: Medium
Confidence: High
Validation: Confirmed

Evidence:

- `README.md:48` positions semantic search as a notable feature: natural-language search in English and Korean plus similar photos.
- `apps/web/README.md:67-78` repeats the self-hosted CLIP capability and operator activation requirements.
- `apps/web/messages/en.json:826-830` describes GalleryKit as offering "operator-controlled search" and names semantic search as an operator workflow.
- `apps/web/src/components/search.tsx:371-386` renders the closed search affordance as `size="icon"` with `aria-label={t('aria.searchPhotos')}` and only a search icon as visible content.
- `apps/web/src/components/search.tsx:521-555` shows the "Semantic search" switch and production caveat only after the visitor opens the dialog.
- Live demo on 2026-07-07: Playwright found a visible `button[aria-label="Search photos"]` at 44 x 44 px with empty visible text; `document.body.innerText` did not contain visible `Search photos` or `Semantic search` before opening the dialog.
- Live demo semantic API smoke on 2026-07-07: `POST https://gallery.atik.kr/api/search/semantic` with `Origin: https://gallery.atik.kr` and `{"query":"TWS","topK":5}` returned HTTP 200 with real photo results.

Failure scenario / user impact:

The strongest differentiator is active in production, but a first-time evaluator must infer that a small magnifying-glass icon opens search, then notice the semantic switch inside the modal. This weakens the first 30 seconds of product evaluation: the product has a defensible feature but does not visibly sell it.

Suggested fix:

When `semanticSearchMode === 'production'`, show visible nav copy such as `Search` or `Search photos` next to the icon at desktop widths. In the empty modal state, add a concise cue such as `Keyword or semantic search` and provide example Korean/English prompts drawn from real gallery content. Keep the accessibility label, but do not rely on it as the main product signal.

### PMR-C12-03 - "Similar photos" is documented as a visitor feature but is absent from the mobile photo surface

Severity: Medium
Confidence: High
Validation: Confirmed

Evidence:

- `README.md:48` and `apps/web/README.md:67` advertise `"similar photos"` as part of semantic search.
- `apps/web/messages/en.json:830` describes "similar photos" as an operator-controlled feature.
- `apps/web/src/components/similar-photos.tsx:58-141` implements a production-only `<SimilarPhotos>` panel.
- `apps/web/src/components/photo-viewer.tsx:747-755` marks the info sidebar as hidden on mobile and only visible at `lg+`.
- `apps/web/src/components/photo-viewer.tsx:797-800` mounts `<SimilarPhotos>` only inside that desktop info sidebar.
- `apps/web/src/components/info-bottom-sheet.tsx:353-608` is the mobile expanded info surface; it includes tags, description, color details, histogram, EXIF, capture date/time, GPS/admin rows, and downloads, but no `<SimilarPhotos>` mount or semantic-search prop.
- Targeted source sweep for `SimilarPhotos|similarPhotos|semanticSearchMode` across `info-bottom-sheet.tsx`, `lightbox.tsx`, and `photo-viewer.tsx` finds `SimilarPhotos` only in `photo-viewer.tsx`.

Failure scenario / user impact:

A mobile visitor opens a photo on a production semantic-search gallery and taps Info. They can inspect metadata, histogram, and downloads, but the advertised image-to-image discovery feature is unavailable. For a public photo gallery, mobile is a primary consumption surface; hiding "similar photos" there undercuts the feature claim.

Suggested fix:

Pass `semanticSearchMode` and `imageSizes` into `InfoBottomSheet` and render `<SimilarPhotos>` in the expanded mobile sheet, likely near the description or below the color/histogram block. If the endpoint is intentionally desktop-only for cost or layout reasons, scope the docs and About copy to "desktop similar photos" instead of advertising it as a general visitor feature.

## Positioning Notes

Best one-sentence positioning based on verified source:

> GalleryKit is a self-hosted finished-photo gallery for photographers who want private originals, color-aware public derivatives, first-party analytics, and optional on-host semantic discovery without a hosted SaaS.

Avoid leading with "AI" alone. The credible phrasing is "operator-enabled, self-hosted CLIP search" because the implementation is gated, offline-weighted, bounded, and explicit about stub/production behavior. That specificity is more trustworthy than generic AI-gallery language.

## Non-Findings Verified During Final Sweep

- Install/init docs align with source: `npm run init` maps to `scripts/init-db.ts`, which runs migrations and admin seeding.
- Deploy docs align with source: root `npm run deploy` maps to `scripts/deploy-remote.sh`; remote deploy maps to `apps/web/deploy.sh`; env-file permission checks, host-network Docker, build-time `site-config.json`, and Docker pruning are documented and implemented.
- Semantic search honesty holds at route/UI level: default disabled, stub disclosed as non-meaningful, production env-gated, model-version-filtered, bounded scan, and 503 instead of fake production results when real embeddings are unavailable.
- Upload-token docs and UI avoid claiming a bundled Lightroom Classic plugin; they describe a PAT-authenticated multipart upload API and token UI with `lr:upload` scope.
- Auto alt-text copy is scoped as EXIF-derived hints, not vision AI; `caption-generator.ts` is explicitly a stub and the bulk editor applies suggestions only by admin action.
- Public About and README correctly reject editor/culling/scoring/proofing/payment/hosted-SaaS positioning.
- Privacy copy matches inspected source boundaries: standard pages exclude GPS, public map uses explicit topic-level GPS visibility, Google Analytics is config-gated, local analytics are first-party, and OSM map tiles are disclosed.
- S3/MinIO storage is not marketed as supported; `CLAUDE.md` correctly quarantines the storage abstraction as not integrated.
- PWA docs are appropriately scoped as installable plus same-origin visited-image/offline HTML fallback, not full offline gallery sync.
- Smart-collection delete guidance is currently honest about the missing admin UI: `apps/web/messages/en.json:506-507` tells operators to update/remove `smart_collections query_json`.

## Verification Notes

No application source, plans, commits, pushes, deploys, or unrelated review files were modified. Only this assigned review artifact was written.

Validation evidence collected:

- Read `AGENTS.md`, `CLAUDE.md`, the product-marketer reviewer prompt, READMEs, message files, and relevant docs.
- Inspected public/admin source for navigation, search, similar photos, map/timeline, semantic gates, upload tokens, settings, privacy, deploy/init, and tests.
- Used Playwright for live demo visibility evidence on `https://gallery.atik.kr/en`.
- Used `curl` for live route/API checks on `/en`, `/en/map`, `/en/timeline`, `/en/about-gallerykit`, and `/api/search/semantic`.
- Ran a final claim sweep for semantic search, similar photos, map/timeline, smart collections, upload API, privacy/analytics, storage, PWA/offline, install/init, deploy claims, and skipped-file boundaries.
