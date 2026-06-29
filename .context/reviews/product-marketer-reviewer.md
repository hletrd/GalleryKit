# Product Marketer Review - Cycle 5

Date: 2026-06-29
Reviewer: product-marketer-reviewer
HEAD reviewed: `a8aef8d0a418e251915e44c2eacf4bbd255870e1`
Repository: GalleryKit
Scope: product-positioning, documentation, market-communication, photographer trust messaging, claims vs implemented behavior, deployment docs, admin settings, public pages, and product boundaries. The BurstPick-specific installed prompt was not applied; only the product-marketer-reviewer lens was adapted to GalleryKit.
Edit scope: only `.context/reviews/product-marketer-reviewer.md` was changed.

## Executive Summary

Finding count: 2

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 0 |

GalleryKit's current public positioning is largely code-backed: the README presents a self-hosted photographer gallery, semantic search is clearly operator-gated, storage is documented as local filesystem only, deploy docs describe the single-writer host-network shape, and CLAUDE.md explicitly preserves the "no edit / culling / scoring" and "free / no payments" boundaries. The two product-communication risks are both admin-trust copy mismatches: the GPS privacy toggle understates what the product now does to retained originals, and the auto-alt-text settings copy implies a Florence-2 model requirement even though the current implementation is an EXIF-derived stub.

## Inventory

Relevant docs and product/UI files inspected before judging findings:

- Required context: `AGENTS.md`, `CLAUDE.md`.
- Public docs/config: `README.md`, `apps/web/README.md`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, root/app `package.json`.
- Localized product/admin copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Admin product surfaces: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `seo/seo-client.tsx`, `users/page.tsx`, `tokens/tokens-client.tsx`, `db/page.tsx`, `dashboard/*`, `apps/web/src/components/image-manager.tsx`, `bulk-edit-dialog.tsx`.
- Public pages/components: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `apps/web/src/components/search.tsx`, `similar-photos.tsx`, `footer.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`.
- Claim implementation checks: `apps/web/src/app/actions/settings.ts`, `images.ts`, `apps/web/src/lib/gallery-config*.ts`, `process-image.ts`, `gps-exif-strip.ts`, `data.ts`, `caption-generator.ts`, `image-queue.ts`, semantic search API routes, storage quarantine tests, free-download contract tests, PWA service worker files.
- Product boundary searches: BurstPick references, payment/Stripe/entitlement surfaces, S3/MinIO/storage claims, edit/cull/scoring/rating language, semantic-search scan/gate behavior, public GPS exposure, and deploy/proxy claims.

## Findings

### PM-C5-01 - GPS privacy copy says source EXIF is untouched, but enabled uploads now scrub retained originals

Severity: Medium
Confidence: High
Status: Confirmed

Exact regions:

- `apps/web/messages/en.json:701-704` labels the privacy section and says: "New uploads won't store GPS in gallery metadata. Existing images and source EXIF aren't touched."
- `apps/web/messages/ko.json:701-704` carries the same promise in Korean: "새 업로드는 갤러리 메타데이터에 GPS를 저장하지 않습니다. 기존 이미지와 원본 EXIF는 그대로 둡니다."
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:543-568` renders that copy beside the `strip_gps_on_upload` switch.
- `apps/web/src/app/actions/images.ts:333-343` does the real upload behavior: it nulls DB `latitude` / `longitude` and calls `stripGpsFromOriginal(...)` on the saved original when the setting is enabled.
- `apps/web/src/lib/process-image.ts:1600-1639` documents the current retained-original scrubber: lossless GPS neutralization for JPEG/TIFF/HEIF/AVIF/HEIC/WebP, metadata-free re-encode fallback for some formats, and best-effort failure logging.
- `CLAUDE.md:218` also states the correct current product contract: `strip_gps_on_upload` scrubs the on-disk original, not just gallery metadata.

Why this is a problem:

This is a photographer-trust and consent mismatch. The UI tells the operator that source EXIF is not touched, but the product intentionally modifies the retained original's GPS-bearing metadata when the privacy toggle is enabled. The implementation is directionally privacy-positive, but the admin copy now misstates the preservation contract.

Concrete failure scenario:

A photographer enables the toggle expecting only GalleryKit's database/public metadata to omit GPS while preserving upload originals byte-for-byte for later admin download or archive use. Later they download an original and find GPS EXIF removed or, on a fallback path, rewritten without metadata. Even though the privacy outcome is safer, the product violated the stated "source EXIF isn't touched" expectation.

Concrete fix:

Update both locale strings to distinguish existing images from future uploads and disclose retained-original behavior. Example: "New uploads won't store GPS in gallery metadata. When possible, GalleryKit also removes GPS metadata from the retained original; existing images are not changed." Korean copy should carry the same nuance. If best-effort failures remain possible, mention that server logs record failures rather than promising absolute removal.

### PM-C5-02 - Auto alt-text settings copy implies Florence-2 model setup, but the shipped feature is an EXIF-derived stub

Severity: Medium
Confidence: High
Status: Confirmed

Exact regions:

- `apps/web/messages/en.json:712-715` says GalleryKit will "Generate AI alt-text suggestions using a local Florence-2 model" and that enabling it "Requires the Florence-2 ONNX model (stub active)."
- `apps/web/messages/ko.json:712-715` mirrors that Florence-2/model-requirement framing.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:604-628` renders this as a real admin setting.
- `apps/web/src/lib/caption-generator.ts:1-18` states the actual implementation is a stub and that real Florence-2 ONNX inference, weights, and download script are deferred.
- `apps/web/src/lib/caption-generator.ts:33-64` generates only deterministic EXIF-derived text such as `[AUTO] Photo taken with Canon EOS R5`; no model is loaded and no vision inference runs.
- `apps/web/src/lib/image-queue.ts:470-488` stores this generated caption after processing when `auto_alt_text_enabled` is true.
- `apps/web/src/components/bulk-edit-dialog.tsx:241-258` and `apps/web/src/app/actions/images.ts:1027-1063` expose/copy these suggestions into title or description, so the stub output can become user-visible metadata.

Why this is a problem:

The copy simultaneously says "local Florence-2 model" and "stub active", then tells admins a Florence-2 ONNX model is required. Code reality is simpler: no model is required today, and the output is not AI vision captioning. That ambiguity can cause operators to waste setup time, overestimate caption quality, or believe GalleryKit is already doing image-understanding work it does not do.

Concrete failure scenario:

An operator turns on Auto Alt-Text after reading "Requires the Florence-2 ONNX model", searches deployment docs for a Florence-2 seeding flow, finds none, and assumes the install is incomplete. Alternatively, they enable it expecting actual image captions and bulk-copy `[AUTO] Photo taken with ...` camera-derived hints into public titles/descriptions, weakening public accessibility/SEO copy under an "AI suggested" label.

Concrete fix:

Reword the setting to the current product truth: "Generate EXIF-derived alt-text placeholders (stub; no vision model runs yet)" and "When enabled, stores deterministic hints after processing. Real Florence-2 ONNX captioning is a future feature." Avoid saying a Florence-2 model is required until the model download/runtime path exists. Consider renaming "AI-suggested alt text" in bulk-edit copy to "auto-suggested alt text" while the producer remains a stub.

## Source-Backed Non-Findings

- No BurstPick assumptions found in repo product surfaces. The review treated GalleryKit as a self-hosted photographer gallery.
- Self-hosting/local-storage positioning is honest: `README.md:7-9` and `apps/web/src/site-config.json:2-9` present GalleryKit as self-hosted; `CLAUDE.md:141` explicitly says the storage abstraction is not a supported S3/MinIO switch; storage quarantine tests prevent accidental product exposure.
- Payment boundary is preserved: `CLAUDE.md:553` says paid downloads/Stripe were removed and must not be re-added; current searches found no checkout/entitlement product surfaces, and free-download contract tests guard the viewer download path.
- No edit/culling/scoring product promise leak was found. `CLAUDE.md:257-259` states photos arrive after editing and no edit/culling/scoring features ship. The remaining "score" fields are semantic-search ranking internals in API types, not user-facing scoring/culling claims.
- Semantic search claims are generally honest: `README.md:37` calls it self-hosted/operator-enabled and disabled by default; `apps/web/README.md:53-73` documents weights/backfill/env/DB activation; `gallery-config.ts:126-145` heals production to disabled without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`; `search.tsx:434-469` shows the toggle only when mode is not disabled and warns in stub mode; `similar-photos.tsx:98-101` hides similar photos unless production mode is active.
- PWA claim is backed by implementation: `apps/web/package.json:10` builds icons/service worker before build, and `apps/web/public/sw.template.js` / `sw.js` implement image stale-while-revalidate plus HTML offline fallback behavior.
- Admin root-account messaging is consistent: `README.md:40` says multiple root admins with no role separation; `apps/web/messages/en.json:46-50` warns new admins are full-access root admins; `CLAUDE.md:227` confirms there is no role/capability model.
- Deployment docs are aligned with the current single-writer posture: `README.md:145-151`, `README.md:168-186`, `apps/web/README.md:41-49`, and `CLAUDE.md:226` all warn about production URL validation, proxy trust, host-network deployment, and not scaling web horizontally without shared coordination state.

## Final Sweep

Final sweep covered README/app README, CLAUDE, site config, admin settings/SEO/users/tokens/DB/dashboard copy, public search/similar/color/share pages, PWA files, semantic routes, upload/GPS/RAW/HDR behavior, storage/payment/product-boundary searches, and current test contracts. No additional product-marketing findings were promoted beyond PM-C5-01 and PM-C5-02.
