# Product Marketer Reviewer - Cycle 21

Review target: current `HEAD` `45b32d1db373e03d82a29511f53832051c770880`.

Role surface: `product-marketer-reviewer`, adapted to GalleryKit. The local profile's BurstPick-specific product assumptions were ignored; only the product-truth and positioning-critical review mindset was reused. This is a code/doc review of shipped behavior versus product-facing docs, UI copy, metadata, and operator claims.

## Required Context Read First

- `AGENTS.md`: read before review; repo policy says GalleryKit is a self-hosted finished-photo gallery, with no edit/culling/scoring features, strict quality gates, and product docs/reviews under `.context/`.
- `CLAUDE.md`: read before review; used as the detailed source of product boundaries, deployment model, semantic-search activation, storage caveat, privacy model, upload API, schema/runbook notes, and unsupported-feature boundaries.
- `.context/plans/README.md`: read before review; used to avoid treating historical plan text as current product truth.

## Inventory Before Findings

Docs and operator-facing product claims:

- Root and app docs: `README.md`, `apps/web/README.md`, `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.
- Deployment/config docs and examples: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`.
- Current docs were checked for claims about semantic search, similar photos, upload API, no bundled Lightroom plugin, backup/restore scope, local-only storage, privacy/GPS, analytics, PWA behavior, Docker deploy, and unsupported editor/culling/scoring/payment/proofing/SaaS positioning.

Site config, metadata, OG, feed, robots, sitemap:

- Site config: `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`.
- Metadata entry points: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, photo/topic/shared/smart-collection page metadata, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`.
- Discovery surfaces: `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/manifest.ts`.

Public pages/components and messages:

- Public pages reviewed or inventoried: home, topic, photo, shared album, smart collection, timeline, map, privacy, about GalleryKit, feed, sitemap, robots, manifest, OG routes, and upload/image-serving surfaces.
- Public components reviewed or inventoried: nav, footer, home client, search, similar photos, photo viewer/lightbox, masonry/gallery cards, color/HDR details, map client/loader, tag filtering, share/download UI, restore-maintenance state.
- Locale copy reviewed: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

Admin settings/UI and operator controls:

- Settings and SEO: `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`, `settings-client.tsx`, `seo/page.tsx`, `seo-client.tsx`.
- Other admin UI/actions inventoried: dashboard/upload, image manager, bulk edit, categories/map visibility, tags, users, password, analytics, upload tokens, database backup/restore, admin actions, and admin/public API routes.
- Specific claims checked: GPS strip lock, EXIF alt-text hints, semantic-search Disabled/Stub/production gating, color/HDR controls, upload token scope/expiry copy, and backup/restore warnings.

Tests/source contracts proving product claims:

- Semantic-search truth: `semantic-search-settings-ui.test.ts`, `settings-semantic-mode-action.test.ts`, `search-semantic-toggle-source.test.ts`, `search-disclaimer.test.ts`, semantic/similar API tests and source contracts.
- Metadata/config truth: `seo-settings-fallback.test.ts`, `home-metadata-title.test.ts`, `ensure-site-config.test.ts`, `sitemap-robots.test.ts`, `atom-feed.test.ts`, `photo-og-metadata.test.ts`, `og-route-source-contracts.test.ts`.
- Product-boundary/privacy truth: privacy-field tests, map privacy tests, analytics tests, touch-target/source-contract tests, cycle source-contract tests that pin no editor/culling/scoring/payment/plugin claims.

## Findings

### PMR-21-01 - Committed site config can publish Atik branding/canonicals for a fresh self-hosted deploy

Severity: Medium

Confidence: High

Exact files/regions:

- `apps/web/src/site-config.json:2-10` contains real deployment values: `Atik Gallery`, `https://gallery.atik.kr`, `Atik`, and `Atik Gallery` footer/nav text.
- `README.md:60-77` correctly explains that file-backed config controls static links, fallback metadata, analytics, URL, footer, and build-time-inlined values.
- `README.md:121-122` and `apps/web/README.md:15-20` tell operators to copy the example to `site-config.json` and edit it, but the repo already contains a non-example `site-config.json` at that destination.
- `apps/web/scripts/ensure-site-config.mjs:12-21` builds `configuredUrl` from `BASE_URL || siteConfig.url` and only rejects placeholder hosts.
- `apps/web/scripts/ensure-site-config.mjs:23-42` rejects missing, relative, non-http, and placeholder production URLs, but accepts any real URL, including the committed Atik URL.
- `apps/web/src/app/sitemap.ts:14-18` uses `process.env.BASE_URL || siteConfig.url` for sitemap URLs.
- `apps/web/src/app/[locale]/layout.tsx:15-26` uses `getSeoSettings()` for `metadataBase`, default title, and description; `apps/web/src/__tests__/seo-settings-fallback.test.ts:89-117` proves the fallback is `site-config.json` unless `BASE_URL` overrides URL.
- `apps/web/src/__tests__/ensure-site-config.test.ts:53-76` proves the production guard catches placeholder/example URLs and accepts an override, but does not assert that the committed deployment-specific URL is rejected.

Concrete confusion scenario:

A self-hosting operator clones GalleryKit, sees product docs describing a reusable self-hosted gallery, and runs a production build without setting `BASE_URL` or without overwriting the already-present `apps/web/src/site-config.json`. The build passes because `gallery.atik.kr` is a syntactically valid non-placeholder URL. Public metadata, sitemap entries, manifest/default branding, footer text, and fallback SEO can then point to or name Atik's gallery instead of the operator's site. The failure is product-facing: crawlers and social previews can learn the wrong canonical host/brand, while the operator may believe the admin SEO panel has covered all visible branding.

Suggested fix:

Make deployment-specific branding non-committed or non-passable by default. Practical options:

- Track only `site-config.example.json` and make `site-config.json` gitignored/local, then keep `ensure-site-config.mjs` requiring a local production config or `BASE_URL`.
- Or keep a committed generic `site-config.json` with placeholder values and make the production validator reject placeholder/generic values unless `BASE_URL` is explicitly set.
- If the Atik config must remain for the primary deployment, add an explicit production validation denylist or environment requirement so a generic GalleryKit build cannot silently ship `gallery.atik.kr` canonicals.
- Add a source test that the committed default config is either generic/non-production or that production builds without `BASE_URL` fail when the checked-in config belongs to a real deployment.

## Non-Findings Checked

- Semantic search docs/UI are accurate: production mode is operator-runbook-only; Settings can save Disabled or Stub only; stub copy says results are not semantically meaningful; similar photos are production-only.
- EXIF alt-text copy is accurate: it describes EXIF-derived placeholders and explicitly says model-generated descriptions are not implemented.
- Upload integration copy is accurate: docs/UI describe PAT-authenticated upload API tokens and explicitly do not promise a bundled Lightroom Classic plugin.
- Privacy/GPS copy is directionally supported by source: public GPS is limited to map-visible categories, analytics rows do not store raw full IP addresses, GA is opt-in via build-time config, and map tiles use OpenStreetMap.
- Backup/restore copy is accurate: DB dumps are row-only and do not include private originals, derivatives, resources, or host-level file state.
- Current public docs/About copy correctly excludes editing, culling, scoring, proofing, payment, hosted SaaS workflows, and bundled plugin support.
- Smart collections have public/source support but are not marketed as admin-authorable; the admin copy that mentions them warns that collections are not editable in the admin UI yet.

## Final Sweep

Search terms swept across current docs, messages, app routes, components, actions, API routes, libraries, and relevant tests included: `Stripe`, `checkout`, `payment`, `paid`, `entitlement`, `license_tier`, `S3`, `MinIO`, `storage backend`, `Lightroom Classic plugin`, `lightroom plugin`, `culling`, `proofing`, `scoring`, `rating`, `AI caption`, `model-generated`, `smart collection`, `semantic search`, `Google Analytics`, `analytics`, `backup`, `restore`, `map_visible`, `GPS`, `OpenStreetMap`, `site-config`, `metadataBase`, `sitemap`, `robots`, `feed`, and `manifest`.

Uninspected categories: generated build output, package locks, Drizzle metadata hashes, binary media/font/icon assets, browser-rendered screenshots, and live deployed production state. Historical plan/review artifacts were searched for stale-claim awareness, but not treated as current product promises unless the same claim appears in active README/app docs/messages/source.

## Validation

- Wrote only `.context/reviews/product-marketer-reviewer.md`.
- Did not edit source code or other review files.
- Did not commit or push, per user instruction.
- Did not run executable tests; this lane produced a review artifact based on source/doc inspection.
