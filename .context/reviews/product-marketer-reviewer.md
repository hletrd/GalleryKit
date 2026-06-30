# Cycle 26 Product Marketer Reviewer

Date: 2026-06-30
Role: product-marketer-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `5eb711e7305d`

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Product and marketing inventory covered:

- Root `README.md`, `apps/web/README.md`, `.env.local.example`, `.env.deploy.example`, nginx comments, Docker/deploy docs, and site config example.
- Localized user/admin copy in `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Product-claim implementation anchors for finished-photo positioning, no payment/editing/culling/scoring surface, local-only storage positioning, semantic-search gates, Google Analytics opt-in, privacy copy, HDR/color honesty, and external upload API wording.
- Public/admin UI surfaces where positioning appears in-product: privacy page, admin settings, upload/tokens copy, search/semantic search copy, color/HDR settings.

## Findings

### C26-PMR-01 - Primary admin settings copy blends photographer decisions with operator runbook detail

- Severity: Medium
- Confidence: Medium
- File and lines:
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:296-328`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:741-789`
  - `apps/web/messages/en.json:748-781`
  - `apps/web/messages/ko.json:748-781`
- Failure scenario: A photographer-admin trying to decide whether to enable semantic search or re-encode existing photos has to parse implementation terms such as CLIP, deterministic placeholder embeddings, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, stored `production` values, sidecar backfill, `--force-reencode`, CPU/disk-heavy live-host work, and pipeline versions inside the primary settings flow. The product promise is self-hosted finished-photo publishing, but the control surface reads like an operator runbook, especially in Korean where the paragraphs are long and dense.
- Fix: Split the copy into outcome-first primary text and collapsible/operator-detail text. The primary controls should say what visitors will see, whether existing photos need processing, and what mode is safe for normal admins. Move env flags, sidecar commands, production DB rows, and `--force-reencode` into an "Operator details" disclosure or docs link. Rewrite Korean text as shorter native UI copy instead of a line-for-line technical explanation.

## Prior Product-Issue Recheck

- Fixed: the fresh-install DB examples now consistently use `gallerykit` in `README.md`, `apps/web/README.md`, and `apps/web/.env.local.example`.
- Fixed: nginx upload-route comments now say `PAT-authenticated external upload API` and `external publish clients`, no longer implying a bundled Lightroom publish plugin.

## Validated Claims With No New Finding

- Finished-photo positioning is consistent: docs say GalleryKit is not for editing, culling, scoring, proofing, payment, or hosted SaaS workflows.
- Payment/Stripe surfaces remain absent from the reviewed product copy and route inventory.
- Semantic search is honestly positioned as disabled by default and operator-enabled for production.
- Google Analytics copy remains opt-in and distinguishes third-party GA from first-party local analytics.
- Storage positioning remains local/self-hosted; no S3/MinIO switching is marketed as a supported admin feature.
- Upload API wording is now aligned around PAT-authenticated external clients and no bundled Lightroom Classic plugin.

## Verification

Static product-copy and implementation-claim sweep plus browser checks of public privacy/search/error surfaces. Targeted UI/a11y tests passed: 4 files, 43 tests. No source code beyond these review artifacts was changed.

## Missed-Issue Sweep

Searched for database onboarding names, Lightroom/plugin wording, S3/MinIO claims, Stripe/payment/paid-download terms, editing/culling/scoring/proofing claims, Google Analytics claims, semantic-search gate wording, HDR planned-output wording, public metadata/privacy claims, and deploy/onboarding snippets. No additional product-marketing mismatch rose above the reporting threshold.
