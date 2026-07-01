# Cycle 92 Tracer Review — 2026-07-01

Scope: trace suspicious flows and competing hypotheses end-to-end across auth, upload, image processing, rate limits, restore, public sharing, OG, semantic search, and deploy. I read `AGENTS.md` and `CLAUDE.md` first, then built the inventory below before tracing findings.

Constraints honored: report-only pass; no source edits, migrations, deploys, test rewrites, or cleanup actions.

## Result summary

- Confirmed issues: 1
- Likely issues / design mismatches: 1
- Manual-validation / operational risks: 6
- Final missed-issue sweep: route/auth/rate static gates passed via direct `node --import tsx` execution; no additional confirmed issue surfaced.

## Inventory of relevant files

### Route and page entry points

- Admin API: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public API: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Upload serving: `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- Public share/gallery pages: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, public feed routes.

### Server actions

- Auth/admin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Gallery mutations: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/app/actions/admin-backfill.ts`
- Public actions: `apps/web/src/app/actions/public.ts`

### Core libraries, schema, scripts, deploy

- Auth/security/rate: `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`
- Upload/image processing: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/serve-upload.ts`
- Data/privacy/schema: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/*`, `apps/web/scripts/migrate.js`
- Restore/backup: `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/scripts/restore-maintenance-recovery.mjs`
- OG: `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/safe-json-ld.ts`
- Semantic search: `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-paths.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`
- Deploy/runtime: root `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/src/instrumentation.ts`

### Tests/contracts reviewed by name or gate

Relevant contracts exist for auth/session/rate (`auth-actions-behavior.test.ts`, `auth-rate-limit*.test.ts`, `check-action-origin.test.ts`, `check-api-auth.test.ts`, `check-public-route-rate-limit.test.ts`, `request-origin.test.ts`, `session*.test.ts`, `rate-limit*.test.ts`), upload/image (`images-action-*.test.ts`, `image-queue*.test.ts`, `process-image*.test.ts`, `upload-*.test.ts`, `lr-upload-hdr-gate.test.ts`, `strip-gps-from-original.test.ts`), restore (`db-restore.test.ts`, `restore-maintenance*.test.ts`, `restore-upload-lock.test.ts`, `sql-restore-scan.test.ts`), sharing/OG/semantic (`sharing-actions.test.ts`, `shared-route-rate-limit-source.test.ts`, `og-rate-limit.test.ts`, `og-route-source-contracts.test.ts`, `semantic-search-*.test.ts`, `semantic-route-production.test.ts`, `clip-*.test.ts`), and deploy/migrate (`deploy-script-contract.test.ts`, `migration-journal*.test.ts`, `migrate-reconcile-coverage.test.ts`).

## Confirmed issues

### TRC-92-01 — DB restore does not fence already-in-flight non-upload admin mutations

- Severity: High
- Confidence: High
- Status: Confirmed by code flow
- Affected flow: restore ↔ admin mutations (`topics`, `tags`, `settings`, and likely other non-upload mutators)

**Evidence**

1. `restoreDatabase` serializes restore against the restore lock, upload-processing contract, color backfill lock, and semantic backfill lock before setting maintenance (`apps/web/src/app/[locale]/admin/db-actions.ts:374-447`). The durable maintenance marker is only started at `apps/web/src/app/[locale]/admin/db-actions.ts:449-452`, then queue/background writes are flushed/quiesced at `apps/web/src/app/[locale]/admin/db-actions.ts:492-503`.
2. The maintenance gate checked by actions is process state: `getRestoreMaintenanceMessage()` returns the current boolean at `apps/web/src/lib/restore-maintenance.ts:21-31`; `beginRestoreMaintenance()` just flips that boolean at `apps/web/src/lib/restore-maintenance.ts:48-55`. The durable wrapper writes a marker after toggling process state at `apps/web/src/lib/restore-maintenance-durable.ts:96-107`, but existing requests do not automatically re-check it.
3. Upload paths are explicitly fenced: browser upload takes the upload-processing contract before config/topic/insert work (`apps/web/src/app/actions/images.ts:189-205`) and has late post-save restore checks before DB insert (`apps/web/src/app/actions/images.ts:418-430`). LR upload repeats restore checks after multipart parsing and takes the same contract before topic lookup/save/insert/enqueue (`apps/web/src/app/api/admin/lr/upload/route.ts:252-279`). Restore holds that same contract through the restore window (`apps/web/src/app/[locale]/admin/db-actions.ts:400-410`).
4. Non-upload admin actions mostly check maintenance once at entry, then can await substantial DB/CPU work before writes:
   - `updateTopic` checks maintenance at `apps/web/src/app/actions/topics.ts:182-185`, then performs topic lookup at `apps/web/src/app/actions/topics.ts:232-235`, optional topic image processing at `apps/web/src/app/actions/topics.ts:240-243`, and later writes inside a transaction at `apps/web/src/app/actions/topics.ts:249-340`.
   - `updateGallerySettings` checks maintenance at `apps/web/src/app/actions/settings.ts:41-44`, then performs DB reads/lock checks at `apps/web/src/app/actions/settings.ts:93-157`, and writes settings in a transaction at `apps/web/src/app/actions/settings.ts:163-175`.
   - `updateTag` checks maintenance at `apps/web/src/app/actions/tags.ts:42-45`, then performs SELECT/transaction updates at `apps/web/src/app/actions/tags.ts:74-98`.
5. The static origin-auth gate is not a restore-race gate. It passed and reported: `All mutating server actions enforce same-origin provenance.` That proves CSRF/origin posture, not restore fencing.

**Why this is a confirmed issue**

A request can pass its one-time `getRestoreMaintenanceMessage()` check, then yield on DB or image work. A restore can start afterward, acquire its own locks, set maintenance, and import SQL. The already-in-flight non-upload action can then resume and write into tables while the restore import is dropping/recreating/importing rows. Upload/backfill paths have explicit locks/late checks for this class; broad admin mutators do not.

**Impact**

Restore can produce mixed pre-/post-restore state, lose a user-visible admin mutation, or introduce referential/routing drift depending on which SQL import phase overlaps. The highest-risk examples are route-defining rows (`topics`, `topic_aliases`), settings that change processing/public rendering, and tag/image timestamp updates.

**Fix direction**

Introduce a reusable restore write barrier for all mutating admin actions, not just uploads/backfills. Options: hold `LOCK_DB_RESTORE` or a new global admin-write advisory lock around mutating DB windows; or re-check maintenance immediately before every transaction/DB write and after slow processing. Add regression coverage where a mutation passes entry maintenance, restore starts, and the mutation must abort before write.

## Likely issues / design mismatches

### TRC-92-L1 — Semantic embedding storage is single-row-per-image while callers reason in per-model-version terms

- Severity: Medium
- Confidence: Medium
- Status: Likely design mismatch; not proven as an immediate user-visible outage
- Affected flow: semantic search production/stub toggles, future model upgrades, backfills

**Evidence**

1. Schema stores one embedding row per image: Drizzle declares `imageId` as the primary key at `apps/web/src/db/schema.ts:284-290`; migration 0012 creates `PRIMARY KEY (image_id)` at `apps/web/drizzle/0012_image_embeddings.sql:5-11`. Migration 0022 adds only a secondary `(model_version, updated_at)` index for scans (`apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`).
2. Serving paths filter by model version. Text semantic search chooses active stub/production model at `apps/web/src/app/api/search/semantic/route.ts:202-205` and scans only rows with that `modelVersion` at `apps/web/src/app/api/search/semantic/route.ts:263-279`. Similar search is production-only and requires target/scan rows at `PRODUCTION_MODEL_VERSION` (`apps/web/src/app/api/search/similar/[id]/route.ts:121-143`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-177`).
3. Writers/backfills also reason as if the absence predicate is `(image_id, model_version)`, but the upsert overwrites the single image row:
   - Queue insert/upsert updates `embedding` and `modelVersion` on duplicate image key (`apps/web/src/lib/image-queue.ts:379-390`).
   - Sidecar backfill comments/select processed images without a row for the target model (`apps/web/scripts/backfill-clip-embeddings.ts:161-180`), then upserts by image and updates `modelVersion` (`apps/web/scripts/backfill-clip-embeddings.ts:212-223`).
   - Admin action mirrors the same active-model selection (`apps/web/src/app/actions/embeddings.ts:120-140`) and upsert (`apps/web/src/app/actions/embeddings.ts:168-179`).

**Why this is not marked confirmed-critical**

The current active-mode model can be restored by re-embedding: a wrong-model row still matches the `notExists(... modelVersion = target)` predicate and gets overwritten. That means production activation can work after a complete backfill.

**Risk**

The schema cannot retain parallel stub and production embeddings, or old/new production embeddings during a model migration. Any rollback/toggle/model upgrade requires destructive overwrite and a full re-embed before routes filtering the other model version are complete again. This is easy to miss because the code comments and predicates are per-model-version, while the physical key is per-image only.

**Fix direction**

Either make the model explicit in the key (`PRIMARY KEY(image_id, model_version)` plus serving/backfill limits) or document the intentional single-active-model invariant directly in schema/scripts/tests and add an operator smoke check that counts active-model rows before enabling production.

## Manual-validation / operational risks

### TRC-92-MV1 — Semantic production activation is operator-state-dependent

- Severity: Medium
- Confidence: High
- Manual validation needed: production env/weights/backfill/live DB setting

Evidence:

- Stored `semantic_search_mode='production'` is healed to disabled unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`apps/web/src/lib/gallery-config.ts:123-126`, `apps/web/src/lib/gallery-config-shared.ts:223-229`). The admin Settings UI rejects production at `apps/web/src/app/actions/settings.ts:72-74`.
- CLIP runtime is offline-only: model cache root is set at `apps/web/src/lib/clip-model.ts:179-184`, and remote model loads are disabled while pinned revision/model files are loaded at `apps/web/src/lib/clip-model.ts:203-222`. Docker creates/points `CLIP_MODELS_ROOT` to `/app/data/models/clip` (`apps/web/Dockerfile:111-115`, `apps/web/Dockerfile:146-149`).
- Public semantic route returns `semantic_not_configured` when mode is not stub/production (`apps/web/src/app/api/search/semantic/route.ts:186-200`) and returns `semantic_no_embeddings` if production mode has no rows (`apps/web/src/app/api/search/semantic/route.ts:285-289`).
- The backfill sidecar refuses `--production` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`apps/web/scripts/backfill-clip-embeddings.ts:114-116`) and exits without work when mode is disabled unless `--force` is supplied (`apps/web/scripts/backfill-clip-embeddings.ts:130-138`). CLAUDE.md documents repeated `--production --force` runs until `SEMANTIC_SCAN_LIMIT` is exhausted (`CLAUDE.md:527-546`) and notes the container must be redeployed for env changes (`CLAUDE.md:548-557`).

Validation to perform manually before claiming production semantic search is live: confirm weights exist under the live bind mount, env is present in the running container, active DB setting is `production`, active-model row count is complete, and both `/api/search/semantic` and `/api/search/similar/[id]` succeed against known processed photos.

### TRC-92-MV2 — Byte-impacting image settings require re-encode/backfill for existing derivatives

- Severity: Medium
- Confidence: High
- Manual validation needed: after settings changes, verify backfill/re-encode was run

Evidence:

- The authoritative byte-impacting settings list includes chroma, AVIF effort, force-sRGB, wide-gamut max pixels, quality, and image sizes (`apps/web/src/lib/gallery-config-shared.ts:72-85`). `settings-hash.ts` documents those nine settings and says existing static derivatives still need re-encode before bytes change (`apps/web/src/lib/settings-hash.ts:1-35`).
- `updateGallerySettings` only uses the upload-processing contract and existing-image locks for `image_sizes` and `strip_gps_on_upload` (`apps/web/src/app/actions/settings.ts:79-157`), then persists any sanitized setting in a transaction (`apps/web/src/app/actions/settings.ts:163-175`).
- `serve-upload.ts` folds the settings hash into fallback-route ETags but explicitly says existing static derivatives still need re-encode to change bytes/mtime (`apps/web/src/lib/serve-upload.ts:204-230`).
- Sidecar backfill supports `--force-reencode` (`apps/web/scripts/backfill-color-pipeline.ts:317-380`). CLAUDE.md states flipping any admin tunable requires backfill and settings-only current-version rows require sidecar `--force-reencode` (`CLAUDE.md:333-339`).

Validation risk: after changing quality/color/effort settings, a normal UI save can be correct for future uploads while existing derivatives keep old bytes until a force re-encode/backfill completes.

### TRC-92-MV3 — DB restore is DB-only; filesystem originals/derivatives/resources remain external state

- Severity: Medium
- Confidence: High
- Manual validation needed: backup/restore runbook must pair SQL with bind-mounted file snapshots

Evidence:

- Restore validates and imports a SQL dump into MySQL (`apps/web/src/app/[locale]/admin/db-actions.ts:570-760`) using `mysql --one-database` (`apps/web/src/app/[locale]/admin/db-actions.ts:667-680`) and post-restore migrations (`apps/web/src/app/[locale]/admin/db-actions.ts:718-747`).
- DB rows contain filenames/original metadata; public/private file state lives in bind mounts. Docker Compose persists `./data`, `./public/uploads`, and `./public/resources` (`apps/web/docker-compose.yml:24-28`). Dockerfile sets originals/model data under `/app/data` (`apps/web/Dockerfile:110-115`, `apps/web/Dockerfile:146-149`).
- Upload serving validates files under the upload root with realpath/lstat/open checks (`apps/web/src/lib/serve-upload.ts:127-196`), so DB/file mismatches surface as missing derivatives/originals rather than being repaired by DB restore.

Validation risk: restoring an old SQL backup without a matching filesystem snapshot can leave DB rows pointing to missing files, or filesystem files not referenced by restored DB rows.

### TRC-92-MV4 — Deploy/prune path was reviewed but not executed in this report-only lane

- Severity: Low/Medium
- Confidence: High
- Manual validation needed: live deploy/smoke if this cycle changes production behavior

Evidence:

- Root `npm run deploy` invokes `./scripts/deploy-remote.sh` (`package.json:11-23`). The remote helper sources a permission-checked env file and builds/executes SSH from env, not hardcoded host data (`scripts/deploy-remote.sh:22-53`, `scripts/deploy-remote.sh:55-93`).
- Remote deploy runs `git pull --ff-only`, checks `.env.local` permissions and site config, builds/starts Docker, waits for health, then prunes stopped containers/images/build cache/dangling volumes (`apps/web/deploy.sh:10-12`, `apps/web/deploy.sh:15-55`, `apps/web/deploy.sh:57-77`, `apps/web/deploy.sh:79-104`).
- Data-safety assumptions are bind mounts and host MySQL (`apps/web/deploy.sh:84-98`, `apps/web/docker-compose.yml:15-28`).

This lane intentionally did not deploy because the user requested a report-only tracer review and deploy is an external-production side effect.

### TRC-92-MV5 — Single-process topology is a documented coordination/rate-limit assumption

- Severity: Medium if horizontally scaled; Low under shipped deployment
- Confidence: High
- Manual validation needed: ensure production remains single web instance unless coordination is moved to shared storage

Evidence:

- CLAUDE.md explicitly documents the shipped topology as single web-instance/single-writer and warns that upload quota tracking, image queue state, admin-backfill status, some in-memory rate limits, OG/share/semantic fast paths, and shared-group view buffers are process-local (`CLAUDE.md:234-237`).
- Code confirms process-local public fast paths: OG/share buckets are in memory (`apps/web/src/lib/rate-limit.ts:80-99`), public share pre-increment is in memory (`apps/web/src/lib/rate-limit.ts:335-345`), semantic buckets are in memory (`apps/web/src/lib/rate-limit.ts:352-391`), and view-count/background writes are buffered/drained in process (`apps/web/src/lib/background-db-writes.ts:1-35`, `apps/web/src/instrumentation.ts:20-70`).
- Docker Compose currently runs one `gallerykit-web` service with host networking (`apps/web/docker-compose.yml:1-17`).

### TRC-92-MV6 — `/api/health` relies on default Node runtime for optional DB probe

- Severity: Low
- Confidence: Medium
- Manual validation needed: verify route runtime after Next/runtime config changes

Evidence:

- The route imports DB and can execute `SELECT 1` when `HEALTH_CHECK_DB=true` (`apps/web/src/app/api/health/route.ts:1-5`, `apps/web/src/app/api/health/route.ts:19-31`), but it does not explicitly export `runtime = 'nodejs'` (`apps/web/src/app/api/health/route.ts:5-8`).
- The tests cover maintenance/DB success/failure/liveness behavior but not runtime pinning (`apps/web/src/__tests__/health-route.test.ts:21-70`).
- Other DB/native-heavy public routes explicitly pin Node runtime, for example semantic search (`apps/web/src/app/api/search/semantic/route.ts:59-65`) and similar search (`apps/web/src/app/api/search/similar/[id]/route.ts:50-53`).

This is not a current confirmed bug because Next route handlers default to Node in this app shape, but an explicit runtime export/test would reduce future config-regression risk.

## Traced flows with no new confirmed issue

### Auth/session/admin API

- Production refuses DB-stored session-secret fallback if `SESSION_SECRET` is missing/short (`apps/web/src/lib/session.ts:16-36`).
- Session tokens are HMAC-signed with timestamp/random data (`apps/web/src/lib/session.ts:82-88`) and verified with timing-safe compare, age checks, DB session lookup, and expiry cleanup (`apps/web/src/lib/session.ts:94-150`).
- `withAdminAuth` handles scoped PATs first for cross-origin LR clients, rate-limits token auth, verifies scope, records token use, and adds no-store/nosniff headers (`apps/web/src/lib/api-auth.ts:68-112`). Cookie-admin API path checks trusted same-origin before `isAdmin()` and adds no-store/nosniff on success (`apps/web/src/lib/api-auth.ts:114-142`).
- Login validates before rate consumption, checks same-origin, pre-increments IP/account DB-backed limits, uses dummy Argon2 verification for missing users, clears rate buckets on success, rotates/invalidates sessions in a transaction, and sets secure/httpOnly/sameSite cookies (`apps/web/src/app/actions/auth.ts:77-112`, `apps/web/src/app/actions/auth.ts:143-188`, `apps/web/src/app/actions/auth.ts:191-245`). Unexpected infra failures intentionally keep attempts charged (`apps/web/src/app/actions/auth.ts:253-264`).
- Password update checks origin before user read, rate-limits before Argon2, rotates all sessions, and keeps infra failures charged (`apps/web/src/app/actions/auth.ts:290-306`, `apps/web/src/app/actions/auth.ts:344-370`, `apps/web/src/app/actions/auth.ts:375-419`, `apps/web/src/app/actions/auth.ts:437-451`).
- Middleware only performs cookie presence/format checks for admin pages and explicitly excludes APIs, matching the requirement that API routes implement their own auth (`apps/web/src/proxy.ts:69-104`, `apps/web/src/proxy.ts:124-130`).

### Upload and image processing

- Browser upload checks maintenance, same-origin, and admin user before parsing files, then validates topic/tag/filename input (`apps/web/src/app/actions/images.ts:128-187`). It acquires the upload-processing contract and snapshots strict config (`apps/web/src/app/actions/images.ts:189-205`).
- Browser upload performs disk precheck, topic existence check under claim, original save, HDR reject/delete, GPS DB stripping plus original-file GPS strip, late restore cleanup, DB insert with privacy/color/audit metadata, and queued processing with the full settings snapshot (`apps/web/src/app/actions/images.ts:264-313`, `apps/web/src/app/actions/images.ts:360-430`, `apps/web/src/app/actions/images.ts:432-493`, `apps/web/src/app/actions/images.ts:519-551`). Error paths clean saved originals and settle quota (`apps/web/src/app/actions/images.ts:556-645`).
- LR upload is protected by `withAdminAuth(... { allowTokenScope: 'lr:upload' })` (`apps/web/src/app/api/admin/lr/upload/route.ts:84-94`, `apps/web/src/app/api/admin/lr/upload/route.ts:592-594`), rejects chunked/missing/oversized bodies (`apps/web/src/app/api/admin/lr/upload/route.ts:101-128`), re-checks restore and takes the upload contract after multipart parsing (`apps/web/src/app/api/admin/lr/upload/route.ts:252-279`), mirrors HDR/GPS/restore cleanup (`apps/web/src/app/api/admin/lr/upload/route.ts:396-441`), mirrors insert/queue metadata (`apps/web/src/app/api/admin/lr/upload/route.ts:443-555`), and releases the lock in finally (`apps/web/src/app/api/admin/lr/upload/route.ts:587-590`).
- Public derivative serving validates allowed directory/extensions/segments, rejects symlinks/out-of-root realpaths, stats the opened descriptor, includes pipeline/settings hash in ETag, and handles HEAD/abort cleanup (`apps/web/src/lib/serve-upload.ts:127-196`, `apps/web/src/lib/serve-upload.ts:204-230`, `apps/web/src/lib/serve-upload.ts:251-327`).

### Public data/privacy/sharing

- Public select fields explicitly omit GPS, original filenames, user filenames, internal processing/color fields, `uploaded_by`, and processing errors; compile-time guards fail if sensitive keys enter public selects (`apps/web/src/lib/data.ts:368-489`).
- Public map data is the only GPS exposure and requires processed rows, `topics.map_visible=true`, non-null lat/lon, plus runtime assertion (`apps/web/src/lib/data.ts:1709-1746`).
- Share-key reads validate Base56 keys before DB and use public selects only (`apps/web/src/lib/data.ts:1234-1293`, `apps/web/src/lib/data.ts:1300-1390`). Base56 generation uses rejection sampling and validator length checks (`apps/web/src/lib/base56.ts:1-41`).
- Share creation checks restore/origin/admin, validates processed images before consuming quota, pre-increments in-memory/DB write limits, rolls back on no-op/failure, and uses atomic update/transaction patterns (`apps/web/src/app/actions/sharing.ts:91-191`, `apps/web/src/app/actions/sharing.ts:194-315`).
- Share pages deliberately keep metadata generic/no DB/no rate-limit and perform one body-level Base56 + maintenance + rate-limited lookup (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:39-117`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:44-121`). Group view counting is fire-and-forget only after visible content decision (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`).

### Public rate limits

- Client IP extraction only trusts proxy headers when `TRUST_PROXY=true`, otherwise all traffic collapses to `unknown` with a production warning if proxy headers exist (`apps/web/src/lib/rate-limit.ts:166-209`). Docker Compose sets `TRUST_PROXY: "true"` for the shipped host-proxy topology (`apps/web/docker-compose.yml:20-22`).
- Public load-more/search actions validate cheap input before limiting, pre-increment in-memory/DB counters before expensive DB work, and rollback on DB/query errors where appropriate (`apps/web/src/app/actions/public.ts:47-119`, `apps/web/src/app/actions/public.ts:121-167`, `apps/web/src/app/actions/public.ts:236-317`).
- View-recording actions syntactically validate before rate limiting, then keep the attempt charged for DB visibility checks; background writes are tracked and suppressed/drained during restore (`apps/web/src/app/actions/public.ts:417-438`, `apps/web/src/app/actions/public.ts:445-506`, `apps/web/src/lib/background-db-writes.ts:1-35`).

### Restore and SQL safety

- Restore upload caps size and plausible SQL header before import (`apps/web/src/app/[locale]/admin/db-actions.ts:570-618`, `apps/web/src/lib/db-restore.ts:1-25`).
- Chunked SQL scanner blocks non-app write targets and dangerous statements while allowing expected app-table dump shapes (`apps/web/src/lib/sql-restore-scan.ts:12-38`, `apps/web/src/lib/sql-restore-scan.ts:61-129`, `apps/web/src/lib/sql-restore-scan.ts:210-264`).
- Import uses env vars rather than CLI password flags, logs sanitized stderr, keeps maintenance on import/migration failure, and runs post-restore migrations (`apps/web/src/app/[locale]/admin/db-actions.ts:651-760`).

### OG

- Topic OG validates topic before rate limit, then charges DB topic lookups and sanitizes rendered strings; ETags cover topic/tag/site inputs (`apps/web/src/app/api/og/route.tsx:63-142`).
- Per-photo OG rate-limits CPU work, rolls back only malformed IDs before DB work, keeps not-found/processing fallbacks charged, sanitizes title/site, computes settings-aware ETag, pins internal derivative fetches to canonical `BASE_URL`, caps fetch bytes/time, and validates same-origin fallback redirects (`apps/web/src/app/api/og/photo/[id]/route.tsx:87-134`, `apps/web/src/app/api/og/photo/[id]/route.tsx:136-208`, `apps/web/src/app/api/og/photo/[id]/route.tsx:209-321`, `apps/web/src/app/api/og/photo/[id]/route.tsx:329-375`).
- Shared helpers strip bidi/zero-width/control characters and reject unsafe OG image URLs/backslashes/cross-origin URLs (`apps/web/src/lib/og-sanitize.ts:24-30`, `apps/web/src/lib/seo-og-url.ts:3-42`).

### Semantic search

- Semantic text route checks same-origin, maintenance, content type/body caps, then pre-increments semantic rate before config/body/embedding/scan work; production scans only active production rows and hides scores from public output (`apps/web/src/app/api/search/semantic/route.ts:186-368`).
- Similar route is production-only, loads target production embedding, scans production rows, excludes self, ranks, and uses the same public enrichment pattern (`apps/web/src/app/api/search/similar/[id]/route.ts:110-210`).
- Queue/backfill paths skip/abort during restore before embedding writes (`apps/web/src/lib/image-queue.ts:352-390`, `apps/web/scripts/backfill-clip-embeddings.ts:109-138`, `apps/web/scripts/backfill-clip-embeddings.ts:193-223`).

### Deploy/runtime

- Deploy helper and remote script match the AGENTS.md policy: env-file driven SSH, permission checks, remote pull/build/health/prune, bind-mounted persistence, host MySQL, and no `volume prune -a` (`package.json:11-23`, `scripts/deploy-remote.sh:22-93`, `apps/web/deploy.sh:79-104`, `apps/web/docker-compose.yml:24-28`).
- Runtime container stores CLIP weights and originals under bind-mounted `/app/data`, runs migrations before `node server.js`, and uses liveness-only `/api/live` healthcheck while `/api/health` remains optional DB readiness (`apps/web/Dockerfile:105-172`).

## Final missed-issue sweep

Commands run from repo root:

```bash
TMPDIR=/tmp node --import tsx apps/web/scripts/check-api-auth.ts
TMPDIR=/tmp node --import tsx apps/web/scripts/check-action-origin.ts
TMPDIR=/tmp node --import tsx apps/web/scripts/check-public-route-rate-limit.ts
rg -n "export const (GET|POST|PUT|PATCH|DELETE|HEAD)|export async function (GET|POST|PUT|PATCH|DELETE|HEAD)|withAdminAuth|preIncrement|@public-no-rate-limit-required" apps/web/src/app/api apps/web/src/app/uploads 'apps/web/src/app/[locale]/(public)'
rg -n "getRestoreMaintenanceMessage|isRestoreMaintenanceActive|beginDurableRestoreMaintenance|acquireUploadProcessingContractLock|assertNoDurableRestoreMaintenance" apps/web/src/app/actions 'apps/web/src/app/[locale]/admin/db-actions.ts' apps/web/src/lib apps/web/scripts
```

Results:

- API admin auth gate passed for `apps/web/src/app/api/admin/db/download/route.ts` and `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Action-origin gate passed and ended with `All mutating server actions enforce same-origin provenance.`
- Public route rate-limit gate passed for upload routes/feed/health/live/OG/semantic/similar routes.
- Route sweep showed the expected public mutating/expensive route handlers are covered by auth wrappers, rate helpers, or explicit public no-rate-limit comments.
- Restore-barrier sweep is what produced TRC-92-01: uploads/backfills have late/lock guards, while many non-upload mutators have entry-only maintenance checks.

Validation caveats:

- The npm-script wrappers for these three gates initially hit a sandbox-local `tsx` Unix-socket `EPERM`; direct `node --import tsx` execution succeeded and is the evidence above.
- Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, Playwright, and deploy were not run in this report-only tracer lane.
