# GalleryKit Product Marketer Reviewer - Cycle 11

Date: 2026-07-07
Reviewed workspace: `/Users/hletrd/flash-shared/gallery`
Lane: product-marketer-reviewer
Prompt adaptation: used `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` only for its evidence-first product/positioning skepticism. BurstPick-specific market, pricing, AI-culling, and desktop-app assumptions were not applied.

## Scope And Inventory

I inventoried the claim surfaces before filing findings.

- Control docs: `AGENTS.md`, `CLAUDE.md`.
- Public/operator docs: `README.md`, `apps/web/README.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Visible product copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, live demo pages at `https://gallery.atik.kr/en`, `/en/map`, `/en/timeline`, `/en/about-gallerykit`, `/en/privacy`.
- Public UI/source: `apps/web/src/app/[locale]/(public)/**`, `components/nav-client.tsx`, `footer.tsx`, `search.tsx`, `photo-viewer.tsx`, `info-bottom-sheet.tsx`, `similar-photos.tsx`, `on-this-day-widget.tsx`, map/timeline components.
- Admin/operator UI/source: admin nav, categories, settings, tokens, DB, analytics, topic actions, semantic-search settings, deploy/init scripts.
- Claim verification paths: semantic search routes/config/model gates/backfill, similar-photo route/UI, upload-token API, privacy/analytics data access, smart-collection routes/actions, site config, deploy docs.

Generated/vendor outputs and unrelated dirty review/plan files already present in the worktree were not treated as live product surfaces.

## Findings

### PMR-C11-01 - Map and timeline are marketed as visitor experiences but are effectively undiscoverable

Severity: Medium
Confidence: High
Validation: Confirmed

Evidence:

- `README.md:36` promises the visitor experience includes "map/timeline browsing."
- `apps/web/src/app/[locale]/(public)/map/page.tsx:68-115` implements a public map page.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:61-238` implements a public timeline page.
- `apps/web/src/components/nav-client.tsx:128-164` renders only topic links in the primary public navigation.
- `apps/web/src/components/nav-client.tsx:167-191` renders only search, theme, and locale controls after the topics.
- `apps/web/src/components/footer.tsx:42-60` links About, Privacy, GitHub, and Admin, but not Map or Timeline.
- `apps/web/src/components/on-this-day-widget.tsx:24` returns `null` when there are no same-day historical photos; its Timeline link exists only inside that optional widget at `on-this-day-widget.tsx:39-44`.
- Live demo check on 2026-07-07: `https://gallery.atik.kr/en` returned 200, while selectors `a[href="/en/map"]` and `a[href="/en/timeline"]` were absent from the rendered HTML. `/en/map` and `/en/timeline` themselves returned 200.

Failure scenario / user impact:

A README or demo visitor sees "map/timeline browsing" positioned as a visitor capability, opens the live gallery, and has no visible path to either feature. Timeline may appear only on calendar days where `OnThisDayWidget` has matching photos; Map has no normal public entry point at all. That makes the feature claim look aspirational even though the routes work.

Concrete fix:

Add persistent public navigation affordances for Map and Timeline. A low-risk option is footer links beside GalleryKit/Privacy, with optional primary-nav links when data exists. If the intent is to keep them secondary, mention them on `/about-gallerykit` with direct links and clarify that the map only shows admin-published GPS topics.

### PMR-C11-02 - The production semantic-search differentiator is buried behind an unlabeled icon

Severity: Medium
Confidence: High
Validation: Confirmed

Evidence:

- `README.md:48` positions semantic search as a notable feature: natural-language search in English and Korean plus similar photos.
- `apps/web/README.md:67-78` repeats the production CLIP capability and operator activation requirements.
- `apps/web/messages/en.json:826-830` says GalleryKit offers "operator-controlled search" and names semantic search as an operator-controlled feature.
- `apps/web/src/components/search.tsx:369-383` renders the closed search affordance as an icon-only button; "Search photos" is only an `aria-label`.
- `apps/web/src/components/search.tsx:519-555` shows the "Semantic search" switch and production caveat only after the user opens the modal.
- Live demo check on 2026-07-07: POST `https://gallery.atik.kr/api/search/semantic` with `Origin: https://gallery.atik.kr` and `{"query":"TWS","topK":5}` returned HTTP 200 with real photo results, confirming the demo supports the feature. The home page still exposes no visible "Search" or "Semantic search" text until the icon modal is opened.

Failure scenario / user impact:

The most differentiated visitor feature is working on the demo, but a first-time evaluator has to infer that a small icon opens search and then notice a switch inside the modal. Product-market fit suffers because the strongest "why this gallery is different" proof is hidden behind an expert-interface pattern.

Concrete fix:

When `semanticSearchMode === 'production'`, make the nav control visibly say `Search` or `Search photos`, and add a compact hint in the open modal before typing, such as `Keyword or semantic search`. A stronger product-marketing fix is an empty-query suggestion row with example Korean/English prompts drawn from real gallery content.

### PMR-C11-03 - "Similar photos" is documented as a visitor feature but is missing from the mobile photo surface

Severity: Medium
Confidence: High
Validation: Confirmed

Evidence:

- `README.md:48` and `apps/web/README.md:67` advertise `"similar photos"` as part of the semantic-search feature.
- `apps/web/messages/en.json:830` describes "similar photos" as an operator-controlled feature.
- `apps/web/src/components/photo-viewer.tsx:747-755` states the info sidebar is hidden on mobile and only shown at `lg+`.
- `apps/web/src/components/photo-viewer.tsx:797-800` mounts `<SimilarPhotos>` only inside that desktop info sidebar.
- `apps/web/src/components/info-bottom-sheet.tsx:353-560` is the mobile expanded info surface; it includes tags, description, color details, histogram, EXIF, capture time, GPS/admin rows, and downloads, but there is no `<SimilarPhotos>` mount.
- `rg -n "SimilarPhotos|similarPhotos|semanticSearchMode" apps/web/src/components/info-bottom-sheet.tsx apps/web/src/components/lightbox.tsx apps/web/src/components/photo-viewer.tsx` finds `SimilarPhotos` only in `photo-viewer.tsx`.

Failure scenario / user impact:

A mobile visitor opens a photo on a production semantic-search gallery and taps Info. They can inspect metadata, histogram, and downloads, but the advertised image-to-image discovery feature is not present. For a photo gallery, mobile visitors are a major consumption surface; hiding "similar photos" there undercuts the public feature claim.

Concrete fix:

Pass `semanticSearchMode` into `InfoBottomSheet` and render `<SimilarPhotos>` in the mobile expanded sheet near color/histogram or immediately below the description. If the endpoint is too expensive for mobile, document it as desktop-only; otherwise the UI should match the docs.

### PMR-C11-04 - Smart-collection delete guidance points admins to a non-existent remediation UI

Severity: Medium
Confidence: High
Validation: Confirmed

Evidence:

- `CLAUDE.md:162` says smart collections have public read routes and hardened server actions, but no admin UI or API surface invokes them yet; rows are currently authored via direct DB insert.
- `apps/web/src/app/actions/topics.ts:464-483` scans `smart_collections.query_json` while deleting a category and blocks deletion when a predicate references the category slug.
- `apps/web/src/app/actions/topics.ts:516-520` maps that block to `cannotDeleteCategoryReferencedByCollection` or `cannotDeleteCategoryDueToInvalidCollectionQuery`.
- `apps/web/messages/en.json:506-507` tells admins to "Update the collection query directly before deleting this category."
- `apps/web/src/components/admin-nav.tsx:15-25` exposes Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, DB, and Analytics, with no Collections route.
- `apps/web/src/app/[locale]/admin/(protected)/` contains no collections page.

Failure scenario / user impact:

An operator who previously seeded a smart collection tries to delete an empty category. The admin UI blocks deletion and tells them to update a collection query, but provides no collection editor, row id, name, or documented path from the dashboard. The support path becomes source-code or MySQL inspection at the moment the UI implies an ordinary admin workflow exists.

Concrete fix:

Until a Collections UI ships, change the toast copy to name the operator-level path explicitly and return blocking collection ids/names from the server action. Example: `This category is referenced by smart collection(s) not editable in the admin UI yet: {ids}. Update or remove the matching smart_collections query_json row before deleting it.`

## Positioning Notes

GalleryKit's current documentation is notably more honest than most photo-tool marketing: it clearly says no editing, culling, scoring, payment, hosted SaaS, full offline sync, bundled Lightroom plugin, or one-click production semantic search. The remaining product-marketing gap is not overclaiming core infrastructure; it is under-presenting the features that would make an evaluator understand the product's shape from the demo.

Best one-sentence positioning based on verified source:

> GalleryKit is a self-hosted finished-photo gallery for photographers who want private originals, color-aware public derivatives, first-party analytics, and optional on-host semantic discovery without a hosted SaaS.

Avoid leading with "AI" alone. The credible phrasing is "operator-enabled, self-hosted CLIP search" because the implementation is gated, offline-weighted, and bounded rather than magic-caption marketing.

## Non-Findings Verified During Final Sweep

- Install/init docs are supported: `npm run init` calls `scripts/init-db.ts`, which runs `scripts/migrate.js`; `migrate.js:976-1017` seeds an admin if missing and requires `ADMIN_PASSWORD`.
- Deploy docs align with source: root `npm run deploy` maps to `scripts/deploy-remote.sh`; README warnings about `.env.deploy`, host-network Docker, build-time `site-config.json`, proxy trust, and Docker pruning match the inspected scripts/config.
- Semantic search honesty holds at the route and UI level: default disabled, stub disclosed as non-meaningful, production env-gated, model-version-filtered, bounded scan, and 503 rather than fake production results when embeddings are missing.
- Upload-token docs and UI avoid claiming a bundled Lightroom Classic plugin; they describe a PAT-authenticated multipart upload API.
- Public About and README correctly reject editor/culling/scoring/proofing/payment positioning.
- Privacy copy matches inspected source boundaries: public pages exclude GPS except explicit map visibility, Google Analytics is config-gated, local analytics are first-party, and OSM map tiles are disclosed.
- S3/MinIO storage is not marketed as supported; `CLAUDE.md` correctly quarantines it as not integrated.
- PWA docs are appropriately scoped as installable plus visited-image/offline fallback, not full gallery sync.

## Verification Notes

No application source, plans, or unrelated review files were edited. Only this assigned review artifact was written.

Validation evidence collected:

- Read the control docs and relevant public/operator docs.
- Inspected public/admin source where claims needed verification.
- Checked live demo reachability and selectors for home/map/timeline plus a production semantic-search API smoke request.
- Ran a final claim sweep for semantic search, similar photos, map/timeline, smart collections, upload API, privacy/analytics, storage, PWA/offline, install/init, and deploy claims.
