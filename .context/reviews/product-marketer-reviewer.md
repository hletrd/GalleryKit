# Product Marketer Review - Cycle 6

Date: 2026-06-29
Reviewer: product-marketer-reviewer
HEAD reviewed: `5443009e`
Repository: GalleryKit
Scope: public positioning, operator documentation, launch/readiness claims, trust signals, public/admin UX copy, and product promises versus current implementation. The original BurstPick-oriented reviewer lens was adapted to GalleryKit as a self-hosted photo gallery.
Edit scope: only `.context/reviews/product-marketer-reviewer.md` was changed.

## Executive Summary

Finding count: 1 confirmed issue, 1 manual-validation risk

| Severity | Confirmed | Likely | Manual-validation risk |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 0 | 0 |
| Low | 1 | 0 | 1 |

GalleryKit's active docs and UI are mostly honest about the product's real boundaries: self-hosted/local storage, multiple root admins with no role separation, database-only backups, operator-gated semantic search, single-web-instance deployment, and SDR delivery for HDR ingest. I found one confirmed public-positioning mismatch: the root README promises 10-bit AVIF for wide-gamut images too absolutely, while the implementation can legitimately fall back to 8-bit AVIF and the in-app color details already disclose that fallback.

## Review-Relevant Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`

Active public/operator docs and config inspected:

- `README.md`
- `apps/web/README.md`
- `apps/web/.env.local.example`
- `.env.deploy.example`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`

Public UX, copy, and product promise surfaces inspected:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- Public route families under `apps/web/src/app/[locale]/(public)/`: topic, collection, shared-photo, shared-group, map, timeline, year, and photo detail pages were included in the file inventory / claim sweep.
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/lib/use-display-capability.ts`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/components/register-service-worker.tsx`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

Admin/operator UX and implementation support inspected:

- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/actions/seo.ts`
- Admin route/component inventory under `apps/web/src/app/[locale]/admin/**`, including dashboard, analytics, categories, tags, users, password, login, and layout files.
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`

Claim-check implementation inspected:

- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/app/actions/public.ts`
- Semantic search routes and components identified in the inventory / copy sweep.
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`

Historical docs searched for active-claim conflicts:

- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

## Confirmed Issues

### PM-C6-01 - README promises 10-bit AVIF for wide-gamut too absolutely

Severity: Low
Confidence: High
Status: Confirmed

Exact regions:

- `README.md:31-33` says: `Multi-Format Optimization -- automatic AVIF (10-bit for wide-gamut), WebP, and JPEG conversion via Sharp pipeline`.
- `CLAUDE.md:283-285` documents the actual contract: 10-bit AVIF is gated on a Sharp/libheif capability probe and falls back to 8-bit if unsupported.
- `apps/web/src/lib/process-image.ts:1194-1203` describes the runtime probe and process-lifetime downgrade when the Sharp build rejects `bitdepth: 10`.
- `apps/web/src/lib/process-image.ts:1203-1215` only sets `avif10bit = true` when a wide-gamut encode asks for high bit depth and succeeds.
- `apps/web/src/lib/process-image.ts:1217-1235` catches per-image 10-bit bitdepth failures and retries with explicit `bitdepth: 8`.
- `apps/web/src/components/color-details-section.tsx:471-497` correctly branches public/admin "Delivered bit depth" copy on `image.avif_10bit`.
- `apps/web/messages/en.json:324-325` and `apps/web/messages/ko.json:324-325` already distinguish "10-bit AVIF" from "8-bit AVIF" fallback in the viewer.

Why this is a problem:

The README is the top-level public/product positioning document. Its feature list reads as if every wide-gamut image automatically receives 10-bit AVIF. Current code is more nuanced and intentionally safer: 10-bit depends on the deployed Sharp/libheif build and can still fail for a specific image. The in-app trust surface is accurate, but the first public promise is not.

Concrete failure scenario:

An operator evaluates GalleryKit for Display P3 photography, reads the README, deploys on a host/image where Sharp rejects 10-bit AVIF, and imports wide-gamut photos. The gallery still works correctly, but Color Details reports `8-bit AVIF (P3)` for those images. From the README promise, the operator reasonably treats this as a broken feature or a misleading quality claim.

Suggested fix:

Reword `README.md:32` to match the product contract. Example: `automatic AVIF/WebP/JPEG conversion via Sharp, with 10-bit AVIF for wide-gamut when the deployed Sharp/libheif stack supports it and an explicit 8-bit fallback when it does not.` A shorter option is: `wide-gamut-aware AVIF/WebP/JPEG conversion with surfaced AVIF bit-depth fallback.`

## Likely Issues

None promoted. The review did not find a second active public/admin/operator promise that likely contradicts implementation.

## Risks Needing Manual Validation

### PM-C6-RISK-01 - Archived CLIP plan has stale production activation wording

Severity: Low
Confidence: Medium
Status: Risk needing manual validation, not a confirmed active-doc issue

Exact regions:

- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:955` says to flip `semantic_search_mode` to `production` in `Admin -> Settings`.
- `apps/web/README.md:64-71` now documents the current operator-only path: seed weights, backfill embeddings, set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, then set the DB row to `production`.
- `apps/web/src/lib/gallery-config.ts:126-145` enforces the current behavior by healing `production` to `disabled` unless the env opt-in is set.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:651-678` intentionally exposes only Disabled/Stub in the admin UI and warns if a stored production value is present.

Why this is a risk:

This appears to be historical implementation-plan material rather than active operator documentation, so I am not counting it as a confirmed product-doc defect. If maintainers or operators use `docs/superpowers/plans/**` as runbooks, though, the stale line sends them to a UI path that no longer exists.

Concrete failure scenario:

An operator following the archived plan tries to enable production semantic search from Admin Settings, cannot find a Production option, and concludes the deploy is missing a feature even though the active app README correctly says production activation is env + DB row gated.

Suggested fix:

Either mark `docs/superpowers/plans/2026-06-15-clip-semantic-search.md` as historical/non-runbook material near the top, or update line 955 to point to the current `apps/web/README.md` operator activation path.

## Source-Backed Non-Findings

- No active BurstPick positioning or copy was found in the reviewed docs, messages, public pages, admin pages, or claim sweeps.
- Semantic search messaging is aligned in active surfaces: `README.md:37` says disabled by default and operator setup required; `apps/web/README.md:53-73` documents weights/backfill/env/DB activation; `apps/web/src/lib/gallery-config.ts:126-145` enforces the env gate; `apps/web/src/components/search.tsx:434-468` shows the semantic toggle only outside disabled mode and warns only for stub; `apps/web/src/components/similar-photos.tsx:47-101` hides similar photos unless production mode is active.
- Database backup/restore copy is honest: `apps/web/messages/en.json:18-23` and `apps/web/messages/ko.json:18-23` say backup/restore covers database rows only and leaves file storage unchanged; `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:136-218` renders that warning around backup/restore actions.
- Admin-account trust copy is aligned: `README.md:40` says multiple root-admin accounts with no role separation, and `apps/web/messages/en.json:46-50` / `apps/web/messages/ko.json:46-50` warn that created admins have full access.
- Storage positioning is not overpromised: the public docs do not claim S3/MinIO support, and `apps/web/src/lib/storage/index.ts:4-12` plus `apps/web/src/lib/storage/types.ts:4-15` explicitly describe the current local-only, not-yet-wired abstraction.
- PWA positioning is backed by implementation: `apps/web/src/app/manifest.ts`, `apps/web/src/components/register-service-worker.tsx`, and `apps/web/public/sw.template.js` / `sw.js` implement install metadata, service-worker registration, stale-while-revalidate image handling, and offline HTML fallback behavior.
- HDR/color honesty is mostly strong: upload warnings say HDR is delivered as SDR, viewer labels distinguish HDR-capable display from SDR delivery, and Color Details exposes delivered bit depth and format/gamut details. The only confirmed color-positioning mismatch is the README's unconditional 10-bit wording above.
- Deployment/runbook messaging matches current constraints: `README.md:145-151`, `apps/web/README.md:41-49`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, and `scripts/deploy-remote.sh` align around real public URLs, proxy trust, request-body limits, host-network deployment, bind-mounted data, and single web-instance/single-writer assumptions.

## Final Missed-Issues Sweep

Final sweep searched active docs, app copy, admin/public route files, components, deployment scripts, storage code, semantic search gates, and historical CLIP docs for: `BurstPick`, launch/readiness language, unsupported storage claims, semantic/CLIP production promises, HDR/wide-gamut/10-bit claims, backup/restore claims, root-admin/role language, destructive-action warnings, S3/MinIO references, and operator setup wording.

Relevant files intentionally not inspected in detail:

- Binary/static media assets, generated build outputs, `node_modules`, `.next`, upload/data directories, and package lock internals.
- Most tests were not read end-to-end; they were used only as supporting contract evidence when directly relevant to product promises.
- Archived `.context/reviews/**` and `.context/plans/**` history was not treated as active product/operator documentation. The current review file itself was overwritten as requested.

No additional confirmed product-marketing/readiness issues were found beyond PM-C6-01.
