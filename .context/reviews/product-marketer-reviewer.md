# Cycle 29 Product Marketer Reviewer

Date: 2026-06-30
Role: product-marketer-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Output: `.context/reviews/product-marketer-reviewer.md`

## Scope and Method

This is Prompt 1 review only. I did not plan or implement product-code changes.

The installed product-marketer-reviewer prompt was treated only as a reviewer-style lens. Its BurstPick-specific assumptions were not applied. This review is grounded in GalleryKit: a self-hosted finished-photo gallery with private originals, color-managed delivery, public/share routes, admin upload/settings flows, first-party analytics, optional Google Analytics, and operator-gated semantic search.

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried documentation, messages, public routes, admin settings/upload/share/token/db flows, privacy/color/HDR/search paths, deployment runbooks, and recent plan/review artifacts with `rg` / `rg --files`.

## Executive Summary

GalleryKit's positioning is generally honest and unusually specific: it says finished-photo publishing, not editing, culling, proofing, scoring, payments, or hosted SaaS. The docs also correctly describe semantic search as disabled by default and operator-gated, and the upload API as an API contract rather than a bundled Lightroom plugin.

The remaining trust gaps are concentrated around operational expectations: GPS stripping is default-off while the product leads with private-original language; the public privacy page says analytics tables avoid full IPs but does not disclose short-lived full-IP rate-limit buckets; share links are easy to create but not visible/revocable in the production UI; and semantic-search marketing remains dependent on live operator state before any public demo/release claims.

## Confirmed Issues

### PM-C29-01 - GPS privacy is positioned as a key trust benefit, but first-run defaults retain GPS in originals unless the operator catches the setting

- Severity: Medium
- Confidence: High
- Where:
  - `README.md:8`, `README.md:29-31`, `README.md:118`
  - `apps/web/src/lib/gallery-config-shared.ts:92-104`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:651-681`
  - `apps/web/messages/en.json:172`, `apps/web/messages/en.json:735-741`, `apps/web/messages/en.json:810`
- Evidence: The README leads with "private originals" and tells first-run operators to review Settings, especially GPS stripping. The actual default is `strip_gps_on_upload: 'false'`. The Settings toggle is clear once found, but it is disabled after images exist. Upload success can emit `gpsRetentionWarning`, but that happens after the first upload has already retained GPS-bearing originals.
- Failure scenario: A photographer installs GalleryKit because the README promises private originals, uploads a first batch from a camera/phone with GPS, misses the Settings toggle, and later discovers retained originals still contain location metadata. Public pages still omit GPS unless map-visible topics opt in, but the private-original trust expectation is already damaged.
- Fix: Make first-run privacy posture harder to miss. Options: default GPS stripping on for fresh installs; add a blocking first-run upload interstitial; or show an always-visible pre-upload warning in the admin dashboard while `strip_gps_on_upload=false` and no photos exist. Also adjust README wording to state "private from public routes" separately from "GPS retained unless stripping is enabled."

### PM-C29-02 - Public privacy copy omits full-IP rate-limit storage even though visitor actions persist IPs temporarily

- Severity: Medium
- Confidence: High
- Where:
  - `apps/web/messages/en.json:802-810`
  - `apps/web/src/db/schema.ts:170-178`, `apps/web/src/db/schema.ts:212-224`
  - `apps/web/src/app/actions/public.ts:320-407`
  - `apps/web/src/lib/rate-limit.ts:450-518`
  - `apps/web/src/lib/image-queue.ts:1019-1047`
- Evidence: The privacy page says full IP addresses are not stored "in these analytics tables." That is true for `image_views`, `topic_views`, and `shared_group_views`. However, public view recording uses `incrementRateLimit(ip, 'view_record', ...)`, and the shared `rate_limit_buckets` table stores `ip` as a plain varchar primary-key component. Search/share/other guarded paths use the same persistent bucket table. `purgeOldBuckets()` removes expired buckets after a default 24 hours, called on startup and hourly.
- Failure scenario: A privacy-conscious visitor reads the public Privacy page and concludes GalleryKit stores no full IP address for their visit. In reality, a page view/search/share lookup can leave their IP in `rate_limit_buckets` until the next purge window. The implementation may be reasonable, but the disclosure is incomplete.
- Fix: Update privacy copy to explicitly distinguish analytics events from security/rate-limit records: "View analytics do not store full IPs; short-lived full IP rate-limit/security records may be stored for abuse prevention and are purged after about 24 hours by default." Consider hashing IPs in DB-backed public rate-limit buckets if exact IP retention is not operationally required.

### PM-C29-03 - Share links are publishable from UI, but revoke/delete management is not exposed in production UI

- Severity: Medium
- Confidence: High
- Where:
  - `README.md:39`, `README.md:44`
  - `apps/web/src/components/photo-viewer.tsx:588-612`
  - `apps/web/src/components/image-manager.tsx:194-210`
  - `apps/web/src/app/actions/sharing.ts:317-395`
  - Usage sweep: `rg -n "revokePhotoShareLink|deleteGroupShareLink|createPhotoShareLink|createGroupShareLink" apps/web/src --glob '!**/__tests__/**'`
- Evidence: The UI creates per-photo share links from `PhotoViewer` and group share links from `ImageManager`. Server actions exist to revoke a photo share and delete a group share, and tests cover them, but the non-test usage sweep shows production UI imports/calls only the create actions. The delete/revoke actions are exported but not called by components/pages.
- Failure scenario: An admin shares a private client/gallery link, the URL is forwarded beyond the intended audience, and the admin cannot find any UI to list or revoke active share links. The only practical mitigations are deleting the image/group via non-obvious side effects or manually invoking DB/server operations.
- Fix: Add an admin share-management surface: active per-photo and group shares, copy/open, created/view counts, and revoke/delete actions. Until then, make share-copy toasts or docs explicit that revocation is not available through the UI.

## Likely Issues

### PM-C29-04 - "Private originals" can be read as a backup/safety guarantee, but app-level backups intentionally exclude files

- Severity: Low-Medium
- Confidence: Medium
- Where:
  - `README.md:29-31`, `README.md:83`, `README.md:169`, `README.md:196-198`
  - `apps/web/messages/en.json:20-26`
  - `apps/web/README.md:55`
- Evidence: The README positions private original storage as a core value, and the backup UI copy correctly says database rows only. This is not a code bug. The risk is expectation mismatch: non-operator users may assume the built-in Backup button protects the gallery, while originals/derivatives/resources require host-level backups.
- Failure scenario: A solo photographer downloads a SQL backup, loses the host volume, and expects "private originals" to be recoverable from the app backup. The DB restore succeeds but files are gone.
- Fix: Keep the current DB-page warning, but add a short "backup completeness" note to Getting Started/Docker: a complete GalleryKit backup is DB dump plus `data/`, `public/uploads/`, `public/resources`, and `src/site-config.json`.

## Risks Needing Manual Validation

### PM-C29-R01 - Semantic-search/demo claims depend on deployed operator state

- Severity: Low-Medium
- Confidence: High for risk, host-state not validated
- Where:
  - `README.md:42`
  - `apps/web/README.md:59-80`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:760-795`
  - `apps/web/src/app/api/search/semantic/route.ts:1-31`, `apps/web/src/app/api/search/semantic/route.ts:196-289`
  - Prior carry-forward: `.context/plans/archive/cycle-27-2026-06-30-deferred.md` item `D27-07`
- Evidence: Docs are technically honest: disabled by default, production requires weights, env opt-in, DB row, and backfill. The admin UI intentionally offers only Disabled/Stub. The route returns 503 for disabled/not-configured and for production with no embeddings.
- Failure scenario: A release note, README badge, or demo campaign says GalleryKit has English/Korean semantic search, but the live demo/operator host is in disabled/stub/no-embedding state. A user tests it, sees setup-required or meaningless stub results, and treats the product claim as exaggerated.
- Fix: Before any public marketing/demo claim, verify the deployed host: `semantic_search_mode='production'`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, model weights present at `CLIP_MODELS_ROOT`, and nonzero `jina-clip-v2-d512-q8` embeddings. Add a small operator-facing status readout if marketing will rely on this feature.

### PM-C29-R02 - Production privacy posture depends on proxy trust configuration

- Severity: Medium
- Confidence: Medium, operational-state dependent
- Where:
  - `README.md:164-166`
  - `apps/web/README.md:52`
  - `apps/web/src/lib/rate-limit.ts:117-169`
  - Prior carry-forward: `.context/plans/archive/cycle-27-2026-06-30-deferred.md` item `D27-03`
- Evidence: Docs clearly warn that `TRUST_PROXY=true` is required behind a trusted proxy and that headers must be overwritten by the edge. Code falls back to `"unknown"` without trusted proxy configuration.
- Failure scenario: A non-standard deployment copies only part of the Docker/nginx setup. Rate limits collapse into one shared visitor bucket or trust the wrong hop, causing either false lockouts or weak abuse controls. The product then feels unreliable despite the code being correct under the documented topology.
- Fix: Validate deployed proxy headers before public launch and consider adding an admin/runtime health warning when proxy headers are present but `TRUST_PROXY` is unset.

## Non-Findings

- Keyword search claim is aligned. README says titles, descriptions, cameras, and tags; `searchImages()` searches title, description, camera, lens, topic label/slug, tags, and aliases.
- Upload API copy is aligned. README/app README say API contract, no bundled Lightroom plugin; token UI says upload tokens; the route requires `lr:upload`.
- Google Analytics opt-in copy is aligned. Layout loads GA only when `siteConfig.google_analytics_id` matches the accepted pattern, and the privacy page switches copy based on the same file-backed setting.
- HDR/color honesty is mostly aligned. Public copy says HDR ingest is gated and public derivatives are SDR; admin/public labels state HDR source / SDR delivery.
- S3/MinIO is not marketed. `CLAUDE.md` warns storage abstraction is not integrated; README does not expose it as a supported feature.
- Payment/Stripe is not marketed. README says payment is out of scope; CLAUDE says do not reintroduce.

## Missed-Issues Sweep

Before writing this file I re-ran targeted sweeps for:

- README/app README claims around private originals, semantic search, upload API, deploy, backup, analytics, and sharing.
- English/Korean message keys around privacy, GPS, semantic search, backup/restore, upload warnings, tokens, analytics, HDR, and share copy.
- Public routes `/`, `/p/[id]`, `/s/[key]`, `/g/[key]`, `/map`, `/privacy`, and semantic/similar search route behavior.
- Admin settings, upload, dashboard image manager, tokens, DB backup/restore, and share actions.
- Prior review/plan artifacts for already-known semantic-search, proxy, analytics, and operator-state risks.

No additional confirmed product/positioning mismatch survived the sweep beyond the findings above.

## Covered File Summary

- Guidance and runbooks: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`.
- Product docs/history: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, `.context/reviews/run9-cycle7/_aggregate.md`, `.context/reviews/run9-cycle8/_aggregate.md`, `.context/plans/archive/cycle-27-2026-06-30-deferred.md`.
- Public/admin copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Public surfaces: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/wide-gamut-hint.tsx`, `apps/web/src/components/similar-photos.tsx`.
- Admin surfaces: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/bulk-edit-dialog.tsx`.
- Implementation anchors: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/audit.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
