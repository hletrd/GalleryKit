# Document-Specialist Review - Review-Plan-Fix Cycle 3

**Date:** 2026-06-29
**HEAD reviewed:** `3d3b78167360b9c66070619c0734c97dc49653f8`
**Role:** documentation/code consistency reviewer.
**Boundary:** Reviewed current `HEAD` only. Existing uncommitted edits in other review artifacts were ignored. This artifact is the only intended write.

## Inventory Coverage

Authoritative docs and operational docs were inventoried before findings:

- `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deploy/config surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/next.config.ts`.
- Migration/schema/runbook surfaces: `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, migration/source-contract tests.
- Code/comment/test surfaces behind documented claims: upload limits, CLIP path/embedding scripts, feed generation, privacy field tests, nginx tests, PAT upload route, browser upload action, data access.
- `.context` history was checked to avoid re-reporting fixed claims, especially CLIP `--force`, old nginx static-root findings, `TRUST_PROXY`, storage/S3, Stripe/paid-download, and PAT upload divergence items.

## Findings

### DOC-C3-01 - README upload-serving guidance still describes the removed nginx static root

**Status:** Confirmed issue
**Severity:** Low
**Confidence:** High

**Mismatched regions:**

- `README.md:186` says the checked-in `apps/web/nginx/default.conf` uses the container-internal path `/app/apps/web/public` and warns host nginx not to copy that path.
- `apps/web/README.md:49` repeats that the checked-in nginx config has a `/app/apps/web/public` root.
- `apps/web/nginx/default.conf:167-175` now proxies derivative uploads to `http://nextjs`; it no longer declares `root /app/apps/web/public`.
- `apps/web/src/__tests__/nginx-config.test.ts:32-35` explicitly locks this: uploads must contain `proxy_pass http://nextjs;` and must not contain `root /app/apps/web/public;`.

**Failure scenario:** An operator or future reviewer reads the README and believes the committed nginx config still serves uploads from a container-only static root. They may avoid the checked-in config, copy stale host-static guidance into a deployment, or waste time debugging a 404 class that the current config already removed by proxying `/uploads/...` to Next.

**Concrete fix:** Update both README sections to say the checked-in nginx config proxies uploaded derivatives to Next by default. Keep a separate caveat only for operators who intentionally replace that proxy block with host-side static serving: in that case they must point `root`/`alias` at the host bind mount, not `/app/apps/web/public`.

### DOC-C3-02 - README body-size guidance omits the Lightroom upload route exception

**Status:** Confirmed issue
**Severity:** Medium
**Confidence:** High

**Mismatched regions:**

- `README.md:148` lists nginx caps for general requests, login, admin DB restore, and dashboard uploads, but omits `/api/admin/lr/upload`.
- `apps/web/README.md:46` repeats the same omission.
- `CLAUDE.md:151` and `CLAUDE.md:558` correctly document that the Lightroom Classic publish-plugin route has its own 216 MiB nginx location.
- `apps/web/nginx/default.conf:122-143` implements `location ^~ /api/admin/lr/upload` with `client_max_body_size 216M`, specifically to beat the generic `/api/admin/` 2 MiB block at `apps/web/nginx/default.conf:146-160`.

**Failure scenario:** An operator customizes or recreates the reverse proxy from the public README caps. Browser dashboard uploads work because `/admin/dashboard` gets 216 MiB, but Lightroom publish requests hit the generic `/api/admin/` 2 MiB location and return 413 before the authenticated route can run. The plugin appears broken even though the app-level per-file cap is 200 MiB.

**Concrete fix:** Add the LR route to both README body-cap lists: `/api/admin/lr/upload` must have a dedicated longest-prefix 216 MiB rule that wins over the generic `/api/admin/` 2 MiB rule. Consider extending `nginx-config.test.ts:14-18` to assert the LR 216M exception so future docs/tests stay aligned.

### DOC-C3-03 - Feed attribution docs/comments still claim `uploaded_by` drives public per-entry authors

**Status:** Confirmed issue
**Severity:** Low
**Confidence:** High

**Mismatched regions:**

- `CLAUDE.md:170` says the public Atom feed surfaces a JOIN-derived display name from `uploaded_by`.
- `apps/web/src/db/schema.ts:87-90` says `uploaded_by` drives per-entry Atom `<author>`.
- `apps/web/src/__tests__/privacy-fields.test.ts:28-30` says Atom `<author>` uses a JOIN-derived display name in `getImagesForFeed`.
- `.context/plans/photographer-r22/README.md:36` still says R17-L2 requires an `uploaded_by` migration and no current path provides per-photo uploader identity.
- Current implementation deliberately does the opposite: `apps/web/src/lib/data.ts:827-839` returns `author_name: NULL` for every feed row to avoid exposing admin login usernames; `apps/web/src/app/feed.xml/route.ts:76-83` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-94` therefore fall back to the feed-level author.

**Failure scenario:** A future reviewer closes R17-L2 or designs a feature assuming public per-entry authors already work because `uploaded_by` exists and is populated by browser/PAT uploads. In reality, the public feed intentionally suppresses per-entry authors until a safe non-login `display_name` (or equivalent) exists, so the feature remains deferred for a different reason.

**Concrete fix:** Update CLAUDE, schema/test comments, and active `.context` plan text to reflect the security decision: `uploaded_by` is stored as admin-only attribution/future input, but public Atom currently emits feed-level author only. Reframe R17-L2 as blocked on a safe public display-name field or audited display-name source, not on the `uploaded_by` column itself.

## Verified Non-Findings

- CLIP production backfill docs are fixed at current HEAD: `apps/web/README.md:35-36`, `apps/web/README.md:68-70`, `apps/web/scripts/backfill-clip-embeddings.ts:6-21`, and `CLAUDE.md:521-528` all use or explain `--production --force` for pre-enable production backfills.
- PAT upload metadata/parity gaps from run-3 cycle 3 are fixed at current HEAD: `apps/web/src/app/api/admin/lr/upload/route.ts` writes `icc_profile_name`, avoids `color_space: data.iccProfileName`, sets `uploaded_by: tokenUserId`, acquires the upload-processing-contract lock, handles RAW errors specifically, checks restore maintenance, runs the disk pre-check, and enforces the cumulative upload tracker. `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:107-338` locks those source contracts.
- Env defaults checked against code: `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `NEXT_UPLOAD_BODY_MAX_BYTES`, `VIEW_RETENTION_DAYS`, `SEMANTIC_SCAN_LIMIT`, `SEMANTIC_TOP_K_MAX`, `CLIP_MODELS_ROOT`, and `HEALTH_CHECK_DB` are either correctly documented in CLAUDE/README/env examples or intentionally operational-only.
- Migration/runbook alignment checked: journal entries, per-entry baselining, reconcile coverage for latest add/drop schema, and the post-condition hash assertion are documented and backed by `migrate.js` plus migration tests. No new migration-runbook drift found.
- Removed/dormant features checked: paid downloads/Stripe, reactions, and S3/MinIO switching remain absent from live product surfaces; surviving mentions are in archive/history or explicit "do not re-add / not integrated" documentation.

## Final Missed-Issues Sweep

Swept for stale authoritative references, misleading README/CLAUDE/deploy guidance, migration/runbook drift, env var default drift, and comments/tests contradicting implementation. The remaining current-HEAD issues are the three confirmed documentation/comment mismatches above. No manual-validation-only risk was promoted; each finding is directly confirmed by source text.

**Disposition:** 3 confirmed findings, 0 likely findings, 0 manual-validation-only findings. No application-code edits.
