# Cycle 17 Document-Specialist Review

Date: 2026-06-30
Reviewed HEAD: `5e054f80`
Scope: documentation-vs-code review of authoritative docs, README surfaces, package scripts, deploy/migration docs, comments that encode contracts, i18n copy, config examples, nginx/Docker/deploy files, and tests-as-contract. This pass is read-only except for writing this report.

## Inventory

Required context read first: `AGENTS.md` and `CLAUDE.md`.

Authoritative and contract surfaces reviewed:

- Repository docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Package/script contracts: root `package.json`, `apps/web/package.json`, script guards under `apps/web/scripts/` and `scripts/`.
- Deploy/config surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`.
- Migration/schema docs: `apps/web/drizzle/meta/_journal.json`, committed SQL migrations, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`.
- Source comments that encode behavior: cache/ETag, service-worker, color/HDR, analytics, rate-limit, admin-auth, same-origin, privacy, image processing, and deploy-contract comments.
- I18n/copy surfaces: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, settings/admin UI copy, upload/color-details copy.
- Tests that claim contracts: privacy, deploy script, migration journal, route lint, cache/color, analytics, upload, touch-target, and related unit/e2e tests.

No critical or high-severity documentation mismatches were confirmed in this pass.

## Findings

### DOC17-01 - Settings-hash comments overclaim cache invalidation for static upload files

Severity: Medium
Confidence: High
Status: Confirmed
Category: operational comment/runbook drift

Evidence:

- `apps/web/src/lib/settings-hash.ts:14-24` says the settings hash is folded into the served ETag so a settings change "forces a must-revalidate 304 -> 200 cycle on every cached client even when file mtime has not changed."
- `apps/web/src/lib/serve-upload.ts:197-207` repeats the same broad claim for color-impacting settings.
- `apps/web/src/lib/serve-upload.ts:214-215` only constructs that settings-hash ETag inside `serveUploadFile`.
- `apps/web/src/app/uploads/[...path]/route.ts:4-27` routes missing/static-fallback upload requests through `serveUploadFile`.
- `apps/web/next.config.ts:56-63` documents that existing files under `public/uploads/` are served by Next's static file server; those static responses do not use `serveUploadFile`'s settings-hash ETag.
- `CLAUDE.md:296-298` correctly warns that the static path is the overwhelming majority path and that flipping a color-impacting setting does not invalidate already-served static derivatives until a backfill rewrites files.

Mismatch:

The authoritative runbook is accurate, but the code comments in the cache helpers state a wider guarantee than the implementation provides. The settings hash only applies to the route-handler path, not to ordinary static delivery of existing derivative files.

Failure scenario:

An operator or future maintainer flips `force_srgb_derivatives`, derivative size, quality, or another color-impacting setting and trusts the helper comments that every cached client will revalidate to new bytes. They skip the documented derivative backfill. Most clients continue receiving old static derivative bytes because their static-file ETags are not keyed by the settings hash.

Suggested fix:

Update `settings-hash.ts` and `serve-upload.ts` comments to scope the guarantee to route-handler responses only. Add a short pointer to the CLAUDE static-path warning: static derivatives require a backfill/rewrite to change the bytes and static validators.

### DOC17-02 - `serve-upload` cache comment says one day, but every configured header is one hour

Severity: Low
Confidence: High
Status: Confirmed
Category: cache-policy comment drift

Evidence:

- `apps/web/src/lib/serve-upload.ts:245-252` says "`public` + `max-age` + `must-revalidate`: edge caches keep the file fast for one day" but sets `Cache-Control: public, max-age=3600, must-revalidate`.
- `apps/web/next.config.ts:69-72` sets upload headers to `public, max-age=3600, must-revalidate`.
- `apps/web/nginx/default.conf:173-176` sets the same one-hour policy.
- `CLAUDE.md:204` documents the deployed static upload cache policy as `public, max-age=3600, must-revalidate`.

Mismatch:

The implementation and operational docs agree on one hour. The source comment still describes a one-day cache window.

Failure scenario:

During a cache incident or future cache-policy edit, a maintainer reads the hot-path comment and assumes clients/edges can hold upload responses fresh for a day. That can lead to incorrect incident timing, stale-byte analysis, or a mistaken edit that changes headers to match the stale comment instead of the current policy.

Suggested fix:

Change the comment at `serve-upload.ts:245-252` to "one hour" or remove the duration from the prose and let the header value be the source of truth.

### DOC17-03 - CLAUDE analytics index runbook omits current top-view and retention indexes

Severity: Low
Confidence: High
Status: Confirmed
Category: migration/runbook drift

Evidence:

- `CLAUDE.md:232-245` lists database indexes and names only the older image-view analytics indexes: `image_views(image_id, viewed_at)`, `image_views(bot, viewed_at, country_code)`, and `image_views(bot, viewed_at, referrer_host)`.
- `apps/web/src/db/schema.ts:232-236` also defines `idx_image_views_viewed_at_id` and `idx_image_views_bot_viewed_image`.
- `apps/web/src/db/schema.ts:247-249` defines topic-view indexes: `idx_topic_views_topic_viewed`, `idx_topic_views_viewed_at_id`, and `idx_topic_views_bot_viewed_topic`.
- `apps/web/src/db/schema.ts:260-262` defines shared-group-view indexes: `idx_shared_group_views_group_viewed`, `idx_shared_group_views_viewed_at_id`, and `idx_shared_group_views_bot_viewed_group`.
- `apps/web/drizzle/0026_analytics_top_view_indexes.sql:1-3` and `apps/web/drizzle/0027_analytics_retention_indexes.sql:1-3` add indexes that are not represented in the CLAUDE index section.
- `apps/web/src/lib/view-retention.ts:56-62` explicitly relies on `(viewed_at, id)` indexes for chunked retention deletes.
- `apps/web/src/lib/analytics-data.ts:1-5` documents the broader indexed analytics query model.

Mismatch:

The runbook presents the analytics index inventory as if it were current, but it omits the indexes added for topic/shared analytics, top-view queries, and retention deletion.

Failure scenario:

A future migration or performance review uses `CLAUDE.md` as the operational source of truth, misses the newer indexes, and either duplicates them, drops them during reconciliation, or fails to preserve them while changing analytics retention/top-view queries. That can turn retention cleanup or admin analytics into large scans on production data.

Suggested fix:

Update `CLAUDE.md:232-245` to either say it lists only selected indexes and points to `apps/web/src/db/schema.ts` as authoritative, or expand the section with the current image/topic/shared view indexes from migrations `0026` and `0027`.

### DOC17-04 - Deploy helper's tested default secrets path is not documented in user-facing deploy docs

Severity: Low
Confidence: High
Status: Confirmed
Category: deploy documentation gap

Evidence:

- `scripts/deploy-remote.sh:4-29` defaults to `$HOME/.gallerykit-secrets/gallery-deploy.env` when `.env.deploy` is absent and `DEPLOY_ENV_FILE` is not set.
- `scripts/deploy-remote.sh:55-58` includes that fallback path in the runtime error message.
- `apps/web/src/__tests__/deploy-script-contract.test.ts:46-52` pins `DEFAULT_DEPLOY_ENV_FILE="$HOME/.gallerykit-secrets/gallery-deploy.env"` as a deploy-script contract.
- `AGENTS.md:17-18`, `README.md:108-119`, `CLAUDE.md:653-660`, and `.env.deploy.example:1-4` document the root `.env.deploy` file and optional `DEPLOY_ENV_FILE`, but not the automatic home-directory fallback.

Mismatch:

The deploy script and a contract test support a default outside-repo secrets path, but the operator-facing docs and example config do not mention it.

Failure scenario:

An operator follows the docs and believes the only supported non-repo location is an explicitly set `DEPLOY_ENV_FILE`, while the script silently supports a conventional home path. Conversely, a maintainer may remove or break the fallback because it appears undocumented, only to trip the contract test later.

Suggested fix:

Either document `$HOME/.gallerykit-secrets/gallery-deploy.env` in README/CLAUDE/`.env.deploy.example` as the supported default external secrets path, or remove the fallback and its test if `DEPLOY_ENV_FILE` is intended to be mandatory for outside-repo config.

### DOC17-05 - HDR i18n copy promises "SDR tone-mapped" derivatives, but code only documents SDR conversion/delivery

Severity: Medium
Confidence: Medium
Status: Likely
Category: user-facing copy drift

Evidence:

- `apps/web/messages/en.json:162` says HDR uploads are accepted but "public derivatives are SDR tone-mapped."
- `apps/web/messages/en.json:740` says "public WebP/JPEG/AVIF derivatives are still SDR tone-mapped."
- `apps/web/messages/ko.json:162` and `apps/web/messages/ko.json:740` make the same promise in Korean.
- `apps/web/src/app/api/admin/lr/upload/route.ts:348-356` says HDR source metadata is stored while `process-image` encodes SDR derivatives regardless.
- `apps/web/src/components/color-details-section.tsx:552-558` says HDR sources are accepted for metadata/preservation and that delivery is currently SDR derivatives, with HDR AVIF output planned.
- `apps/web/src/lib/process-image.ts:1251-1315` explicitly converts pixels to the target colorspace, attaches ICC profiles, and encodes WebP/AVIF/JPEG derivatives. The comments describe gamut/profile conversion and SDR/P3 delivery, not an explicit HDR-to-SDR tone-mapping algorithm or tested tone-map contract.

Mismatch:

The UI copy uses the stronger term "tone-mapped," which implies a deliberate HDR-to-SDR luminance mapping. The implementation and adjacent comments only establish that public derivatives are SDR/color-profile converted and encoded. If Sharp or the input pipeline performs an implicit transform, this repository does not document or test it as a tone-mapping contract.

Failure scenario:

A photographer enables HDR ingestion and relies on the admin copy as a quality promise. PQ/HLG/high-dynamic-range uploads may produce SDR derivatives whose highlights are clipped, compressed unpredictably, or merely converted into SDR/P3 output. The UI would have promised a more intentional visual transform than the code guarantees.

Suggested fix:

If the product only guarantees SDR delivery today, change the copy to "public derivatives are delivered as SDR" or "encoded as SDR derivatives." If tone mapping is intended, document the exact transform, add regression coverage with HDR fixtures, and align process-image comments with that contract.

### DOC17-06 - `process-image` pipeline-version history omits current v7

Severity: Low
Confidence: High
Status: Confirmed
Category: source comment drift

Evidence:

- `apps/web/src/lib/process-image.ts:371-397` documents `IMAGE_PIPELINE_VERSION` history through version 6 and then re-exports the constant from `gallery-config-shared.ts`.
- `apps/web/src/lib/gallery-config-shared.ts:10-21` defines the current `IMAGE_PIPELINE_VERSION = 7` and documents v7 as the fix for JPEG chroma subsampling tracking target gamut instead of source gamut when force-sRGB is enabled.
- `CLAUDE.md:120` correctly lists the current pipeline version as 7.

Mismatch:

The authoritative constant and CLAUDE are current, but the nearby backward-compatible re-export comment in `process-image.ts` has a stale version history. This is easy to read as the local encoder history being complete.

Failure scenario:

A maintainer auditing pipeline-version bumps from `process-image.ts` misses the v7 rationale and may re-open or duplicate the fixed JPEG chroma decision, especially because the v7 behavior is implemented later in the same file at `apps/web/src/lib/process-image.ts:1363-1372`.

Suggested fix:

Either remove the duplicate history from `process-image.ts` and point to `gallery-config-shared.ts`, or add the v7 history line there as well.

## Coverage And Missed-Doc Sweep

Final sweep rechecked canonical docs, README files, package scripts, environment examples, deploy helpers, Docker/nginx config, migration journal and migration runner comments, schema/index declarations, public/admin route lint contracts, same-origin/admin-auth/privacy guards, color/HDR/cache comments, i18n message files, service-worker/cache claims, analytics docs, CLIP semantic-search docs, and tests that encode these contracts.

Known limits:

- This was a source/documentation review at current HEAD. I did not run the full test suite or inspect live production state, untracked deploy env files, host nginx, remote Docker volumes, or seeded CLIP model files.
- External browser/platform color behavior was not independently revalidated; this pass only checked committed claims against committed implementation.
- Existing unrelated modified review files in `.context/reviews/` were left untouched.

No additional confirmed documentation/code mismatch survived the final evidence threshold beyond the findings above.
