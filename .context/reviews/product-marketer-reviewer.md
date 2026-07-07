# Product Marketer Reviewer - Cycle 20

Role surface: `product-marketer-reviewer`, adapted to GalleryKit. BurstPick-specific prompt context, paths, and product assumptions were ignored. This review focused on product truth, public/operator claims, docs-to-source support, copy expectations, and trust-risk gaps in the current GalleryKit repository.

## Inventory

Authoritative product/operator docs examined:

- `AGENTS.md` instructions from the session prompt, plus the project `--- project-doc ---` rules.
- `CLAUDE.md` in full, including product boundaries, semantic-search runbook, storage caveat, smart-collection caveat, privacy model, upload API, backup/restore, color/HDR, and deployment notes.
- `README.md`, including positioning, "For/Not for", feature list, deploy notes, privacy/backup warnings, upload API contract, semantic-search caveats, and site-config/analytics warnings.
- `apps/web/README.md`, including first-run settings, environment notes, semantic-search activation, auto alt-text, upload API, and backup caveats.
- Root and app package/config/env surfaces: `package.json`, `apps/web/package.json`, `.env.local.example`, `.env.deploy.example`, `apps/web/src/site-config.json`, and deployment script references.

Public-facing copy and UI surfaces examined:

- Locale copy: `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Public pages/routes: home, topic, photo, shared album, smart collection, timeline, map, privacy, about, feeds, sitemap, robots, manifest, OG routes, and upload serving routes under `apps/web/src/app/[locale]/(public)` plus top-level public metadata routes.
- Public components: nav, footer, search, similar photos, photo viewer/lightbox, color/HDR details, map client/loader, masonry/gallery cards, tag filtering, restore-maintenance state, and sharing/download UI.
- Public API/interaction surfaces: keyword search server action, semantic search API, similar-photo API, public analytics recording, shared links, map GPS display, public image serving, feeds, JSON-LD, and metadata generation.

Admin/operator-facing copy and UI surfaces examined:

- Admin dashboard/upload, image manager, bulk edit, categories/map visibility, tags, SEO, settings, users, password, analytics, upload tokens, and database backup/restore UI.
- Admin actions/API surfaces for settings, images, topics, tags, sharing, collections, embeddings/backfill, upload tokens, admin users, auth, DB backup/restore/export, backup download, and PAT upload.
- Operator safeguards in docs/source: restore maintenance, mutation barriers, same-origin/auth guards, proxy/IP/rate-limit notes, upload limits, DB TLS notes, Docker deploy/prune notes, and sidecar-only CLIP runbook notes.

Source-truth checks examined:

- Semantic search: `gallery-config-shared.ts`, `gallery-config.ts`, `semantic-search-settings-ui.ts`, `settings.ts`, settings UI, `clip-*` libraries, `embeddings.ts`, semantic/similar APIs, search UI, similar-photos UI, and related tests/source contracts.
- Privacy and analytics: `data.ts` public/admin select fields, map select/query guards, public analytics actions, `analytics.ts`, `analytics-data.ts`, analytics schema, privacy page, map page/client, and map privacy tests.
- Upload/API claims: PAT upload route, token actions/UI, upload limits/tracker, process-image pipeline, GPS stripping, HDR ingest gates, and README API contract.
- Backup/restore claims: DB page, DB actions, backup download route, SQL restore scanner, MySQL TLS helper, restore maintenance helpers, and backup/restore copy.
- Storage/backend claims: `apps/web/src/lib/storage/*`, direct filesystem upload/processing/serving paths, and docs warning that storage abstraction is local-only/not integrated.
- Smart-collection claims: schema/data access, public `/c/[slug]` route, collection actions, messages/server errors, and CLAUDE warning that authoring is not exposed in admin UI/API.
- Removed or unsupported feature claims: payment/Stripe, proofing, culling, scoring, rating, S3/MinIO switching, bundled Lightroom Classic plugin, remote AI captioning, role separation, and hosted/SaaS positioning.

Historical corpus checked:

- `.context/plans/`, `plan/`, `docs/superpowers/`, and `.context/reviews/` were searched for product-claim drift. Old paid-download, Lightroom-plugin, and other deferred/historical references exist in review/plan history, but they are not current public/operator product documentation and are contradicted or explicitly superseded by README/CLAUDE/current source.

## Files Examined

- Full read: `CLAUDE.md` (760 lines), `README.md`, `apps/web/README.md`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Route/component inventory: all current tracked files under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/app/actions`, and `apps/web/src/app/api` were enumerated; review-relevant product/copy/claim files were opened or searched by claim terms.
- Tracked-file sweep: 3,353 filtered tracked text/source/doc files were inventoried for review relevance after excluding generated/vendor/binary/lock/meta noise.
- Exact source regions spot-checked for claim support included:
  - README positioning and caveats: `README.md:29-54`, site config/analytics `README.md:60-77`, operator warnings `README.md:173-180`, upload API `README.md:218-227`.
  - App README operator caveats: `apps/web/README.md:48-63`, semantic runbook `apps/web/README.md:65-91`, auto alt-text/upload API `apps/web/README.md:93-106`.
  - Semantic gating: `apps/web/src/lib/gallery-config-shared.ts:1-260`, `apps/web/src/lib/gallery-config.ts:1-256`, `apps/web/src/lib/semantic-search-settings-ui.ts:1-23`, `apps/web/src/app/actions/settings.ts:90-228`, `apps/web/src/app/api/search/semantic/route.ts:1-260`.
  - Public privacy/GPS: `apps/web/src/lib/data.ts:251-487`, `apps/web/src/lib/data.ts:1777-1817`, `apps/web/src/app/[locale]/(public)/map/page.tsx:1-115`, `apps/web/src/components/map/map-client.tsx:1-142`, `apps/web/src/__tests__/map-privacy.test.ts:1-150`.
  - Analytics truth: `apps/web/src/lib/analytics.ts:1-191`, `apps/web/src/lib/analytics-data.ts:1-213`, `apps/web/src/app/actions/public.ts:300-580`, `apps/web/src/db/schema.ts:232-275`.
  - Upload API truth: `apps/web/src/app/api/admin/lr/upload/route.ts:1-360`, token UI/actions, upload limits, and token messages.
  - Backup/restore truth: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:1-260`, `apps/web/src/app/[locale]/admin/db-actions.ts:1-280`, backup/restore messages, and backup download route.
  - Storage truth: `apps/web/src/lib/storage/index.ts:1-146` plus local backend/types and direct filesystem serving/upload paths.

## Findings

Findings: none.

No confirmed product-marketing, docs, public-copy, or operator-copy issue was found in the current source. Current public/operator claims are qualified where the implementation is limited:

- Semantic search is documented and surfaced as disabled by default, stub-only in Settings, and production/operator-enabled only after env, DB mode, weights, and embeddings are in place.
- Similar photos are hidden unless semantic search resolves to production mode.
- Auto alt-text is described as default-off EXIF/metadata-derived suggestions, not remote AI captioning or automatic rewrite.
- Upload integration is documented as a PAT-authenticated API contract, not a bundled Lightroom Classic plugin.
- Storage switching is not marketed; the source and CLAUDE state the storage abstraction is local-only and not wired into the live image pipeline.
- Smart collections have a public read route and server actions, but current docs do not market admin authoring as an available UI feature.
- Public/privacy copy matches source behavior: public selects omit GPS except the map route for `map_visible` topics, first-party analytics do not store full IPs in analytics rows, Google Analytics is opt-in via build-time site config, and map tiles use OpenStreetMap.
- Backup/restore copy warns that SQL dumps are plaintext rows only and do not include private originals, public derivatives, or resource files.
- Current README/About copy explicitly excludes editing, culling, scoring, proofing, payment, hosted SaaS workflows, and bundled Lightroom Classic plugin support.

## Final Sweep

Search terms used across current docs, messages, app routes, components, actions, API routes, and libraries included: `Stripe`, `checkout`, `payment`, `paid`, `entitlement`, `license_tier`, `S3`, `MinIO`, `storage backend`, `Lightroom Classic plugin`, `lightroom plugin`, `culling`, `proofing`, `scoring`, `rating`, `AI caption`, `model-generated`, `smart collection`, `semantic search`, `Google Analytics`, `analytics`, `backup`, `restore`, `map_visible`, `GPS`, and `OpenStreetMap`.

No review-relevant current product docs/UI/source interactions were intentionally skipped. Generated build output, package locks, Drizzle metadata, images/fonts/icons, fixture binaries, and vendor artifacts were excluded as non-claim-bearing. Historical plan/review artifacts were included in the sweep for stale-claim awareness but not treated as current product promises unless the claim also appeared in active README/app docs/messages/source.

## Validation

- Verified the target report path is exactly `.context/reviews/product-marketer-reviewer.md`.
- No source code was changed.
- No executable tests were run because this lane produced a review artifact only.
