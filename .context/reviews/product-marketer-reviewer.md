# Product Marketer Review - Cycle 11

Date: 2026-06-29
Reviewer: product-marketer-reviewer
Repository: GalleryKit
Scope: Product, marketing, public docs, privacy/footer/site config, admin copy, public pages, and implementation truth for `/Users/hletrd/flash-shared/gallery`. This review is adapted to GalleryKit, not BurstPick. No production code was edited.

## Executive Summary

GalleryKit mostly tells the truth about its product surface: this is a self-hosted photographer gallery with serious color delivery, admin-owned infrastructure, and no payment, culling, scoring, or image-editing product surface. The main trust problem in this cycle is not overbroad positioning; it is privacy and AI wording that contradicts implementation details. The public privacy page says public pages exclude GPS coordinates, but the public `/map` route intentionally exposes opted-in latitude/longitude markers. The footer also hides the privacy page unless Google Analytics is configured, even though the page discloses metadata behavior too. Separately, the bulk editor still says "AI-suggested alt text" while the generator is explicitly an EXIF-derived stub.

Finding count: 3 confirmed issues, 1 risk, 5 aligned/no-action checks.

| Severity | Confirmed | Likely | Risk |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 1 | 0 | 0 |
| Medium | 2 | 0 | 1 |
| Low | 0 | 0 | 0 |

## Profile Adaptation Note

The registered local profile at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` is BurstPick-specific and asks for Swift, ML scoring, pricing, and culling surfaces that do not exist in this repository. I used the role's senior product-marketing claim-verification stance, but followed `AGENTS.md`, `CLAUDE.md`, and GalleryKit source truth. I did not invent BurstPick scope.

## Inventory Summary

Product/docs/marketing surfaces reviewed:

- `README.md`
- `CLAUDE.md`
- `AGENTS.md` instructions supplied in the prompt
- `apps/web/package.json`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/bulk-edit-dialog.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`

Implementation claim checks reviewed:

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/caption-generator.ts`
- `apps/web/src/lib/bulk-edit-types.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/src/components/map/map-loader.tsx`

Focused searches:

- `rg` for `payment`, `Stripe`, `checkout`, `pricing`, `paid`, `culling`, `scoring`, `edit`, `editing`, `S3`, `MinIO`, `semantic`, `AI`, `HDR`, `Lightroom`, `privacy`, `analytics`, `GPS`, `footer`, and `site-config`.
- i18n key parity check with a small Node script over `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Current worktree status before writing showed an unrelated modified `.context/reviews/critic.md`; this review did not touch it.

## Confirmed Findings

### PMR-C11-01 - Privacy page falsely says public pages exclude GPS coordinates

Severity: High
Confidence: High
Classification: Confirmed trust/privacy copy issue

Exact regions:

- `apps/web/messages/en.json:773-781` defines the public Privacy page copy, including `metadataBody`: "Public pages exclude GPS coordinates."
- `apps/web/messages/ko.json:773-781` repeats the same claim in Korean.
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx:21-28` renders that metadata claim on the public privacy page.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:38-50` builds public markers containing `latitude` and `longitude`.
- `apps/web/src/components/map/map-client.tsx:15-22` defines the client marker shape with `latitude` and `longitude`, and `apps/web/src/components/map/map-client.tsx:120-123` renders those coordinates into Leaflet markers.
- `apps/web/src/lib/data.ts:1658-1684` documents and implements `getMapImages()` as the public latitude/longitude path for processed images in `map_visible` topics.
- `apps/web/src/db/schema.ts:9-11` shows `topics.map_visible` defaults to false so the GPS map is opt-in.
- `apps/web/src/app/actions/topics.ts:593-618` exposes the admin action that toggles the public map GPS view.

Why this is a problem:

The implementation is intentionally privacy-aware: GPS is public only on the `/map` route and only for topics the admin opted into. The privacy copy is still false because it uses an absolute claim. A visitor reading the privacy page is told public pages exclude GPS, while another public page can publish exact map coordinates. For a client gallery, venue, home, school, wildlife location, or private event, that contradiction is a direct trust failure.

Concrete failure scenario:

A photographer enables "Show on Map" for a travel category, then sends the gallery to a client. The client opens the Privacy page and sees that public pages exclude GPS coordinates, then finds exact markers on `/map`. The product did the admin-requested thing, but the disclosure makes the operator look careless or deceptive.

Suggested fix:

Change both English and Korean privacy copy to a scoped statement. Example: "Standard gallery and photo pages exclude GPS coordinates. The public Map page can display coordinates for categories an admin explicitly marks as Show on Map. Disable map visibility or enable GPS stripping before upload if locations should stay private." Consider linking to `/map` only when marker count is non-zero, but do not make the disclosure depend on analytics.

### PMR-C11-02 - Footer hides the privacy page unless Google Analytics is configured

Severity: Medium
Confidence: High
Classification: Confirmed trust/disclosure discoverability issue

Exact regions:

- `apps/web/src/components/footer.tsx:6` computes `hasGoogleAnalytics` from `siteConfig.google_analytics_id`.
- `apps/web/src/components/footer.tsx:44-48` renders the Privacy link only inside `{hasGoogleAnalytics && (...)}`.
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx:21-28` shows the page discloses both analytics and photo metadata behavior, not analytics alone.
- `apps/web/messages/en.json:773-781` and `apps/web/messages/ko.json:773-781` include metadata/GPS disclosure copy that remains relevant when GA is disabled.
- `apps/web/src/site-config.json:10` and `apps/web/src/site-config.example.json:10` default `google_analytics_id` to an empty string, so the default public footer hides Privacy.

Why this is a problem:

The footer treats privacy as an analytics-only disclosure. In the actual product, privacy also covers processed derivatives, public metadata, GPS stripping, and the public map boundary. On the default self-hosted install, visitors see GitHub and Admin footer links but no Privacy link, even though the site may still publish photo metadata and opted-in GPS map markers.

Concrete failure scenario:

An operator leaves Google Analytics disabled, enables map visibility for a topic, and shares the site. Visitors have no footer path to the only page that explains metadata behavior. If a visitor later discovers GPS markers, the absence of an obvious privacy link compounds the trust issue from PMR-C11-01.

Suggested fix:

Always render the Privacy link in the public footer. If the goal is to avoid a dead analytics notice on default installs, keep the existing dynamic analytics paragraph inside the page, but do not hide the entire route. A stronger fix is to rename the section to "Privacy and Metadata" in footer/UI copy if the product wants to emphasize that it is broader than GA.

### PMR-C11-03 - Bulk editor claims AI-suggested alt text, but implementation is an EXIF stub

Severity: Medium
Confidence: High
Classification: Confirmed AI/message honesty issue

Exact regions:

- `apps/web/messages/en.json:233-234` says "Apply suggested alt text" and "Copies AI-suggested alt text..."
- `apps/web/messages/ko.json:233-234` says the same in Korean: "AI가 제안한..."
- `apps/web/src/components/bulk-edit-dialog.tsx:241-257` renders the bulk apply control and hint.
- `apps/web/src/lib/caption-generator.ts:1-18` states the caption generator is a stub and Florence-2 ONNX inference is deferred.
- `apps/web/src/lib/caption-generator.ts:33-43` generates deterministic EXIF-derived strings such as "Photo taken with {camera_model}".
- `apps/web/src/lib/caption-generator.ts:54-64` returns that stub when auto alt text is enabled.
- `apps/web/messages/en.json:721-724` correctly says auto alt text creates EXIF-derived placeholders and real model-generated descriptions are future work.
- `apps/web/messages/ko.json:721-724` correctly says the same in Korean.
- `apps/web/src/app/actions/images.ts:1058-1107` copies `alt_text_suggested` into title or description without adding any model inference step.

Why this is a problem:

The settings page is honest, but the bulk editor is not. "AI-suggested" is a material product claim. In this repo, auto alt text is an EXIF-derived placeholder, not a vision model result. This matters because GalleryKit also has a real CLIP semantic-search implementation; loose AI wording in a separate admin flow weakens trust in the real AI claim.

Concrete failure scenario:

An admin enables Auto Alt-Text, bulk-applies "AI-suggested" text into titles/descriptions, and publishes generic captions like "Photo taken with Canon EOS R5" believing a model inspected the image content. The published gallery looks low-quality and the operator loses confidence in GalleryKit's AI features.

Suggested fix:

Change the bulk hint in both locales to "Copies EXIF-derived suggested alt text..." until real inference ships. If real Florence-2 support is added later, update the settings and bulk copy together and include a model/version disclosure.

## Risk Findings

### PMR-C11-RISK-01 - README "batch editing" wording can imply photo editing despite the product boundary

Severity: Medium
Confidence: Medium
Classification: Risk, not a confirmed false claim

Exact regions:

- `README.md:40` markets the Admin Dashboard with "batch editing."
- `CLAUDE.md:260` defines the product premise: photos arrive after editing and no edit, culling, or scoring features ship.
- `apps/web/src/lib/bulk-edit-types.ts:1-19` scopes bulk editing to metadata fields: topic, title, description, tag add/remove, and suggested alt text copy.
- `apps/web/src/app/actions/images.ts:949-1112` implements `bulkUpdateImages()` for topic/title/description/tag/alt-text metadata only.
- `apps/web/messages/en.json:218-237` labels the UI "Bulk edit" but the description says only toggled fields, tags, and suggested alt text are changed.

Why this is a problem:

"Batch editing" is common photography language for editing images, presets, exposure, color, crops, or culling decisions. In GalleryKit, the feature is batch metadata management. The README does not explicitly say metadata, so a prospective operator could misread the feature list as violating GalleryKit's own no-editing boundary.

Concrete failure scenario:

A photographer evaluating GalleryKit sees "batch editing" and expects photo-editing workflow features. They install it, find only metadata bulk updates, and conclude the README overpromised. The product did not ship a forbidden feature, but the wording makes the boundary less clear than the implementation.

Suggested fix:

Change `README.md:40` from "batch editing" to "batch metadata editing" or "batch title, description, category, and tag updates." Consider adding a short README note near the feature list: "GalleryKit is a publishing/gallery tool, not an editor, culler, or scoring system."

## Aligned / No Action Checks

### PMR-C11-OK-01 - Payment surfaces are not marketed

Evidence:

- `rg` over current `README.md`, `apps/web/messages`, and `apps/web/src` found no live Stripe, checkout, pricing, billing, or paid-download product surface outside historical comments and tests.
- `README.md:201-203` presents the repository license, not a monetized gallery feature.

Assessment: No overclaim found. This respects the project ban on reintroducing payment surfaces without a product decision.

### PMR-C11-OK-02 - Lightroom token page now avoids claiming a bundled plugin

Evidence:

- `apps/web/messages/en.json:800-805` labels the page "Upload API Tokens" and says GalleryKit does not bundle or distribute a Lightroom Classic plugin.
- `apps/web/src/app/api/admin/lr/upload/route.ts:5-8` similarly states the server route does not distribute a Lightroom plugin.
- `apps/web/src/lib/admin-tokens.ts:3-24` defines token mechanics and scopes; the UI copy does not claim a full client distribution.

Assessment: No current product-marketing issue found in the token page copy.

### PMR-C11-OK-03 - Semantic search copy is mostly honest

Evidence:

- `README.md:37` says semantic search is self-hosted, operator-enabled, disabled by default, requires model download/backfill/env opt-in, and is live on the demo.
- `apps/web/messages/en.json:725-728` explains stub mode is not meaningful and production mode is operator-gated.
- `apps/web/messages/ko.json:725-728` mirrors the same warning.
- `CLAUDE.md:151` says the code default is disabled and production mode requires the env gate plus production DB row.

Assessment: No issue in the reviewed local copy. I did not use the live demo as implementation evidence for this artifact.

### PMR-C11-OK-04 - Backup and restore copy does not overpromise full-site rollback

Evidence:

- `apps/web/messages/en.json:18-24` says backups are database rows only and files require host-level backups.
- `CLAUDE.md:208-210` says DB restore does not snapshot or roll back original files, derivatives, or resources.

Assessment: No actionable marketing mismatch found.

### PMR-C11-OK-05 - Admin power/RBAC claims are honest

Evidence:

- `README.md:40` says there are multiple root-admin accounts with no role separation yet.
- `CLAUDE.md:5` says authentication only, no role/capability separation yet.
- `CLAUDE.md:228` says any admin can upload, edit metadata, export/restore DB backups, change settings, and manage admins.
- `apps/web/messages/en.json:49-50` warns that new admins are full-access root admins.

Assessment: No overclaim found.

## Positioning Notes

GalleryKit's defensible position is: self-hosted photo publishing for photographers who care about color-faithful delivery, private originals, and owning the publishing stack. The strongest marketing assets are implementation-backed: color pipeline detail, private original storage, GPS controls, SQL-only restore honesty, root-admin honesty, and operator-gated semantic search. The product should avoid vague "AI" or "editing" language because the implementation is strongest when it is precise.

Recommended one-sentence positioning:

> GalleryKit is a self-hosted photo gallery for photographers who want color-faithful web delivery, private originals, and control over the full publishing stack.

## Verification Notes

No production code was edited. This report is the only file intentionally changed. I did not run the full lint/typecheck/test suite because this was a review artifact task; verification consisted of source/docs inventory, line-level claim checks, i18n key parity check, and targeted repository searches.
