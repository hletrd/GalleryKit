# Cycle 10 Product Marketer Reviewer

Date: 2026-07-07  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Reviewer: custom product-marketer-reviewer  
Scope: self-hosted photo gallery product messaging, docs, feature claims, deployment/readiness claims, user-facing copy, and market-facing trust gaps.

## Result

No confirmed product or marketing findings.

Finding count: 0

I adapted the local product-marketer reviewer prompt from `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` to GalleryKit and ignored its BurstPick-specific assumptions. The review found no current user-facing or market-facing claim that I could prove false against the inspected source. Where the product has risky or operator-heavy behavior, the current docs and copy generally disclose the limitation instead of overclaiming.

## Inventory First

Primary docs and claim surfaces inspected:

- `README.md:8`, `README.md:29-32`, `README.md:36-50`, `README.md:58-74`, `README.md:168-177`, `README.md:193-215`
- `apps/web/README.md:65-106`
- `CLAUDE.md:150-162`
- `apps/web/messages/en.json:419-438`, `apps/web/messages/en.json:500-506`, `apps/web/messages/en.json:761-779`, `apps/web/messages/en.json:823-843`, `apps/web/messages/en.json:867-894`
- `apps/web/messages/ko.json:500-506`
- Prior local product-marketer review: `.context/reviews/product-marketer-reviewer.md`

Implementation and readiness source inspected:

- Semantic search and similar-photo routes: `apps/web/src/app/api/search/semantic/route.ts:19-31`, `apps/web/src/app/api/search/semantic/route.ts:190-265`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-29`, `apps/web/src/app/api/search/similar/[id]/route.ts:120-190`
- CLIP/offline model loading and defaults: `apps/web/src/lib/clip-model.ts:200-215`, `apps/web/src/lib/gallery-config-shared.ts:108-120`
- Auto alt-text implementation: `apps/web/src/lib/caption-generator.ts:1-68`, `apps/web/src/lib/image-queue.ts:892-909`
- Upload API and token actions: `apps/web/src/app/api/admin/lr/upload/route.ts:1-19`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-140`, `apps/web/src/app/actions/lr-tokens.ts:29-114`
- Privacy and analytics: `apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-24`, `apps/web/src/app/[locale]/(public)/layout.tsx:23-35`, `apps/web/src/app/actions/public.ts:331-339`, `apps/web/src/app/actions/public.ts:416-455`, `apps/web/src/app/actions/public.ts:484-489`, `apps/web/src/app/actions/public.ts:522-527`, `apps/web/src/db/schema.ts:216-269`, `apps/web/src/lib/rate-limit.ts:567-583`, `apps/web/src/lib/maintenance-scheduler.ts:33-38`, `apps/web/src/lib/maintenance-scheduler.ts:69-78`, `apps/web/src/instrumentation.ts:1-8`
- GPS/map privacy: `apps/web/src/lib/data.ts:368-444`, `apps/web/src/lib/data.ts:1750-1782`, `apps/web/src/components/map/map-client.tsx:115-118`
- Deploy/readiness: `scripts/deploy-remote.sh:22-29`, `scripts/deploy-remote.sh:31-53`, `scripts/deploy-remote.sh:61-80`, `apps/web/deploy.sh:15-55`, `apps/web/deploy.sh:57-77`, `apps/web/deploy.sh:79-108`, `apps/web/docker-compose.yml:24-32`

Final missed-issues sweep:

- Searched docs, localized messages, plans/specs, and the prior review for claim terms covering `AI`, semantic search, similar photos, offline/PWA, analytics, privacy, GPS, backups, restore, Lightroom/plugin, self-hosting, color/HDR, Docker/readiness, production/operator gating, stubs, tokens, uploads, map, EXIF, captions, and alt-text.
- Re-checked source for claims that commonly drift: disabled-by-default AI, real production CLIP gating, local/offline model loading, upload-token/plugin boundaries, deployment safety, first-party analytics privacy, public GPS exposure, and backup completeness.

## Findings

No confirmed findings.

Because there are no confirmed findings, there is no severity/confidence/file/failure/fix block to report. The evidence below documents the claims I tested and why I did not file them.

## Evidence And Non-Findings

### 1. Semantic search and "similar photos" claims match the operator-gated implementation

Docs claim GalleryKit provides self-hosted English/Korean semantic search and similar photos, but disables production by default and requires operator setup. `README.md:48` explicitly says production semantic search is disabled by default, not enabled from Settings UI, requires model weight download, backfill, and env opt-in, and scans newest embeddings rather than a vector index. `apps/web/README.md:65-91` repeats the detailed runbook and says production activation requires model files, matching model-version rows, and `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.

Source supports that posture. The semantic route documents only `stub` and `production` serving modes and says every other mode returns 503 at `apps/web/src/app/api/search/semantic/route.ts:19-31`; the live gate returns 503 unless mode is `stub` or `production` at `apps/web/src/app/api/search/semantic/route.ts:190-204`; production uses `embedTextReal` while stub uses `embedTextStub` at `apps/web/src/app/api/search/semantic/route.ts:247-253`; and scanning is explicitly bounded newest-first at `apps/web/src/app/api/search/semantic/route.ts:263-265`. Similar photos are production-only at `apps/web/src/app/api/search/similar/[id]/route.ts:14-20` and return 503 unless semantic mode is production at `apps/web/src/app/api/search/similar/[id]/route.ts:120-130`.

The offline/no-per-query-API claim is also supported. CLIP loading sets `env.cacheDir = CLIP_MODELS_ROOT` and `env.allowRemoteModels = false` before `from_pretrained` at `apps/web/src/lib/clip-model.ts:207-210`.

User-facing copy is appropriately honest. Search copy says semantic setup requires seeded weights, production mode, and backfilled embeddings at `apps/web/messages/en.json:430`, says stub results are not meaningful at `apps/web/messages/en.json:434`, and warns production scans newest embeddings first at `apps/web/messages/en.json:435`. Admin settings copy discloses stub-vs-production and env opt-in at `apps/web/messages/en.json:765-775`.

Failure scenario checked: a visitor or operator expects "AI search" to be live by default or complete across every old photo. Current docs and UI set the opposite expectation, so I did not file a claim defect.

### 2. Auto alt-text copy avoids overclaiming model-generated captions

Docs say auto alt-text is default-off and currently derives suggestions from local EXIF/metadata, not remote AI captioning. See `apps/web/README.md:93-95`. Admin copy says "EXIF Alt-Text Hints" and "Model-generated descriptions are not implemented" at `apps/web/messages/en.json:761-764`.

Source supports that statement. The default is `auto_alt_text_enabled: 'false'` at `apps/web/src/lib/gallery-config-shared.ts:116-117`. The generator file says the repository ships only a stub implementation, no captioning weights or runner, and generates deterministic EXIF-derived hints at `apps/web/src/lib/caption-generator.ts:1-15`; `generateCaption` returns `null` when disabled and otherwise uses the stub at `apps/web/src/lib/caption-generator.ts:57-67`. The queue stores the suggestion only after processing at `apps/web/src/lib/image-queue.ts:892-909`.

Failure scenario checked: marketing suggests real AI captioning or remote captioning when only EXIF hints exist. Current docs and UI explicitly avoid that overclaim, so I did not file a finding.

### 3. Upload API and Lightroom/plugin boundaries are clear

Docs say GalleryKit exposes a PAT-authenticated upload API and does not bundle a Lightroom Classic plugin. `README.md:215-224` lists the endpoint, token header, `lr:upload` scope, multipart fields, limits, and response. `apps/web/README.md:97-106` repeats the API contract and says external clients are compatible if they can send multipart form data and the PAT header. Admin token copy says the endpoint is provided but no Lightroom Classic plugin is bundled or distributed at `apps/web/messages/en.json:867-894`.

Source supports the claim. The route header comments state the server-side API does not bundle or distribute a plugin and authenticates with `X-GalleryKit-Token` scoped to `lr:upload` at `apps/web/src/app/api/admin/lr/upload/route.ts:1-13`. The route is wrapped in `withAdminAuth` starting at `apps/web/src/app/api/admin/lr/upload/route.ts:84`, and upload limits are enforced from `apps/web/src/app/api/admin/lr/upload/route.ts:101-140`. Token creation normalizes scopes, requires at least one scope, stores a generated token, and records audit metadata at `apps/web/src/app/actions/lr-tokens.ts:29-114`.

Failure scenario checked: an operator expects a bundled Lightroom plugin or broader metadata override support. The docs say API contract, not plugin, and narrow the accepted metadata fields, so I did not file a finding.

### 4. Privacy and analytics copy matches stored data and GA gating

Privacy copy says Google Analytics is optional, first-party view events store timestamps/bot/country/referrer summaries, full IPs and fingerprints are not stored in analytics tables, separate short-lived abuse-prevention buckets may store full IPs, and view events default to 395 days. See `apps/web/messages/en.json:833-843`.

Source supports this. The privacy page selects enabled/disabled GA copy from the same site config pattern at `apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-24`, and the public layout only loads GA scripts when the configured ID matches the GA format at `apps/web/src/app/[locale]/(public)/layout.tsx:23-35`. Public analytics comments state full IPs are never stored and only country code is derived from IP at `apps/web/src/app/actions/public.ts:331-339`. Inserts into image/topic/shared-group view tables include referrer host, country code, and bot flag, not IP or client fingerprint, at `apps/web/src/app/actions/public.ts:450-455`, `apps/web/src/app/actions/public.ts:484-489`, and `apps/web/src/app/actions/public.ts:522-527`. Schema confirms rate-limit buckets store IPs at `apps/web/src/db/schema.ts:216-224`, while analytics tables contain referrer/country/bot fields but no IP at `apps/web/src/db/schema.ts:226-269`. The rate-limit bucket purge defaults to 24 hours at `apps/web/src/lib/rate-limit.ts:567-583`, and the maintenance scheduler runs the purge on startup and interval at `apps/web/src/lib/maintenance-scheduler.ts:33-38`, `apps/web/src/lib/maintenance-scheduler.ts:69-78`, started from `apps/web/src/instrumentation.ts:1-8`.

Failure scenario checked: privacy page says "no IP storage" while the product stores full IPs elsewhere. Current copy distinguishes analytics tables from short-lived abuse-prevention buckets, so I did not file a finding.

### 5. GPS/map copy matches public field filtering

Privacy copy says standard public pages exclude GPS, and the public map can show coordinates only for topics an admin marks visible. See `apps/web/messages/en.json:840-843`.

Source supports this. `publicSelectFields` explicitly omits latitude/longitude and other internal fields at `apps/web/src/lib/data.ts:368-407`. `publicMapSelectFields` is the only unauthenticated field set that retains latitude/longitude and carries a warning that it must be used with the `map_visible` topic filter at `apps/web/src/lib/data.ts:409-444`. `getMapImages` joins topics and requires `topics.map_visible = true` plus non-null coordinates before returning map rows at `apps/web/src/lib/data.ts:1750-1768`, then asserts every row is map-visible at `apps/web/src/lib/data.ts:1770-1778`. The map component loads OpenStreetMap tiles from `https://{s}.tile.openstreetmap.org/...` at `apps/web/src/components/map/map-client.tsx:115-118`, matching the privacy copy about third-party tile requests.

Failure scenario checked: public product copy under-discloses GPS or map tile exposure. The current privacy copy covers both, so I did not file a finding.

### 6. Deployment/readiness claims match deploy scripts

Docs claim Docker deployment is supported, requires a real build-time site config, uses host-network plus reverse proxy, preserves bind-mounted data, and auto-prunes stale Docker artifacts after successful deploy. See `README.md:168-177` and `README.md:193-211`.

Source supports that. The remote deploy helper selects `.env.deploy`, `DEPLOY_ENV_FILE`, or the home secrets path at `scripts/deploy-remote.sh:22-29`, builds the SSH deploy command from env at `scripts/deploy-remote.sh:31-53`, and refuses unsafe deploy env permissions at `scripts/deploy-remote.sh:61-80`. The host deploy script refuses missing or unsafe `apps/web/.env.local` at `apps/web/deploy.sh:15-43`, refuses missing `site-config.json` at `apps/web/deploy.sh:45-49`, runs Compose build/up at `apps/web/deploy.sh:51-55`, waits for health or `/api/live` at `apps/web/deploy.sh:57-77`, then prunes stopped containers, unused images, builder cache, and dangling volumes only after health at `apps/web/deploy.sh:79-108`. Compose uses bind mounts for `./data`, `./public/uploads`, `./public/resources`, and read-only `site-config.json` at `apps/web/docker-compose.yml:24-32`.

Failure scenario checked: "Docker Ready" implies a one-click cloud/SaaS deployment or hides data-loss risk from pruning. The README and scripts disclose host-network/reverse-proxy assumptions, build-time config, bind mounts, and prune-after-health data safety, so I did not file a finding.

### 7. Prior smart-collection copy issue appears addressed enough not to refile

The previous product-marketer review filed a category-delete copy issue because the toast implied an in-product smart-collection remediation path. Current English copy says, "Update the collection query directly before deleting it" at `apps/web/messages/en.json:506`; Korean copy likewise says to edit the collection query directly at `apps/web/messages/ko.json:506`. `CLAUDE.md:162` still says no admin UI/API surface invokes smart-collection mutations and rows are currently authored via direct DB insert.

This is still an awkward operator workflow, but the current user-facing copy no longer tells the admin to use a nonexistent dashboard collection editor. Because the implementation limitation is documented and the copy now says the query must be updated directly, I did not refile the cycle 9 issue.

## Market-Facing Trust Gaps Checked

No substantiated trust gap found in the inspected surfaces.

- Self-hosting is bounded: docs say originals stay private, derivatives are public, GA is optional, and semantic search requires explicit operator setup (`README.md:29-32`, `README.md:48`, `README.md:74`).
- Not-for positioning is explicit: no editing, culling, scoring, proofing, payments, hosted SaaS, or bundled Lightroom plugin (`README.md:31-32`, `README.md:50-52`, `apps/web/messages/en.json:823-831`).
- Backup limitations are disclosed: database dumps are plaintext SQL rows only and do not include originals, derivatives, or resources (`README.md:177`, `apps/web/README.md:60`).
- Storage support is not overmarketed: `CLAUDE.md:150` says the product currently supports local filesystem storage only and warns not to expose S3/MinIO as supported.

## Validation

No source files were edited. This is a read-only product/docs review plus the review artifact.

I did not run the full lint/typecheck/build/test suite because the task was a no-edit marketing/docs/source consistency review. Validation evidence is source inspection with exact file and line references plus the final claim-focused `rg` sweep described above.
