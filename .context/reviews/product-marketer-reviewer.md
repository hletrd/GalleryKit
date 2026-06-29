# Product Marketer Review - Cycle 10

Date: 2026-06-29
Reviewer: product-marketer-reviewer
Repository: GalleryKit
Scope: Product, positioning, market-readiness, UI/docs claim accuracy, and trust signals for GalleryKit as a self-hosted photographer gallery web app. This is Prompt 1 only; no implementation changes were made.

## Executive Summary

GalleryKit's core positioning is credible: the repo consistently presents a self-hosted photographer gallery, not an editing/culling/scoring tool, and the strongest claims around color management, semantic search, admin scope, SQL-only restore, and public GPS privacy are mostly backed by code. The main actionable trust gap is that the admin UI and server comments tell operators to connect a "GalleryKit Lightroom Classic publish plugin," but this repository contains no installable plugin, setup guide, or plugin download surface. Two secondary risks remain around third-party analytics disclosure and the first-upload GPS retention decision.

Finding count: 1 confirmed issue, 1 likely issue, 1 risk, 6 aligned/no-action checks.

| Severity | Confirmed | Likely | Risk |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 1 | 1 | 0 |
| Low | 0 | 0 | 1 |

## Profile Adaptation Note

The local agent profile at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` is BurstPick-specific and asks for Swift/BurstPick source files. This repository is GalleryKit, so I used only the role's product-marketing and claim-verification stance. I did not look for absent BurstPick Swift files beyond noting the mismatch, and I prioritized `AGENTS.md`, `CLAUDE.md`, and GalleryKit source/docs.

## Inventory Summary

Product/docs/marketing surfaces reviewed:

- `README.md`
- `apps/web/README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `apps/web/src/site-config.example.json`
- `apps/web/src/site-config.json`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`

Implementation claim checks reviewed:

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/map-privacy.test.ts`
- `apps/web/src/__tests__/search-route-privacy.test.ts`
- `apps/web/src/__tests__/semantic-route-production.test.ts`
- `apps/web/src/__tests__/similar-route.test.ts`
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`
- `apps/web/src/__tests__/lr-tokens-action.test.ts`

Inventory searches:

- `rg --files` for docs/UI/code surfaces.
- `rg --files | rg -i "lightroom|lrplugin|lua|plugin|publish"` found only server/token/test files: `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, and related tests. No `.lrplugin`, Lua plugin source, plugin package, or plugin setup doc was present.
- `rg --files | rg -i "privacy|terms|policy|consent|cookie"` found privacy tests and analytics code, but no public privacy/terms/cookie/consent page.

## Confirmed Findings

### PMR-C10-01 - Lightroom plugin is marketed in-product, but no plugin artifact or setup path exists

Severity: Medium
Confidence: High
Classification: Confirmed product/trust issue

Exact regions:

- `apps/web/messages/en.json:782-787` labels the admin page "Lightroom Tokens" and says admins can generate tokens for the "GalleryKit Lightroom Classic publish plugin."
- `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:11-24` renders that token page and description directly in the admin UI.
- `apps/web/src/app/api/admin/lr/upload/route.ts:1-16` documents the upload endpoint as the server-side counterpart to the Lightroom plugin and specifically references the plugin's `GalleryKitAPI.lua`.
- `CLAUDE.md:152` describes "Lightroom Classic publish-plugin PATs" and says the plugin accepts `X-GalleryKit-Token`.
- `README.md:148` and `apps/web/README.md:46` mention `/api/admin/lr/upload` so Lightroom publishes bypass the generic admin upload body cap.
- Inventory evidence: no `.lrplugin`, Lua file, install package, or user-facing setup document exists in the repo. The only Lightroom-matching source files are the server route, token actions, and tests.

Why this is a problem:

The UI creates an expectation that a user can generate a token and connect Lightroom Classic. The backend route appears real and well-hardened, but the product surface does not provide the thing the user needs next: where to get the plugin, how to install it, what server URL/header it uses, what topic field is required, and what errors Lightroom will show. For a photographer evaluating a self-hosted workflow, this reads as a partially shipped integration.

Concrete failure scenario:

A photographer installs GalleryKit, opens Admin -> Tokens, generates an LR token, then cannot find the Lightroom publish plugin or setup instructions. They either abandon the integration or try to reverse-engineer the API. The gap damages trust because the UI implied a complete Lightroom workflow.

Concrete fix:

Ship one of these before presenting the integration as a plugin:

- Add the Lightroom plugin artifact/source and a clear install guide, linked from the Tokens page.
- Add a "Setup Lightroom Classic" help block beside token creation with plugin download path, server URL, token header, topic mapping, file limits, and troubleshooting.
- If the plugin is not ready to distribute, relabel the page to "Upload API Tokens" and change the copy to "Lightroom plugin support is server-ready; plugin distribution is not included yet."

## Likely Findings

### PMR-C10-02 - Google Analytics can be enabled without any public privacy/disclosure surface

Severity: Medium
Confidence: Medium
Classification: Likely trust/compliance issue

Exact regions:

- `README.md:46-58` documents `google_analytics_id` as part of the file-backed site configuration.
- `apps/web/src/site-config.example.json:9-10` ships `footer_text` and `google_analytics_id` defaults, with analytics empty by default.
- `apps/web/src/app/[locale]/layout.tsx:147-155` injects `https://www.googletagmanager.com/gtag/js` and runs `gtag('config', ...)` whenever `siteConfig.google_analytics_id` matches the allowed pattern.
- `apps/web/src/components/footer.tsx:42-54` renders only GitHub and Admin links; there is no privacy/cookie link in the default public footer.
- Inventory evidence: no public privacy, terms, cookie, or consent route/page was found.

Why this is a problem:

The default is privacy-preserving because analytics is empty, but the documented config makes third-party Google tracking a one-line switch. Once enabled, visitors receive third-party analytics scripts without an included privacy notice, disclosure link, or consent strategy. That is a trust problem for client galleries and a compliance risk for operators serving EU/UK/KR visitors.

Concrete failure scenario:

A photographer sets `google_analytics_id` to measure client gallery traffic. The site starts loading Google Tag Manager/Analytics on every public page, but there is no public privacy notice explaining visitor tracking or data transfer. A client or venue objects, or the photographer has to disable analytics after sharing galleries.

Concrete fix:

Add a minimal privacy/analytics disclosure path and link it from the footer when GA is configured. At minimum, document that enabling `google_analytics_id` adds third-party tracking and that operators are responsible for consent/legal notices. A stronger product fix is a built-in privacy page template with configurable owner/contact text and a "no third-party analytics" default posture.

## Risk Findings

### PMR-C10-RISK-01 - GPS stripping is a locked first-upload decision, but the default retains GPS

Severity: Low
Confidence: Medium
Classification: Product trust risk, not a confirmed public leak

Exact regions:

- `apps/web/src/lib/gallery-config-shared.ts:91-97` sets `strip_gps_on_upload` to `false` by default.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:543-567` renders the privacy setting and disables it when `hasExistingImages` is true.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:569-572` tells admins the upload contract is locked for an existing gallery.
- `apps/web/src/app/actions/images.ts:347-357` removes DB GPS fields and strips retained originals only when `uploadConfig.stripGpsOnUpload` is true.
- Positive boundary evidence: `apps/web/src/lib/data.ts:367-407` omits latitude/longitude from normal public fields, and `apps/web/src/lib/data.ts:1658-1683` exposes coordinates only through the map query when `topics.map_visible = true`.

Why this matters:

The code has a good public GPS boundary, so this is not a confirmed public leak. The risk is the first-run product experience: a new operator can upload photos before noticing the privacy setting, and after photos exist the setting is locked. At that point retained originals and admin metadata may already contain GPS unless the operator regenerates or manually cleans the library.

Concrete failure scenario:

A photographer uploads a first client set from GPS-enabled camera files, then later discovers the "Do Not Store GPS Coordinates" switch. The switch is disabled because images already exist. Public pages still avoid GPS unless map topics are opted in, but the operator has already retained location metadata in private originals contrary to their later privacy intent.

Concrete fix:

Make the GPS decision explicit before first upload. Options: default `strip_gps_on_upload` to `true` for fresh installs, add a first-run privacy step before enabling uploads, or show a blocking/strong warning on the upload page until the operator confirms GPS retention vs stripping. Keep the current map-visible public guard.

## Aligned / No Action Checks

### PMR-C10-OK-01 - Semantic search honesty is strong

Evidence:

- `README.md:37` says semantic search is disabled by default and requires operator setup.
- `apps/web/README.md:53-73` documents model, modes, offline weights, production honesty gate, bounded scan, and operator activation.
- `apps/web/src/lib/gallery-config.ts:123-142` heals stored production mode to disabled unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.
- `apps/web/src/app/api/search/semantic/route.ts:156-176` rejects disabled mode.
- `apps/web/src/app/api/search/semantic/route.ts:242-260` filters by active model version and returns 503 if production has no rows.
- `apps/web/src/components/search.tsx:462-469` shows an experimental disclaimer for stub mode only.

Assessment: No actionable issue.

### PMR-C10-OK-02 - Similar photos is production-only, not stub-hyped

Evidence:

- `apps/web/src/app/api/search/similar/[id]/route.ts:97-113` serves only when `semanticSearchMode === 'production'`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:115-150` requires a production embedding and scans production model rows.

Assessment: No actionable issue.

### PMR-C10-OK-03 - Public GPS privacy boundary is explicitly guarded

Evidence:

- `apps/web/src/lib/data.ts:367-407` omits coordinates from the canonical unauthenticated field set.
- `apps/web/src/lib/data.ts:409-415` states the map field set is the only latitude/longitude public path.
- `apps/web/src/lib/data.ts:1658-1683` enforces processed images, non-null coordinates, and `topics.map_visible = true`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:38-50` passes only narrowed marker fields to the client.

Assessment: No public GPS leak found.

### PMR-C10-OK-04 - RBAC/admin-power claims are honest

Evidence:

- `README.md:40` says "multiple root-admin accounts" and "no role separation yet."
- `CLAUDE.md:5` repeats authentication-only admin accounts.
- `CLAUDE.md:228` says any admin can upload, edit, restore/export, change settings, and manage admins.
- `apps/web/messages/en.json:49-50` warns new admins are full-access root admins.

Assessment: No overclaim found.

### PMR-C10-OK-05 - Backup/restore product copy does not overpromise full-site backups

Evidence:

- `apps/web/messages/en.json:18-24` says DB backups are rows only and files require host-level backups.
- `CLAUDE.md:208-210` says DB restore does not snapshot or roll back host files.

Assessment: No actionable issue in the reviewed copy.

### PMR-C10-OK-06 - Unsupported storage/payment/editing/culling claims are not being marketed

Evidence:

- `CLAUDE.md:141` says S3/MinIO storage is not integrated and must not be documented as supported.
- `CLAUDE.md:522` says paid downloads/Stripe were removed and must not be reintroduced without a product decision.
- `CLAUDE.md:232` states the product has no edit/culling/scoring features.
- README feature copy does not market editing, culling, scoring, payment, or S3 storage as product features.

Assessment: No actionable issue.

## Overall Positioning Notes

GalleryKit's best current position is not "AI gallery" or "portfolio CMS." The defensible wedge is: self-hosted photographer gallery with unusually serious image-delivery fidelity, privacy controls, and operator-owned infrastructure. The README mostly supports that, especially with color pipeline specifics and operator-gated semantic search. The highest-leverage marketing improvements are trust infrastructure around integrations and visitor privacy, not more feature copy.

Recommended one-sentence positioning:

> GalleryKit is a self-hosted photo gallery for photographers who care about color-faithful delivery, private originals, and owning the full publishing stack.

## Verification Notes

No source code was edited. This report is the only file intentionally changed. I did not run the full test suite because this was a read-only review/report task; verification consisted of source/docs inventory, line-level claim checks, and targeted repository searches.
