# Product Marketer Review - Cycle 9

Date: 2026-06-29
Reviewer: product-marketer-reviewer
Repository: GalleryKit
Scope: README onboarding, positioning accuracy, public/admin feature expectations, semantic-search claims, backup/restore warnings, self-hosting/deploy docs, photographer-intent promises, no-edit/no-scoring rule, and docs/UI claims versus code.

## Executive Summary

GalleryKit's current product story is mostly coherent: it is positioned as a self-hosted, photographer-trust-first gallery with explicit operator controls, honest semantic-search gates, SQL-only backup/restore warnings, and no public promise of unsupported S3/MinIO, paid downloads, RBAC, photo editing, culling, or scoring.

The main trust issue I found is in the Lightroom token surface. The admin UI mints every token with `lr:upload`, `lr:read`, and `lr:delete`, while the codebase currently exposes only the Lightroom upload token route. That creates a future-permission surprise: old tokens will automatically gain read/delete capability if those routes are added later. The same surface supports optional expiry at the server-action/library layer, but the UI offers no expiry field and does not clearly say created tokens are non-expiring unless revoked.

Finding count: 1 confirmed issue, 1 likely issue, 1 manual-validation risk, 7 false positives/already-fixed checks.

| Severity | Confirmed | Likely | Manual-validation risk |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 1 | 0 | 0 |
| Low | 0 | 1 | 1 |

## Prompt/Context Notes

- Required repo context read first: `AGENTS.md`, `CLAUDE.md`.
- The installed product-marketer prompt was for another product, so this review used only its market/product/documentation critique stance and applied it to GalleryKit's actual docs, UI, and implementation.
- No source code or plan files were edited. This report is the only intended artifact.

## Review-Relevant Inventory

Docs, repo metadata, and operator files inspected:

- `README.md`
- `apps/web/README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `.env.deploy.example`
- `apps/web/.env.local.example`
- `apps/web/src/site-config.example.json`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

Public/admin UX and copy surfaces inspected:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/app/[locale]/admin/(protected)/**`
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
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-user-manager.tsx`

Implementation claim checks inspected:

- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/__tests__/storage-quarantine.test.ts`
- `apps/web/src/__tests__/search-disclaimer.test.ts`
- `apps/web/src/__tests__/similar-route.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`

## Confirmed Issues

### PMR-C9-01 - Lightroom token UI grants unimplemented future scopes and obscures non-expiring default

Severity: Medium
Confidence: High
Classification: Confirmed product/trust defect

Exact regions:

- `apps/web/messages/en.json:781-806` defines the Lightroom token copy. `apps/web/messages/en.json:791` tells admins: "Scopes lr:upload, lr:read, lr:delete are granted automatically."
- `apps/web/messages/ko.json:831-856` mirrors the same Korean copy. `apps/web/messages/ko.json:841` says the same three permissions are automatically granted.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61` calls `createLrToken({ label, scopes: ['lr:upload', 'lr:read', 'lr:delete'] })` with no user choice.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:128-137` displays an expiry only when `token.expiresAt` exists, but there is no "never expires" label for tokens without expiry.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:154-181` renders only a label field and create/cancel controls. There is no scope selector and no expiry input.
- `apps/web/src/app/actions/lr-tokens.ts:28-32` accepts `scopes` and optional `expiresAt`; `apps/web/src/app/actions/lr-tokens.ts:75-85` validates expiry only when supplied; `apps/web/src/app/actions/lr-tokens.ts:88-93` passes `expiresAt` through as `null` when omitted.
- `apps/web/src/lib/admin-tokens.ts:24-25` defines all available token scopes as `lr:upload`, `lr:read`, and `lr:delete`.
- `apps/web/src/lib/api-auth.ts:21-34` and `apps/web/src/lib/api-auth.ts:68-95` enforce route-specific token scopes when a route opts into `allowTokenScope`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:1-7` documents the Lightroom upload token path, and `apps/web/src/app/api/admin/lr/upload/route.ts:527` opts into only `{ allowTokenScope: 'lr:upload' }`.
- A repo search for `allowTokenScope|lr:read|lr:delete|lr:upload` found no non-test `lr:read` or `lr:delete` route. The only current route using token auth is the upload route.
- `CLAUDE.md:152` describes the broader token model and optional expiry, but the active admin UI currently exposes neither scope choice nor expiry choice.

Why this is a problem:

The UI trains admins to accept three automatic permissions for a token whose only implemented integration need is upload. That weakens the least-privilege story and creates a deferred authorization surprise. If future Lightroom read/delete routes are added using the already-defined `lr:read` or `lr:delete` scopes, every token minted today will silently receive those new powers because the UI has already granted them.

The expiry posture is also unclear. The server supports optional expiry, but the UI does not expose it and creates non-expiring tokens by default. The list only shows an expiry when one exists, so an admin may not realize "blank expiry" means "valid until revoked."

Concrete failure scenario:

An operator creates a Lightroom token in 2026 for one machine to publish uploads only. In a later release, GalleryKit adds `/api/admin/lr/delete` guarded by `allowTokenScope: 'lr:delete'`. The old token already carries `lr:delete`, so the old Lightroom credential can delete photos without the operator ever making a new access decision.

Suggested fix:

Until read/delete endpoints and a real scope picker exist, mint only `['lr:upload']` from the admin UI and change the copy to "Upload access only." Also show explicit lifetime copy such as "Never expires; revoke to disable" for tokens without `expiresAt`.

If the product intends to keep all three scopes, add visible scope checkboxes and an expiry field before creation, default to upload-only, and add regression tests that the UI either mints only implemented scopes or requires an explicit admin choice for every granted scope.

## Likely Issues

### PMR-C9-02 - Deploy env-file docs present two competing defaults

Severity: Low
Confidence: Medium
Classification: Likely documentation consistency issue

Exact regions:

- `README.md:106-116` tells operators to keep target SSH config in a gitignored root `.env.deploy`, then run `cp .env.deploy.example .env.deploy`.
- `CLAUDE.md:648-657` repeats that the repo-level deploy helper reads a gitignored root `.env.deploy` by default.
- `.env.deploy.example:1-4` instead says to copy the file outside the repository, with a default path of `~/.gallerykit-secrets/gallery-deploy.env`.
- `scripts/deploy-remote.sh:22-29` implements both behaviors: `DEPLOY_ENV_FILE` wins, then root `.env.deploy` if it exists, otherwise `~/.gallerykit-secrets/gallery-deploy.env`.
- `scripts/deploy-remote.sh:55-58` also tells operators either `.env.deploy` or the external default path is acceptable.

Why this is a problem:

Both locations work, but the docs disagree about which path is the normal path. For a self-hosted deploy helper that stores SSH host/user/key settings, path ambiguity is a trust and onboarding issue: operators may wonder whether they followed the supported runbook, whether their deploy automation will pick up the expected file, or whether the root README is stale.

Concrete failure scenario:

An operator follows `.env.deploy.example` and stores secrets under `~/.gallerykit-secrets/gallery-deploy.env`. Later they return to `README.md:106-116`, which says the config should live in root `.env.deploy`. They create a second file with different values or debug the wrong file when `npm run deploy` uses the root file preferentially.

Suggested fix:

Pick one canonical recommendation and make all three surfaces match. For example: "Recommended: root `.env.deploy` for this repo; advanced/external path: set `DEPLOY_ENV_FILE` or use the fallback `~/.gallerykit-secrets/gallery-deploy.env`." If the external path is preferred for secret hygiene, update `README.md` and `CLAUDE.md` to make that the primary path and document root `.env.deploy` as a convenience override.

## Risks Needing Manual Validation

### PMR-C9-RISK-01 - Live demo semantic-search claim cannot be proven from repo state alone

Severity: Low
Confidence: Medium
Classification: Manual validation risk, not a confirmed repo defect

Exact regions:

- `README.md:37` says semantic search is disabled by default and requires setup, then says it is live on the demo at `https://gallery.atik.kr`.
- `apps/web/README.md:53-73` documents the operator-only production path: seed model weights, backfill, set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, and set `admin_settings.semantic_search_mode='production'`.
- `CLAUDE.md:151` records that the real production deployment is intentionally activated with a production DB row, env opt-in, and real embeddings.
- `apps/web/src/lib/gallery-config.ts:123-142` heals stored `production` mode to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.
- `apps/web/src/app/api/search/semantic/route.ts:156-176` serves only `stub` or `production`; `apps/web/src/app/api/search/semantic/route.ts:242-260` filters by active `model_version` and returns 503 when production has no rows.
- `apps/web/src/app/api/search/similar/[id]/route.ts:97-113` serves similar photos only in production semantic mode.

Why this remains a manual validation risk:

The repo documents the conditions correctly and the code gates are honest, but the current runtime state of the public demo cannot be proven from committed files. The demo claim should be periodically smoke-tested against the deployed site after deploys or DB restores.

Concrete failure scenario:

The demo loses the env opt-in, model bind mount, or production embedding rows after a host migration. The README still claims "Live on the demo", but visitors see semantic search disabled or similar-photo panels absent.

Suggested validation:

Add a release checklist or smoke script that verifies the deployed demo has `semanticSearchMode === 'production'`, at least one active `jina-clip-v2-d512-q8` embedding row, semantic query returns results for a known term, and similar photos returns non-503 for a known embedded image.

## False Positives / Already Fixed

### PMR-C9-FP-01 - Fresh-install upload onboarding is already fixed

Severity: None
Confidence: High
Classification: False positive/already fixed

Exact regions:

- `README.md:100-104` now tells the operator to create a category before uploading one photo.
- `apps/web/README.md:17-21` now repeats the category-before-upload instruction.
- `apps/web/src/components/upload-dropzone.tsx:347-357` still correctly blocks upload when no category exists and links the admin toward category creation.

Failure scenario avoided:

A fresh evaluator no longer follows the README straight into a disabled upload control without knowing the category prerequisite.

Suggested fix:

None for current docs.

### PMR-C9-FP-02 - Semantic search is described with appropriate setup and honesty gates

Severity: None
Confidence: High
Classification: Already fixed/aligned

Exact regions:

- `README.md:37` says semantic search is self-hosted, operator-enabled, disabled by default, and requires model download/backfill/env opt-in.
- `apps/web/README.md:53-73` documents model, modes, offline weights, production honesty gate, bounded scan, and operator-only activation.
- `apps/web/src/lib/gallery-config.ts:64-69` documents the disabled/stub/production contract, and `apps/web/src/lib/gallery-config.ts:123-142` enforces the production env gate.
- `apps/web/src/app/api/search/semantic/route.ts:156-176` rejects disabled mode and uses real production embedding only in production mode.
- `apps/web/src/app/api/search/semantic/route.ts:242-260` filters rows by active model version and returns 503 when production rows are missing.
- `apps/web/src/app/api/search/similar/[id]/route.ts:97-113` gates similar photos to production mode.

Failure scenario avoided:

Fresh installs are not marketed as having one-click production AI search, and production mode does not serve stub rows under a production label.

Suggested fix:

None. Keep the setup caveats near any future marketing or demo copy.

### PMR-C9-FP-03 - Backup/restore warnings accurately say SQL-only and file storage unchanged

Severity: None
Confidence: High
Classification: Already fixed/aligned

Exact regions:

- `apps/web/messages/en.json:16-24` says backups are database rows only and files under originals/uploads/resources require host-level backups.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:144-175` renders the backup/restore descriptions in the admin DB page.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:199-230` adds danger-zone and confirmation copy before restore.
- `CLAUDE.md:208-210` repeats that admin DB backup/restore is SQL-only and does not snapshot or roll back host files.

Failure scenario avoided:

An operator is not led to believe an SQL restore will recover originals, derivatives, resources, or upload files.

Suggested fix:

None for the admin UI. A short reminder in the deployment section would still improve operator onboarding, but the active warning is accurate.

### PMR-C9-FP-04 - Admin-account positioning does not overpromise RBAC

Severity: None
Confidence: High
Classification: Already fixed/aligned

Exact regions:

- `README.md:40` says "multiple root-admin accounts" and explicitly notes "no role separation yet."
- `CLAUDE.md:5` defines multiple root-admin accounts with authentication only and no role/capability separation.
- `CLAUDE.md:228` says any admin can upload, edit, export/restore DB backups, change settings, and manage other admins.
- `apps/web/messages/en.json:45-50` and `apps/web/messages/ko.json:45-50` warn in the create-admin copy that new admins are full-access root admins.

Failure scenario avoided:

The docs/UI do not sell multi-user administration as roles, teams, or permissions.

Suggested fix:

None unless RBAC is introduced later.

### PMR-C9-FP-05 - Storage backend/S3/MinIO is not exposed as a supported product feature

Severity: None
Confidence: High
Classification: Already fixed/aligned

Exact regions:

- `CLAUDE.md:141` says the storage abstraction is not integrated and the product currently supports local filesystem storage only.
- `apps/web/src/__tests__/storage-quarantine.test.ts:1-27` documents the quarantine rationale.
- `apps/web/src/__tests__/storage-quarantine.test.ts:111-143` statically asserts no source file outside `lib/storage/` imports the storage abstraction.
- A docs/source sweep found no active public README claim of S3 or MinIO support.

Failure scenario avoided:

Operators are not told they can switch storage backends when the upload/processing/serving pipeline is still local-filesystem only.

Suggested fix:

None. Keep the quarantine test until storage is intentionally wired end-to-end.

### PMR-C9-FP-06 - Photographer-intent and no-edit/no-scoring contract remains intact

Severity: None
Confidence: High
Classification: Already fixed/aligned

Exact regions:

- `CLAUDE.md:258-260` states the product premise: photos arrive after editing, and no edit/culling/scoring features ship.
- `README.md:32-40` frames processing as color/HDR fidelity, metadata, tagging/search, and admin upload/batch editing rather than image editing or culling.
- `apps/web/src/components/image-manager.tsx` exposes metadata/admin management editing, not destructive image editing or culling/scoring workflow.
- `apps/web/src/components/similar-photos.tsx` uses internal similarity `score` data for ranking but does not expose a user-facing score/rating control.

Failure scenario avoided:

GalleryKit does not drift into a Lightroom/DAM editing or culling promise that would conflict with the photographer-intent model.

Suggested fix:

None. Continue using "metadata edit" or "batch metadata editing" when describing admin operations, not generic "photo editing."

### PMR-C9-FP-07 - Search and deployment claims mostly match code

Severity: None
Confidence: High
Classification: Already fixed/aligned

Exact regions:

- `README.md:36` says metadata search covers titles, descriptions, cameras, and tags.
- `apps/web/src/lib/data.ts:1515-1555` searches title, description, camera/lens/topic fields.
- `apps/web/src/lib/data.ts:1589-1619` includes tag and alias matching.
- `README.md:145-149` documents production public URL requirements, upload/proxy caps, and single-writer topology.
- `apps/web/scripts/ensure-site-config.mjs:14-42` rejects placeholder/missing production URLs.
- `apps/web/docker-compose.yml:1-27` matches the documented single Linux host-network deployment with bind-mounted data, uploads, resources, and site config.
- `apps/web/nginx/default.conf:21-31`, `apps/web/nginx/default.conf:72-104`, and `apps/web/nginx/default.conf:122-144` match the documented request-size caps for general traffic, DB restore, dashboard uploads, and Lightroom uploads.

Failure scenario avoided:

The public feature list is not materially ahead of the implementation for keyword search, production URL checks, or documented request-size limits.

Suggested fix:

None.

## Final Missed-Issue Sweep

I ran a final text sweep across the active docs, locale strings, public/admin app routes, components, and core libs for terms tied to the requested review areas: semantic search, similar photos, backup/restore, self-host/deploy/Docker, root admin/roles, Lightroom token scopes, expiry, scoring/rating/culling/editing, S3/MinIO/storage backend, payment/Stripe/license/entitlement, and photographer-intent language.

No additional confirmed product/documentation/trust issue was found. The only promoted findings are:

- `PMR-C9-01` confirmed: Lightroom tokens over-grant future read/delete scopes and hide non-expiring default.
- `PMR-C9-02` likely: deploy env-file docs disagree on canonical secret path.
- `PMR-C9-RISK-01` manual validation: live demo semantic-search claim depends on current production runtime state.
