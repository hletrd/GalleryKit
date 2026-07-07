# Product Marketer Reviewer - Cycle 22

Review target: current `HEAD` `dabf8e8a`.

Role surface: `product-marketer-reviewer`, adapted to GalleryKit. The local profile's BurstPick-specific product assumptions were ignored; only the claim-verification and positioning-critical review posture was reused.

## Executive Summary

GalleryKit's positioning is much sharper than earlier cycles: the README and in-app About copy now say exactly what the product is for, what it is not for, and which operator-runbook features require deliberate activation. Go-to-market readiness is still constrained by one trust risk: the repository ships a real Atik deployment `site-config.json` at the same path new operators are told to customize, and the production validator accepts it as a valid non-placeholder URL. That can silently publish the wrong canonical host/brand for a fresh self-hosted deployment.

## Product-Truth Inventory

Docs and app copy reviewed:

- `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.context/plans/README.md`
- `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`
- public About/Privacy/Footer/Nav pages and EN/KO message catalogs
- semantic search config/UI/route source, storage abstraction source, upload token copy, free-download and Cycle 22 source-contract tests

Runtime evidence:

- Local `next start` rendered `/en`, `/en/map`, `/en/privacy`, and `/en/admin`.
- Browser title/nav/footer showed Atik branding from the checked-in config on the local build.

Validation:

- Targeted Vitest run passed 9 files / 63 tests, including source contracts for Cycle 22, search disclaimers, i18n parity, and free-download boundaries.

## Findings

### PMR-C22-01 - Checked-in Atik site config can silently become a fresh deploy's public brand/canonical

Severity: Medium  
Confidence: High  
Status: Confirmed

Exact file/region:

- `apps/web/src/site-config.json:2-10`
- `README.md:60-77`, `README.md:121-122`, `README.md:171-172`, `README.md:198-200`
- `apps/web/README.md:19-20`, `apps/web/README.md:49-50`, `apps/web/README.md:57`
- `apps/web/scripts/ensure-site-config.mjs:12-42`
- `apps/web/src/app/sitemap.ts:14-18`
- `apps/web/src/app/[locale]/layout.tsx:15-26`
- `apps/web/src/components/footer.tsx:33-37`

Evidence:

- The committed config contains real deployment values: `Atik Gallery`, `https://gallery.atik.kr`, `Atik`, and `Atik Gallery` footer/nav text (`site-config.json:2-10`).
- Getting-started docs tell operators to copy the example into that same path and edit it (`README.md:121-122`; `apps/web/README.md:19-20`), but the path already exists in the repo.
- Production build validation uses `process.env.BASE_URL || siteConfig.url` and rejects only missing, invalid, localhost, or example hosts (`ensure-site-config.mjs:12-42`). A real Atik URL passes.
- Sitemap generation uses `process.env.BASE_URL || siteConfig.url` (`sitemap.ts:14-18`), layout metadata uses `seo.url` from config/DB fallback (`layout.tsx:15-26`), and footer text renders `siteConfig.footer_text` directly (`footer.tsx:33-37`).
- Browser evidence from local build: page title and nav/footer rendered "Atik Gallery" from the checked-in config.

Failure scenario:

A self-hosting operator clones the repo, creates `.env.local`, misses the config-copy step because `apps/web/src/site-config.json` already exists, and builds without `BASE_URL`. The production guard passes because `https://gallery.atik.kr` is a syntactically valid non-placeholder URL. Public metadata, sitemap, footer, manifest/fallback branding, and crawler-visible canonicals can then point to Atik's gallery, undermining SEO and operator trust.

Concrete fix:

Make deployment-specific branding impossible to ship by default. Options:

- Track only `site-config.example.json`, gitignore `site-config.json`, and require a local config or `BASE_URL` for production.
- Or keep a committed generic config but make production validation reject generic/placeholders unless `BASE_URL` is explicitly set.
- If the Atik config must remain for the primary deployment, add a denylist or env requirement so generic builds cannot pass with `gallery.atik.kr`.
- Add a source test that a production build without `BASE_URL` cannot pass with the checked-in deployment-specific config.

## Product Claims Checked

Semantic search: current copy is supportable. README says it is disabled by default, operator-runbook-only for production, uses CLIP after weights/backfill/env opt-in, and scans bounded newest embeddings rather than a vector index. Source supports this with default `semantic_search_mode: 'disabled'`, resolver gating production on `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, Settings writing only Disabled/Stub, and route 503 behavior outside stub/production.

No editor/culling/scoring: current copy is supportable. README and About page explicitly say GalleryKit is not an editor, culler, scoring tool, proofing portal, payment system, hosted SaaS workflow, or bundled Lightroom Classic plugin.

Upload integration: current copy is supportable. Docs and token copy describe a PAT-authenticated upload API for external clients and do not promise a bundled Lightroom plugin.

Storage: current copy is supportable. CLAUDE and storage source are aligned that live upload/processing/serving paths remain local filesystem and the storage abstraction is not an S3/MinIO product feature.

Analytics/privacy: current copy is supportable. Privacy copy distinguishes optional Google Analytics from first-party local view events and rate-limit buckets, and discloses OpenStreetMap tile requests.

Auto alt text: current copy is supportable. App/docs describe EXIF-derived hints, not model-generated captions.

Free download/payment: current source contract guards no paid/entitlement symbols on the public download path.

## Positioning Assessment

Current strongest position: "A self-hosted finished-photo gallery for photographers/operators who want private originals, color-conscious public delivery, first-party analytics by default, and deliberate operator-controlled search."

This is credible because it avoids over-claiming AI, avoids replacing Lightroom, and names operational limits. The positioning should continue leaning into trust: local originals, no bundled SaaS dependency, explicit semantic-search activation, honest backup scope, and no photo-editing/culling pretense.

## Trust/Risk Recommendations

Tier 0: block silent deployment-specific canonicals by fixing the `site-config.json` default/validator contract.

Tier 1: make the first-run setup copy clearer in docs after the config fix: "this file is intentionally untracked/local" or "production requires BASE_URL".

Tier 2: add a short About/README proof block explaining what "operator-controlled search" means in one sentence: disabled by default, local weights after setup, no cloud query API, bounded scan limits.

Tier 3: add launch-oriented evidence later: sample deployment checklist, semantic-search activation proof transcript, and a public "what GalleryKit does not do" section in docs/site copy.

## Final Sweep

Searched docs, messages, routes, components, libraries, and tests for `AI`, semantic search, similar photos, culling, scoring, proofing, payment, Stripe, license, Lightroom/plugin, S3/MinIO/storage, Google Analytics, OpenStreetMap, backup/restore, `site-config`, Atik branding, `BASE_URL`, and free-download claims.

Uninspected categories: live production database/settings, generated build output, binary assets, package-lock provenance, real search model weights, production deploy host state, and external marketing channels beyond repository docs/app copy. No source files were edited, and no commits, pushes, or deploys were performed.
