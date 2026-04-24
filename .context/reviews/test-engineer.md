# Test Engineer Deep Review — Cycle 2 Recovery (2026-04-24)

## Inventory and method

Agent-tool fan-out was attempted in one batch and retried once, but this session was already at the platform child-agent limit (`agent thread limit reached (max 6)`). Per Prompt 1 recovery rules, this compatibility lane completed the review directly and wrote this per-agent file rather than discarding partial review work. Earlier partial files for `document-specialist`, `perf-reviewer`, `product-marketer-reviewer`, and `tracer` were preserved under `.context/reviews/recovery-cycle2-partials/` before replacement.

Review-relevant inventory was built from `git ls-files` and focused on tracked source, tests, scripts, docs, deploy config, i18n messages, and active plan/context artifacts. Dependency/build/runtime artifacts (`node_modules`, `.next`, binary screenshots/fixtures, `test-results`, tsbuildinfo) were excluded. Key surfaces inspected for this lane included:

- Server actions and auth: `apps/web/src/app/actions/{auth,images,settings,sharing,topics,tags,admin-users,seo,public}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/{action-guards,rate-limit,auth-rate-limit,restore-maintenance,revalidation}.ts`.
- Data/schema/cache: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, public page routes under `apps/web/src/app/[locale]/(public)/**`.
- Upload/processing/config: `apps/web/src/lib/{image-queue,process-image,upload-limits,upload-paths,gallery-config,gallery-config-shared}.ts`, settings UI/messages.
- Tests/gates: Vitest tests under `apps/web/src/__tests__/`, Playwright tests under `apps/web/e2e/`, custom lint scripts, package scripts.
- Docs/deploy: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, `.env.local.example`, Docker/nginx/deploy files.

Final sweep: re-ran targeted `rg` sweeps for `share_key`, `sharedGroupImages`, `revalidateLocalizedPaths`, `checkRateLimit`, `incrementRateLimit`, `DB_SSL`, `--ssl-mode`, `image_sizes`, and setup/init documentation, then checked each finding against current source before recording it.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| AGG2C2-01 | HIGH | High | Confirmed | Deleting images does not invalidate cached direct-share or group-share pages |
| AGG2C2-02 | MEDIUM | High | Confirmed | Login/password DB rate limits still check before increment across processes |
| AGG2C2-03 | MEDIUM | High | Confirmed | Backup/restore CLI SSL policy ignores the documented `DB_SSL=false` opt-out |
| AGG2C2-04 | MEDIUM | Medium-High | Confirmed | `image_sizes` can change while unprocessed jobs are in flight |

## Detailed findings

### AGG2C2-01 — Deleting images does not invalidate cached direct-share or group-share pages

- **Status:** Confirmed
- **Severity:** HIGH
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/actions/images.ts:367-427`, `apps/web/src/app/actions/images.ts:461-555`, `apps/web/src/db/schema.ts:87-104`, `apps/web/src/lib/data.ts:552-630`, `apps/web/src/app/actions/sharing.ts:320-381`.
- **Why this is a problem:** `deleteImage` and `deleteImages` fetch filenames/topic, delete the image rows, and revalidate `/`, `/p/{id}`, the topic, and admin dashboard. They never fetch `images.share_key` nor group keys joined through `shared_group_images`, even though dedicated share revoke/delete paths revalidate `/s/{key}` and `/g/{key}`.
- **Failure scenario:** An admin shares a photo or group, the public share page is generated and cached, then the admin deletes the image. The DB row/group link is gone, but `/s/<key>` or `/g/<key>` can remain cached and keep exposing stale deleted-photo content until natural ISR expiry or unrelated broad invalidation.
- **Suggested fix:** Before deletion, collect direct `share_key` values and affected `shared_groups.key` values for the target image IDs; after successful deletion, include `/s/{key}` and `/g/{key}` in targeted revalidation (or broad layout revalidation for large batches). Add a regression test/static guard.

### AGG2C2-02 — Login/password DB rate limits still check before increment across processes

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/actions/auth.ts:108-141`, `apps/web/src/app/actions/auth.ts:320-337`, `apps/web/src/lib/rate-limit.ts:172-215`, safer reference pattern in `apps/web/src/app/actions/public.ts:63-94`.
- **Why this is a problem:** Auth flows pre-check DB buckets via `checkRateLimit`, then increment. In a multi-process deployment, concurrent bad attempts can all observe the old count before any increment lands. Search/share/admin-user flows already use the safer increment-before-check pattern with `includesCurrentRequest` semantics and rollback.
- **Failure scenario:** With max 5 attempts, two Node workers receive bad login attempts for the same account bucket while DB count is 4. Both read 4, both run Argon2, then DB count lands at 6, admitting extra expensive guesses across workers.
- **Suggested fix:** Move DB `incrementRateLimit` before `checkRateLimit` for login IP/account and password-change buckets; check using `isRateLimitExceeded(count, max, true)`; roll back both in-memory and DB counters when an over-limit request is rejected before authentication work.

### AGG2C2-03 — Backup/restore CLI SSL policy ignores the documented `DB_SSL=false` opt-out

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/[locale]/admin/db-actions.ts:127-140`, `apps/web/src/app/[locale]/admin/db-actions.ts:396-408`, `apps/web/src/db/index.ts:6-25`, `apps/web/scripts/mysql-connection-options.js:11-23`, `apps/web/.env.local.example:7`.
- **Why this is a problem:** Runtime DB and migration helpers honor `DB_SSL=false` for non-local DB hosts, but admin backup/restore force `--ssl-mode=REQUIRED` for every non-local host. Operators following the documented opt-out can have app queries and migrations work while backup/restore fail.
- **Failure scenario:** A private VPC MySQL endpoint has TLS disabled and the deployment sets `DB_SSL=false`. Admin backup/restore invoke `mysqldump`/`mysql` with `--ssl-mode=REQUIRED`, causing the maintenance operation to fail despite documented configuration.
- **Suggested fix:** Centralize CLI SSL arg derivation from the same localhost + `DB_SSL=false` policy and test it; use the helper for both dump and restore.

### AGG2C2-04 — `image_sizes` can change while unprocessed jobs are in flight

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** Medium-High
- **Files/regions:** `apps/web/src/app/actions/settings.ts:72-103`, `apps/web/src/app/actions/images.ts:224-305`, `apps/web/src/lib/image-queue.ts:240-263`, `apps/web/src/lib/process-image.ts:390-444`, public image URL consumers in `apps/web/src/lib/image-url.ts:24-48` and public routes.
- **Why this is a problem:** Settings blocks output-size changes only when a processed image exists. A new gallery can upload images (`processed=false`), start queue jobs with old sizes, then change `image_sizes` before any row becomes processed. The UI/public pages then request derivative filenames for the new size set while queued jobs may have produced only the old size set.
- **Failure scenario:** Admin uploads photos, immediately changes output sizes while processing is still running, then public thumbnails/metadata URLs are generated for sizes that do not exist on disk, causing broken images/OG previews after rows flip to processed.
- **Suggested fix:** Lock `image_sizes` once any image row exists, not only once a processed row exists, unless a full queue quiesce/regeneration workflow is introduced. Update admin copy/tests to reflect “uploaded” rather than “processed.”

## Final missed-issue sweep

Rechecked the inventory and targeted sweeps listed above after drafting findings. No relevant tracked source/config/doc/test file in this lane was intentionally skipped beyond generated/dependency/binary artifacts.
