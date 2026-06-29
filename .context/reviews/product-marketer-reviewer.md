# Product Marketer Review - Cycle 14

Date: 2026-06-30
Scope: current HEAD only. Review style adapted from the local product-marketer prompt for positioning, claims-vs-implementation, docs/UI trust, SEO/feed metadata, and user-facing copy. BurstPick-specific market assumptions were not applied to GalleryKit.

## Executive Summary

I found three confirmed issues, two likely issues, and three risks that need manual/live validation. The strongest trust problems are overbroad README wording around metadata search, inconsistent "Topics & Albums" vs "Categories" vocabulary, and a feed metadata default that can emit a blank author/copyright on fresh self-hosted installs that follow the example config.

No production code was modified. This report is the only file changed.

## Inventory Reviewed

- Core project instructions and context: `AGENTS.md`, `CLAUDE.md`
- Public product docs: `README.md`, `apps/web/README.md`
- Config and deploy examples: `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`, `.env.local.example`, `.env.deploy.example`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- User-facing copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- SEO, OG, feeds, manifest, robots, sitemap: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/lib/atom-feed.ts`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`
- Public/admin UI surfaces and claims: navigation, footer, search, photo viewer, info sheet, admin settings, token management
- Feature-claim implementation checks: metadata search, semantic search/similar photos, service worker PWA behavior, site/SEO settings, Lightroom token API, color/HDR messaging, package versions

## Confirmed Issues

### 1. README Uses "Topics & Albums" While the Product UI Uses "Categories"

Severity: Low
Confidence: High

Evidence:
- `README.md:34` advertises "Topics & Albums".
- `apps/web/messages/en.json:3-5` exposes the primary nav as `Home`, `Categories`, and `Search`.
- `apps/web/messages/en.json:76-108` names the public taxonomy surface "Categories" throughout the UI.

Failure scenario:
A new operator reads the README, then opens the app/admin UI and looks for "topics" or "albums". The UI consistently says "Categories", so the product feels less polished and harder to map from docs to implementation. This is especially risky because "Albums" implies a user-facing collection model that the visible UI copy does not present as the primary concept.

Concrete fix:
Use one user-facing noun in public docs. The lowest-risk fix is to rewrite `README.md:34` to "Categories - Organize photos into categories with slug aliases..." and, if needed, add a small implementation note elsewhere that categories are called topics internally in code/database naming.

### 2. README Overstates Keyword Search as "Full Metadata Search"

Severity: Medium
Confidence: High

Evidence:
- `README.md:36` claims "Tagging & Search - full metadata search across titles, descriptions, cameras, and tags".
- `apps/web/src/lib/data.ts:1542-1548` searches title, description, camera model, lens model, topic slug, and topic label.
- `apps/web/src/lib/data.ts:1596-1604` searches tag names.
- `apps/web/src/lib/data.ts:1605-1612` searches topic aliases.
- No matching branch in `searchImages` searches EXIF fields such as ISO, aperture, shutter speed, focal length, capture date, GPS, ICC profile, or color/HDR metadata.

Failure scenario:
A photographer or self-hosting operator expects queries like `ISO 3200`, `f/1.8`, `35mm`, a date, GPS location, or color profile to work because "full metadata search" sounds comprehensive. When those searches fail, the README looks inflated even though the implemented search is useful within its actual field set.

Concrete fix:
Either narrow the claim or extend the implementation. The trust-preserving copy fix is: "Search titles, descriptions, camera and lens models, categories, category aliases, and tags." If GalleryKit wants to keep "full metadata search", add explicit query support for the major EXIF/searchable metadata fields and document privacy-sensitive exclusions.

### 3. Fresh Example Config Can Produce Blank Atom Feed Author/Rights

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/site-config.example.json:6` sets `"author": ""`.
- `apps/web/src/lib/data.ts:1733-1740` resolves `seo.author` from `seo_author` or `siteConfig.author`.
- `apps/web/src/app/feed.xml/route.ts:103-108` falls back to `© ${new Date().getFullYear()} ${seo.author}` when `siteConfig.copyright` is absent.
- `apps/web/src/app/feed.xml/route.ts:116-120` always passes `feedAuthor.name: seo.author`.
- `apps/web/src/lib/atom-feed.ts:92-104` always emits `<author><name>...</name></author>` from that value.

Failure scenario:
A self-hosted deploy copied from `site-config.example.json` and without an admin SEO author override can expose an Atom feed with an empty `<author><name></name></author>` and a weak rights string like `© 2026 `. Feed readers, validators, and subscribers may display blank ownership metadata, reducing trust in a public photography site.

Concrete fix:
Make the example author non-empty, for example `"author": "Your Name"`, and document it as required/recommended for feeds and SEO. In code, also consider falling back feed author to the site title and suppressing `<rights>` unless either `siteConfig.copyright` or a non-empty author is present. Document the optional `copyright` key if operators are expected to use it.

## Likely Issues

### 4. PWA "Offline HTML Fallback" Claim Is Broader Than the Implemented Behavior

Severity: Low
Confidence: Medium-High

Evidence:
- `README.md:38` claims "PWA - Service worker with stale-while-revalidate image cache and offline HTML fallback".
- `apps/web/public/sw.template.js:7-18` describes a narrower behavior: image SWR, HTML network-first cache, 24-hour offline-only fallback, and admin bypass.
- `apps/web/public/sw.template.js:62-66` classifies revocable share, smart collection, group, and map routes as bypassed from offline HTML caching.
- `apps/web/public/sw.template.js:297-338` serves cached HTML only after a successful prior network response and only while the entry is within `HTML_MAX_AGE_MS`.
- `apps/web/public/sw.template.js:392-398` bypasses revocable share HTML routes before applying the HTML fallback.

Failure scenario:
An operator may market GalleryKit as broadly offline-capable. In reality, unvisited pages do not work offline, cached public HTML expires after 24 hours, and admin/share/smart collection/group/map pages intentionally require network. A client testing a shared collection or map offline could perceive the PWA claim as broken.

Concrete fix:
Qualify the README claim: "PWA - image stale-while-revalidate cache plus 24-hour offline fallback for previously visited public gallery/photo HTML pages; admin, map, and revocable share routes stay network-only." This keeps the security-sensitive bypasses visible as a product strength rather than a surprise.

### 5. Firefox Color/HDR Copy Blames the Wrong Capability Layer

Severity: Low
Confidence: Medium

Evidence:
- `apps/web/messages/en.json:739-740` says Firefox "does not support the color-gamut media query or dynamic-range detection".
- `apps/web/messages/ko.json:739-740` carries the same claim in Korean.
- `CLAUDE.md:368-375` says Firefox parses `(color-gamut: p3)` since v110 but still returns false for wide gamut because Firefox has not implemented wide-gamut rendering; dynamic-range remains unsupported.

Failure scenario:
Technically sophisticated photographers or browser engineers can notice that the UI copy is imprecise. The product's color-management positioning is otherwise careful, so this wording creates avoidable doubt in a high-trust area.

Concrete fix:
Reword both locales to avoid the incorrect API-level claim. Suggested English direction: "Firefox currently reports no usable P3/HDR capability through the detection APIs GalleryKit can trust, so GalleryKit keeps previews in sRGB there." Mirror the nuance in Korean.

## Risks Needing Manual Validation

### 1. Semantic Search Live Demo Claim

Severity: Medium
Confidence: Medium

Evidence:
- `README.md:37` says semantic search is "live on the demo with CLIP weight seeding".
- `apps/web/README.md:56-76` documents disabled/stub/production modes and the production activation requirements.
- `apps/web/src/app/api/search/semantic/route.ts:168-185` rejects disabled/stub modes differently from production.
- `apps/web/src/app/api/search/semantic/route.ts:279-283` returns 503 when production mode has no real embeddings.

Failure scenario:
The code supports the claim, but a production/demo configuration drift could make the README's "live on the demo" statement stale. Users trying English/Korean semantic search on the demo would lose confidence if they receive disabled/stub/no-embedding behavior.

Concrete fix:
Manually validate the live demo after deploy/config changes: run one English semantic query, one Korean semantic query, and one similar-photos action. If the demo is not guaranteed to stay enabled, change README wording from "live on the demo" to a versioned/current-status note.

### 2. OG/Social Card Rendering Was Code-Inspected, Not Externally Validated

Severity: Low
Confidence: Medium

Evidence:
- `apps/web/src/app/[locale]/(public)/page.tsx:61-123` builds alternate feed metadata and Open Graph image metadata from configured or latest-photo sources.
- `apps/web/src/app/api/og/route.tsx:33-224` renders the generic/topic OG card.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:38-299` renders photo-specific OG cards and includes fallback redirect behavior.

Failure scenario:
Generated OG cards can be syntactically valid in code but still render poorly, fail in social validators, or expose unexpected fallback images once deployed behind the configured base URL/proxy.

Concrete fix:
Validate at least the home OG image, one topic OG image, and one photo OG image with deployed URLs and social-card validators. Capture failures as product trust bugs, not just visual bugs.

### 3. PWA Install/Offline Behavior Was Not Browser-Tested

Severity: Low
Confidence: Medium

Evidence:
- `apps/web/src/app/manifest.ts:6-52` defines a manifest suitable for app install surfaces.
- `apps/web/public/sw.template.js:370-403` handles the fetch strategy for images, HTML, revocable shares, admin, and pass-through requests.

Failure scenario:
The product claim may still fail in a real browser because of scope, registration, HTTPS/proxy behavior, cache headers, or installability criteria even though the source implementation is coherent.

Concrete fix:
Run a production-build browser smoke: load public gallery, verify service worker registration, installability, offline reload of a previously visited public photo route, and network-only behavior for admin/share/map routes.

## Final Missed-Issues Sweep

I re-swept the claim-bearing surfaces with repository search for product-facing terms including `GalleryKit`, `semantic`, `offline`, `PWA`, `Lightroom`, `HDR`, `P3`, `search`, `metadata`, `author`, `copyright`, `Open Graph`, `feed`, `S3`, `MinIO`, `AI`, `production`, `demo`, `category`, `topic`, and `album`.

Relevant files intentionally not deeply reviewed:
- Historical `.context/reviews/` and `.context/plans/` files, because this review targets current HEAD product claims rather than prior-cycle findings.
- Full unit/e2e test suites, except where needed to understand product-claim contracts.
- Every admin implementation page in full detail. The review searched user-facing messages and inspected the main claim-heavy admin settings/token surfaces, but did not line-audit every CRUD table and analytics view.
- Live production/demo URLs, social-card validators, and browser PWA install/offline flows. Those are listed above as manual validation risks.

No relevant README, CLAUDE/docs, config example, message bundle, SEO/feed/OG/manifest/sitemap route, search/semantic implementation, service worker, or deployment document identified in the inventory was skipped.

