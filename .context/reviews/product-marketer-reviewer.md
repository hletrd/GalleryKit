# Product Marketer Review - Cycle 15

Date: 2026-06-30
Reviewer lane: product-marketer-reviewer
Scope: current HEAD `3efa0c0e`, GalleryKit repo only. Adapted the local product-marketer prompt to GalleryKit's self-hosted gallery/product-docs context, not BurstPick.

## Executive Summary

I found 4 product-copy / operator-positioning findings: 3 confirmed and 1 likely. The largest risk is that the repo ships a real demo-domain `site-config.json` and the production guard accepts it, so a self-hosted operator can accidentally publish canonical URLs, robots/sitemap/feed links, OG fallbacks, and preconnect metadata for `gallery.atik.kr` while believing GalleryKit is configured as their own self-hosted site. The engineering underneath most feature claims is strong and unusually honest about limits; the remaining issues are mostly configuration/default-copy and integration-positioning mismatches that can erode operator trust.

## Inventory Reviewed

- Public docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`
- Config/defaults: `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/lib/constants.ts`, `apps/web/src/lib/data.ts`
- Public UI/message copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, homepage/photo/share/search/privacy/admin token/settings copy
- SEO/public identity surfaces: root layout metadata, sitemap, robots, OG routes, feeds, privacy page, analytics referrer handling
- Feature claim checks: semantic search/similar photos, PWA/service worker, color/HDR pipeline, Lightroom upload token API, categories/shared groups, search copy, storage/deploy docs

## Findings

### 1. Checked-in demo URL can silently become a self-hosted site's canonical identity

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- `README.md:8` positions GalleryKit as "self-hosted"; `README.md:148` says production builds need `BASE_URL` or a non-placeholder `site-config.json` URL.
- `apps/web/src/site-config.json:4` is committed with `"url": "https://gallery.atik.kr"`.
- `apps/web/scripts/ensure-site-config.mjs:12-40` accepts any non-placeholder absolute URL; `gallery.atik.kr` is not rejected.
- `apps/web/src/lib/constants.ts:21-24` and `apps/web/src/lib/data.ts:1733-1740` use `process.env.BASE_URL || siteConfig.url`.
- `apps/web/src/app/[locale]/layout.tsx:22-45`, `apps/web/src/app/sitemap.ts:18-103`, and `apps/web/src/app/robots.ts:24` publish that effective URL into metadata, sitemaps, and robots.

Scenario:
A new operator follows the Docker/build docs, does not set `BASE_URL`, and misses that the committed `site-config.json` is the demo config rather than an inert template. The production guard passes, but their deployed site advertises `gallery.atik.kr` as canonical in SEO, Open Graph, feeds, robots/sitemap, and preconnect. That is a product-trust failure for a self-hosted app.

Fix:
Do not ship a real third-party/demo canonical URL as the tracked default. Either keep only `site-config.example.json` tracked and require an explicit runtime/bind-mounted `site-config.json`, or make the committed file a rejected placeholder. Also add `gallery.atik.kr` to the production guard's forbidden demo-host list unless `ALLOW_DEMO_SITE_CONFIG` or an equivalent deploy-only escape hatch is set.

### 2. Analytics self-referrer classification ignores the documented `BASE_URL` override

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `README.md:122-149` tells operators to set `BASE_URL` as the public URL; `apps/web/src/lib/constants.ts:21-24` describes it as the centralized base URL override.
- `apps/web/src/lib/analytics.ts:4-10` promises same-origin referrers are stored as `self`.
- `apps/web/src/lib/analytics.ts:140-143` derives the own-site host from `siteConfig.url` only, not `process.env.BASE_URL`.
- `apps/web/src/app/actions/public.ts:345-352` stores `sanitizeReferrerHost(referer)` for view analytics, and `apps/web/src/lib/analytics-data.ts:192-212` exposes the referrer breakdown to admins.

Scenario:
An operator correctly sets `BASE_URL=https://photos.example.com` but leaves the checked-in `site-config.json` URL untouched. Metadata uses `photos.example.com`, but analytics treats referrals from `photos.example.com` as an external `example.com` referrer instead of `self`. Admins then make product/traffic decisions from misleading referrer data.

Fix:
Make `analytics.ts` use the same effective URL contract as metadata: `process.env.BASE_URL || siteConfig.url`. Add a test that sets `BASE_URL` and verifies `sanitizeReferrerHost("${BASE_URL}/p/1") === "self"` even when `siteConfig.url` differs.

### 3. README still advertises "Albums" where the product surface is categories plus share groups

Severity: Low
Confidence: High
Status: Confirmed

Evidence:
- `README.md:34` says "**Categories & Albums** -- organize photos into categories with slug aliases".
- The admin/public taxonomy UI consistently says categories: `apps/web/messages/en.json:4`, `apps/web/messages/en.json:76-109`, `apps/web/messages/en.json:140`, `apps/web/messages/en.json:154-156`.
- "Album" appears only for shared-group analytics/not-found copy, not as a primary organizing model: `apps/web/messages/en.json:427`, `apps/web/messages/en.json:870`, `apps/web/messages/en.json:880`.

Scenario:
An evaluator expects an album model separate from categories, then finds only category management and share links/groups. The feature exists as categories and shared collections, but the README headline overstates the information architecture.

Fix:
Change `README.md:34` to "Categories" or "Categories & Sharing" and reserve "album" for shared group/user-facing copy only if the product intentionally wants shared groups to be marketed as albums.

### 4. "Lightroom-compatible token upload API" can read like a bundled Lightroom integration

Severity: Low
Confidence: Medium-High
Status: Likely

Evidence:
- `README.md:40` advertises a "Lightroom-compatible token upload API".
- The actual route is explicitly server API only: `apps/web/src/app/api/admin/lr/upload/route.ts:4-9` says it accepts external clients including a Lightroom publish-client implementation, but GalleryKit does not bundle/distribute a Lightroom plugin.
- Admin UI copy is clearer than the README: `apps/web/messages/en.json:805-807` says upload API tokens are for server-side upload integrations and no Lightroom Classic plugin is bundled.
- Token creation currently grants only `lr:upload`: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61`.

Scenario:
A photographer/operator reads the README and expects a ready Lightroom Classic publish plugin or plug-and-play Lightroom setup. They only get a PAT-authenticated upload endpoint and must supply/build the client side. The API claim is true, but the README omits the caveat where expectations are formed.

Fix:
Rewrite the README phrase to "PAT-authenticated upload API for external clients; no Lightroom Classic plugin is bundled." If a Lightroom client exists out-of-repo, link it and specify support boundaries.

## Positive Claim Checks

- Semantic search docs match the implementation posture: disabled by default, stub mode is non-meaningful, production is env/DB/weights gated, text search scans bounded newest embeddings, and similar photos is production-only (`README.md:37`, `apps/web/README.md:58-76`, `apps/web/src/app/api/search/semantic/route.ts:168-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:97-176`).
- PWA/offline copy is now appropriately qualified in the root README as visited image caching plus offline HTML fallback, not full offline gallery sync (`README.md:38`; service worker constraints in `apps/web/public/sw.template.js`).
- Auto alt-text copy is honest that Florence-2 inference is not implemented yet (`apps/web/messages/en.json:726`).
- Color/HDR copy is mostly aligned with engineering: HDR ingest is opt-in, SDR delivery is disclosed, gain-map/HDR signals are admin-audit surfaces, and wide-gamut limitations are visible in copy/source (`README.md:33`, `apps/web/messages/en.json:162`, `apps/web/messages/en.json:366-368`, `apps/web/messages/en.json:739-742`, `apps/web/src/lib/process-image.ts` color/HDR pipeline).
- Storage/backend docs avoid marketing S3/MinIO as supported; `CLAUDE.md:142` explicitly quarantines the unwired storage abstraction.

## Final Missed-Issues Sweep

I re-swept claim-bearing surfaces with searches for: `self-hosted`, `demo`, `BASE_URL`, `siteConfig.url`, `canonical`, `sitemap`, `robots`, `feed`, `OG`, `analytics`, `referrer`, `semantic`, `AI`, `PWA`, `offline`, `Lightroom`, `plugin`, `album`, `category`, `HDR`, `color`, `S3`, `MinIO`, `paid`, `Stripe`, `not implemented`, `disabled`, and `production`.

No additional source-backed mismatches were found beyond the four findings above. I did not live-test `https://gallery.atik.kr`, social validators, or browser PWA install/offline behavior; this was a current-HEAD source/docs/product-copy review as requested.
