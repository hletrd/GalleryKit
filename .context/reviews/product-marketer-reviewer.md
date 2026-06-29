# Product Marketer Review - Cycle 4

Date: 2026-06-29
Reviewer: product-marketer-reviewer
HEAD reviewed: `10b500bb30399f7c66812a5ad899f070f88d5501`
Repository: GalleryKit
Scope: product-facing copy, positioning consistency, public UX expectations, docs/user-promise mismatches, SEO/OpenGraph/feed presentation, and product-surface confusion risks. No application code was edited.

## Executive Summary

Finding count: 1

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |

GalleryKit's current product positioning remains mostly source-backed: it is presented as a self-hosted photo gallery, not a marketing site, and its README/admin copy is generally honest about semantic search being operator-gated, HDR delivery being SDR-only today, storage being local, and the absence of paid-download/product-commerce surfaces. The remaining product-facing issue is an ingest-contract copy mismatch: the RAW rejection message still recommends HEIF as a safe export target even though the current picker no longer advertises HEIF and the installed Sharp build only exposes HEIF-family input for `.avif`.

## Inventory

Relevant product-facing inventory inspected:

- Required context: `AGENTS.md`, `CLAUDE.md`, `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`.
- Public/docs surfaces: `README.md`, `apps/web/README.md`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`.
- Localized copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Public metadata/SEO routes: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `c/[slug]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `map/page.tsx`, `sitemap.ts`, `robots.ts`, `manifest.ts`, `feed.xml/route.ts`, `[topic]/feed.xml/route.ts`.
- OG/feed implementation: `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/atom-feed.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/image-url.ts`.
- Product promise implementation checks: upload/dropzone and server ingest paths, image processing extension gate, RAW/HDR handling, semantic search settings/routes, storage abstraction notes, Lightroom token upload path, auto-alt-text stub surfaces, public search/share routes.
- Prior review history: current `.context/reviews/*.md` plus targeted archived product-marketer/designer/document/security reports, used to avoid carrying fixed or already-filed issues.

## Findings

### PM-C4-01 - RAW rejection copy recommends HEIF even though the current product does not reliably accept HEIF uploads

Severity: Medium
Confidence: High
Status: Confirmed

Exact regions:

- `apps/web/messages/en.json:560-561` tells admins whose RAW uploads were rejected to export to `JPEG, TIFF, AVIF, HEIF, or PNG`.
- `apps/web/messages/ko.json:560-561` gives the same remediation and includes `HEIF`.
- `apps/web/src/app/actions/images.ts:523-560` catches `RawFileError` and returns those localized `rawNotSupported` / `rawRejectedWarning` strings for RAW-only or mixed upload failures.
- `apps/web/src/components/upload-dropzone.tsx:175-177` now advertises only `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.tiff`, `.tif`, and `.gif` in the browser picker.
- `apps/web/src/lib/process-image.ts:385-387` still extension-allows `.heic` / `.heif`, but current runtime evidence from the installed Sharp `0.34.5` build shows `sharp.format.heif.input.fileSuffix` is only `[".avif"]`; `raw.input.file` and ImageMagick input are unavailable. That makes `.heif` / `.heic` an unreliable recommendation in this deployment.

Why this is a problem:

The product gives a concrete recovery path after a failed RAW upload. HEIF is part of that promise, but the visible picker no longer offers HEIF and the current processing runtime does not advertise `.heif` / `.heic` decode support. This is not a marketing-site polish issue; it is a first-run operator trust issue on the upload flow.

Concrete user failure scenario:

A photographer batch-drops RAW files, receives the localized "export to ... HEIF" advice, exports from Lightroom or Photos to `.heif`, then cannot select that file in the picker or gets a generic processing failure if they bypass the picker through drag/drop or integration. The product appears to give authoritative guidance, then rejects the guided format.

Concrete fix:

Remove `HEIF` from `rawNotSupported` and `rawRejectedWarning` in both locales unless HEIF/HEIC decode is made runtime-gated and visible end-to-end. The safe current wording should recommend JPEG, TIFF, AVIF, or PNG. If HEIF is intended as a supported target, derive the dropzone accept list, server extension allowlist, and localized supported-format copy from the actual Sharp runtime capability or a build-time capability check, and add a HEIF-specific unsupported-format message for deployments without that decoder.

## Source-Backed Non-Findings

- The cycle-3 product-marketer finding about the upload picker advertising RAW/HEIC/HEIF/BMP is fixed at current HEAD: `upload-dropzone.tsx:175-177` no longer includes those extensions.
- Semantic search copy is currently honest enough for a self-hosted gallery: README and app README say production CLIP is disabled by default and operator-gated; admin settings expose only Disabled/Stub; runtime heals production to disabled unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.
- Shared photo/group pages intentionally use generic, noindex/noarchive/noimageindex metadata and avoid share-key DB lookup in `generateMetadata`; this is a defensible privacy/security tradeoff, not a product-preview defect.
- Timeline/map/year document-title duplication is already filed in the current designer report, so this pass does not duplicate it.
- README upload/nginx and feed-attribution documentation drift is already filed in the current document-specialist report; this pass did not re-file it.

## Final Sweep

Final sweep covered docs, localized copy, public route metadata, OG cards, feeds, sitemap/robots, share pages, upload error copy, semantic-search honesty, auto-alt-text stub copy, storage/payment promises, and prior review history. No additional product-marketing findings were promoted beyond PM-C4-01.
