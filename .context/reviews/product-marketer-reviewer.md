# Product Marketer Review - Cycle 3

Date: 2026-06-29
Reviewer: product-marketer-reviewer
Repository: GalleryKit
Scope: product-facing positioning, operator documentation, public UI metadata/copy, deployment documentation, and source-backed claims. This review used full-surface inventory, not sampling.

## Executive Summary

Finding count: 1

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |

The current GalleryKit positioning is mostly source-backed: it describes a self-hosted, local-filesystem photo gallery with no payment surface, operator-gated semantic search, cautious color/HDR handling, Lightroom PAT uploads, and no edit/culling/scoring product promise. One public UX claim remains materially misleading: the upload picker accepts formats the deployed image pipeline does not reliably decode.

## Inventory

Reviewed claim surfaces:

- `README.md:1-205` - product positioning, features, quick start, deployment, stack.
- `apps/web/README.md:1-73` - app-local development and semantic search operator notes.
- `site-config.json:1-10` and `site-config.example.json:1-10` - public site metadata.
- `scripts/deploy-remote.sh:1-132`, `.env.deploy.example:1-50`, `apps/web/README.md:20-47`, `README.md:106-186` - deploy/operator requirements.
- `apps/web/messages/en.json:1-867`, `apps/web/messages/ko.json:1-867` - public and admin UI copy.
- `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/**`, `apps/web/scripts/**`, `apps/web/drizzle/**`, `apps/web/src/__tests__/**` - implementation-backed product claims.
- `.context/reviews/**` and `.context/plans/**` - review history used to avoid re-reporting stale fixed claims.

## Source-Backed Claim Checks

| Claim area | Status | Evidence |
| --- | --- | --- |
| Supported storage | Confirmed | README presents GalleryKit as self-hosted/local. `CLAUDE.md:140` states only local filesystem is production-supported. `apps/web/src/lib/storage/index.ts:1-12` says the abstraction is not wired into the live pipeline, and `StorageBackendType` is only `'local'` at `apps/web/src/lib/storage/index.ts:25`. |
| Pricing/payment absence | Confirmed | No active Stripe/payment dependency or route was found in app source. `apps/web/drizzle/0023_remove_paid_downloads.sql:1-19` removes paid downloads, entitlements, Stripe config, and `license_tier`. `apps/web/src/__tests__/free-download-contract.test.ts` guards the free-download contract. |
| Semantic search status | Confirmed | README says semantic search is self-hosted, disabled by default, and operator-enabled at `README.md:37`. Defaults set `semantic_search_mode` to disabled at `apps/web/src/lib/gallery-config-shared.ts:102-103`; production is forced off unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` at `apps/web/src/lib/gallery-config.ts:126-145`. Real CLIP loading is in `apps/web/src/lib/clip-model.ts:1-15` and requires local weights through `CLIP_MODELS_ROOT` at `apps/web/src/lib/clip-model.ts:81-99`. |
| Color/HDR claims | Confirmed | README's cautious color/HDR claim at `README.md:33` matches code. HDR ingest defaults false at `apps/web/src/lib/gallery-config-shared.ts:108-109`; uploads reject HDR unless enabled at `apps/web/src/app/actions/images.ts:304-315`; public HDR delivery is described as SDR in `apps/web/messages/en.json:354-356`; admin-only HDR badges are gated in `apps/web/src/components/lightbox-color-pip.tsx:43-83` and `apps/web/src/components/color-details-section.tsx:144-157`. |
| Lightroom plugin/PAT claims | Confirmed | PAT format and scopes are implemented in `apps/web/src/lib/admin-tokens.ts:19-25`; header auth uses `x-gallerykit-token` in `apps/web/src/lib/api-auth.ts:14-28`; Lightroom upload route requires `lr:upload` at `apps/web/src/app/api/admin/lr/upload/route.ts:1-17` and `apps/web/src/app/api/admin/lr/upload/route.ts:504`. |
| Deployment requirements | Confirmed | README requires Node 24, npm, and MySQL 8 at `README.md:83-88`. Docker and image env requirements are documented at `README.md:168-186`. The previously stale deploy-env mismatch is fixed: `scripts/deploy-remote.sh:22-29` accepts root `.env.deploy` when present, and `scripts/deploy-remote.sh:55-58` documents both root and home-secret paths. |
| Image processing limits | One confirmed mismatch | Limit claims match code for size/count: `README.md:145-151` and `apps/web/src/lib/upload-limits.ts:1-4`. Format support is the confirmed issue below. |
| No edit/culling/scoring policy | Confirmed | `AGENTS.md` states "No edit / culling / scoring features." No active product copy promises editing, culling, or scoring; upload/image code preserves metadata and derived display assets rather than scoring or culling selections. |

## Findings

### PM-C3-01 - Upload UI accepts formats the deployed image pipeline rejects

Severity: Medium
Confidence: High
Risk type: Confirmed

Evidence:

- `apps/web/src/components/upload-dropzone.tsx:175-177` advertises accepted upload inputs through `react-dropzone` as `image/*` plus `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.heic`, `.heif`, `.tif`, `.tiff`, `.gif`, `.bmp`, and `.arw`.
- `apps/web/src/lib/process-image.ts:385-404` lists some of those as allowed extensions but separately classifies RAW extensions, including `.arw`, as unsupported raw inputs.
- `apps/web/src/lib/process-image.ts:444-461` throws `RawFileError` for RAW inputs and only performs extension-level validation for non-RAW formats.
- `apps/web/src/lib/process-image.ts:879-887` then relies on Sharp metadata decode and returns an invalid-image failure for files the runtime cannot decode.
- Runtime validation of the installed Sharp build shows `heif` input suffixes include `.avif` only, `dcraw` file input is unavailable, `raw` file input is unavailable, and there is no BMP file suffix input. That means `.heic`, `.heif`, `.bmp`, and `.arw` can pass the picker contract but fail in the processing pipeline.
- Current English error copy acknowledges RAW is unsupported at `apps/web/messages/en.json:560-561`, but the picker still invites at least `.arw`; HEIC/HEIF/BMP failures are likely surfaced as generic invalid image errors.

Failure scenario:

A photographer sees the upload dialog accept iPhone `.heic` originals, BMP exports, or Lightroom/source `.arw` RAW files, selects them successfully, and only learns after upload submission that GalleryKit cannot process them in the deployed pipeline. This makes the product appear to support a broader ingest matrix than it actually does and creates a poor first-run operator experience.

Concrete fix:

Align the public picker contract with the server/runtime contract. The simplest fix is to remove `.arw`, `.heic`, `.heif`, and `.bmp` from `upload-dropzone.tsx` unless the app detects a Sharp/libvips build that can decode them, and to keep the user-facing accepted-format copy limited to JPEG, PNG, WebP, AVIF, TIFF, and GIF. If HEIC/BMP support is intentionally desired, add an explicit runtime capability gate plus localized unsupported-format messages before advertising those extensions.

## Stale History Not Re-Reported

- The older deploy-helper mismatch is not current. `scripts/deploy-remote.sh:22-29` now supports root `.env.deploy`, and `scripts/deploy-remote.sh:55-58` explains both supported env-file locations.
- Older paid-download/Stripe claims are not current product defects. The app source has no active payment surface, and `apps/web/drizzle/0023_remove_paid_downloads.sql:1-19` plus free-download tests preserve the free OSS contract.
- Older semantic-search underclaim/overclaim concerns are not current. README and admin copy now state that real CLIP is operator-gated, disabled by default, and not bundled into the image.

## Manual-Validation Risks

- Live demo availability and any externally hosted marketing page outside this repository were not validated from production. This artifact verifies repository-backed claims only.
- The exact browser-native file-picker behavior can vary by OS and browser, but the advertised extension list and server/runtime mismatch are source-confirmed.

## Final Missed-Issues Sweep

Ran a final cross-check across README, app README, deploy scripts, site config, i18n messages, storage/payment/search/color/LR/upload source files, tests, and `.context` history. No additional product-facing claim defects were found beyond PM-C3-01.
