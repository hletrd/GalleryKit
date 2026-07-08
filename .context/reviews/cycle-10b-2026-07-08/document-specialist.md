# Cycle 10b Document-Specialist Review — 2026-07-08

Reviewer: document-specialist persona
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `f4faad29` (docs(review): add cycle 29 architecture review)
Dirty peer files excluded from review (per instructions): `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/cycle-28-source-contracts.test.ts`, plan/README docs.
Scope: doc-vs-code accuracy spot-check of `CLAUDE.md`'s highest-value precise claims (env-var defaults, formulas, constants, lock names, ETag format, token format, nginx caps, rate-limit windows), plus `README.md` / `AGENTS.md` drift.

## Dedupe note

Checked `.context/reviews/cycle10-2026-07-07/document-specialist.md` and `.context/reviews/run10-cycle27/document-specialist.md` for prior findings. Both previously-flagged wiki mismatches (stale migration-reconcile lesson, CLIP "LIVE in production" overclaim) referenced a `.omc/wiki/*.md` path that no longer exists in this checkout (`git ls-tree -r HEAD -- .omc/wiki` returns nothing) — moot/resolved, not re-flagged. No unresolved document-specialist findings remained open from those cycles that overlap this cycle's scope.

## Findings

### DOC-C10b-01 — `CLAUDE.md` "Database Schema" and "Database Indexes" sections omit the `pending_file_deletions` table and its indexes

Severity: Medium
Confidence: High

Location:
- Doc: `CLAUDE.md` "Database Schema (Key Tables)" section (lists `images`, `topics`, `tags`/`imageTags`, `adminUsers`/`sessions`, `sharedGroups`/`sharedGroupImages`, `image_views`/`topic_views`/`shared_group_views`, `image_embeddings`, `admin_tokens`, `smart_collections`) — no `pending_file_deletions` entry.
- Doc: `CLAUDE.md` "Database Indexes" section — lists only the pre-migration-0028 index set.
- Code truth: `apps/web/src/db/schema.ts:134` (`export const pendingFileDeletions = mysqlTable("pending_file_deletions", …)`), `apps/web/drizzle/0030_pending_file_deletions.sql`, `apps/web/src/lib/pending-file-deletions.ts` (full read/update/delete/drain implementation), `apps/web/src/app/actions/images.ts:679-705,816` (single-image and batch delete both insert a `pendingFileDeletions` row transactionally before the image row/files are removed), `apps/web/src/lib/maintenance-scheduler.ts:8,46` (`drainPendingFileDeletions` is one of the four tasks in the hourly `runMaintenanceSweep`, alongside `purgeExpiredSessions`, `purgeOldAuditLog`, `purgeOldViewEvents` — the other three of which ARE documented in CLAUDE.md).

Mismatch:
`pending_file_deletions` has been a real, committed, wired-in durable retry queue since migration `0030_pending_file_deletions.sql` (commit `8b795862`, cycle 21) — several cycles before this HEAD. It is a genuine schema table with two indexes (`idx_pending_file_deletions_image_id`, `idx_pending_file_deletions_updated_at`), it participates in the same hourly maintenance sweep as three tables CLAUDE.md already documents, and it changes operational behavior an admin/operator would want to know about: when Sharp/filesystem file-deletion cleanup fails during an image delete, the failure is NOT silently dropped — a row is persisted with `attempts`/`last_error`, and the hourly sweep retries up to 25 rows per pass (`DEFAULT_PENDING_FILE_DELETION_DRAIN_LIMIT = 25` in `pending-file-deletions.ts:35`) via `drainPendingFileDeletions`. CLAUDE.md's "Race Condition Protections" section briefly alludes to a related retry ("Retry pending image file deletions" — commit `57c1ae33`) but the schema/table itself, its retention (there is no purge/TTL — a permanently-failing row accumulates indefinitely since nothing removes it except a successful retry), and its maintenance-scheduler wiring are absent from the two sections that would normally document a new table.

Separately, the same "Database Indexes" section is missing three more index additions that predate this HEAD by multiple cycles: `idx_images_processed_updated_at` / `idx_images_topic_updated_at` (migration `0029_feed_updated_indexes.sql`, commit `d4bccea2`, backing the Atom feed's `updated_at`-ordered queries in `app/feed.xml/route.ts` and `app/[locale]/(public)/[topic]/feed.xml/route.ts`), `idx_images_processed_pipeline_version` (added alongside the pending-file-deletions migration), and `idx_rate_limit_bucket_start_idx` (migration `0028_rate_limit_bucket_start_idx.sql`).

Why it matters:
An operator diagnosing "files left behind after delete" or investigating unexpected row growth in an unfamiliar table would find no mention of `pending_file_deletions` in the canonical schema doc and might mistake it for an ad hoc/undocumented feature, misdiagnose a stuck retry as data corruption, or not realize the hourly maintenance scheduler is the mechanism that eventually cleans up the on-disk files. A contributor extending the maintenance runbook could also miss that this table has no retention/eviction policy, unlike the view/audit tables that do (`VIEW_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`).

Corrected text (add to "Database Schema (Key Tables)"):
> `pending_file_deletions` - Durable retry queue for on-disk derivative/original cleanup that failed during an image delete (single or batch). A row is inserted transactionally before the image row/files are removed; `attempts` and `last_error` are updated on each failed retry. Drained by `drainPendingFileDeletions()` (`apps/web/src/lib/pending-file-deletions.ts`), one of four tasks the independent hourly maintenance scheduler runs (up to 25 rows per sweep). Rows are removed only on a successful cleanup — there is no TTL/retention cap, so a persistently failing filesystem path (e.g. permissions, missing mount) will accumulate rows until the underlying I/O issue is fixed.

Corrected text (append to "Database Indexes"): add `pending_file_deletions(image_id)`, `pending_file_deletions(updated_at)` (migration 0030), `images(processed, updated_at, created_at, id)` and `images(topic, processed, updated_at, created_at, id)` — Atom feed `updated_at` ordering (migration 0029), `images(processed, pipeline_version, id)` (migration 0030), and `rate_limit_buckets(bucket_start)` (migration 0028).

### DOC-C10b-02 — `CLAUDE.md`'s Lint Gates section understates the scope of `lint:public-route-rate-limit`

Severity: Low
Confidence: Medium

Location:
- Doc: `CLAUDE.md` "Lint Gates (security-critical)" — "Scans every PUBLIC API route file (`apps/web/src/app/api/**` excluding `api/admin/**`) that exports a mutating HTTP handler…"
- Code truth: `apps/web/scripts/check-public-route-rate-limit.ts:24-26` (`const APP_DIR = path.resolve(__dirname, '../src/app');` — NOT `../src/app/api`), `:130-149` (`findRouteFiles(APP_DIR)` recurses the whole `src/app` tree collecting every `route.{ts,tsx,js,mjs,cjs}`; `isPublicRouteFile` only excludes `src/app/api/admin/*` and any path containing an `/admin/` segment — it does not restrict scanning to `src/app/api/`).
- Confirmed in practice by existing non-`api/` route files that already carry the scanner's own opt-out/compliance markers: `apps/web/src/app/uploads/[...path]/route.ts:4` (`// @public-no-rate-limit-required: …`) and `apps/web/src/app/feed.xml/route.ts:13,56` (imports and calls `preIncrementFeedAttempt`). Neither of these is under `app/api/`, yet both are shaped to satisfy this exact lint gate — proving the scanner's real root is `apps/web/src/app/`, not `apps/web/src/app/api/`.
- `AGENTS.md` already states the broader (and correct) scope: "every public App Router route handler under `apps/web/src/app/**/route.*`".

Mismatch:
`CLAUDE.md` and `AGENTS.md` disagree on the scanned root, and `CLAUDE.md`'s narrower claim is the wrong one. The lint gate actually covers every `route.*` file under `apps/web/src/app/` (page-level Atom feeds, the non-locale and locale-prefixed `/uploads/[...path]` serve routes, etc.), not just `apps/web/src/app/api/**`.

Why it matters:
A contributor who reads only `CLAUDE.md` and adds a new public, non-`api/` route handler (e.g., another feed, sitemap, or asset-serving route) could wrongly conclude it falls outside this blocking CI lint's reach and skip adding either a rate-limit call or an `@public-no-rate-limit-required` comment — then be surprised by a CI failure, or worse, reason from the wrong scope when writing that exemption comment's justification. This is a documentation-accuracy gap rather than a functional risk (the lint itself is correct and would still catch the omission), but it can cost a contributor a debugging cycle and it makes `CLAUDE.md` self-inconsistent with `AGENTS.md`.

Corrected text:
> - `npm run lint:public-route-rate-limit --workspace=apps/web`
>   - Scans every `route.{ts,tsx,js,mjs,cjs}` file under `apps/web/src/app/` (not just `app/api/**`) — excluding `app/api/admin/**` and any path containing an `/admin/` route-group segment — that exports a mutating HTTP handler (POST/PUT/PATCH/DELETE) or an expensive public GET/HEAD handler.

## Verified TRUE (spot-checked against committed HEAD, no drift found)

- `IMAGE_PIPELINE_VERSION = 7` (`gallery-config-shared.ts:22`).
- `COLOR_IMPACTING_KEYS` has exactly 9 entries (5 color + 3 quality + 1 size), matching `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` in `gallery-config-shared.ts:75-85`; `HASH_LENGTH = 8` in `settings-hash.ts:61`.
- `resolveImageQueueConcurrency` formula and its clamp to **2** at pool 10 (`image-queue.ts:120-133`); `resolveBackfillConcurrency` formula and its clamp to **2** at pool 10 (`admin-backfill-runner.ts:106-142`).
- `POOL_CONNECTION_LIMIT = 10`, `queueLimit: 20`, `enableKeepAlive: true` (`db/index.ts:31,39-43`).
- `IMAGE_MAX_INPUT_PIXELS` default `268435456` (256×1024×1024) and `IMAGE_MAX_INPUT_PIXELS_TOPIC` default `67108864` (64×1024×1024) (`process-image.ts:352-368`).
- `UPLOAD_MAX_TOTAL_BYTES` default `2147483648` (2 GiB), `UPLOAD_MAX_FILES_PER_WINDOW` default `100`, `NEXT_UPLOAD_BODY_MAX_BYTES` default `278921216` (266 MiB = 250 MiB + 16 MiB) (`upload-limits.ts:1-21`).
- `AUDIT_LOG_RETENTION_DAYS` default 90 days (`audit.ts:110-131`); `VIEW_RETENTION_DAYS` default 395 days (`view-retention.ts:14-50`).
- `IMAGE_CLEANUP_CONCURRENCY` default 5, max 32 (`actions/images.ts:858-864`).
- `TRUSTED_PROXY_HOPS` default 1 (`rate-limit.ts:120,165-171`).
- `SEMANTIC_TOP_K_MAX` default 50 / hard cap 100; `SEMANTIC_SCAN_LIMIT` default 2000 / hard cap 25000 (`clip-embeddings.ts:36-48`).
- `CLIP_INFERENCE_CONCURRENCY` default 1 capped at 4; `CLIP_INFERENCE_MAX_PENDING` default 32; `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` default 30000 capped at 300000 (`clip-model.ts:53-63`).
- Admin token format `gk_<base64url(32 random bytes)>` = 3-char prefix + 43 chars = 46 total (`admin-tokens.ts:5,21,23`).
- Serve-upload ETag format `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`, `Cache-Control: public, max-age=3600, must-revalidate` (`serve-upload.ts:122-123,281,297,325`).
- nginx body caps: 2 MiB default (`nginx/default.conf:74`), 64 KiB login (`:100-102`), 250 MiB `/admin/db` (`:117-119`), 216 MiB `/admin/dashboard` (`:134-136`), 216 MiB `/api/admin/lr/upload` (`:174-177`).
- Login rate limit 5 attempts / 15-minute window, both per-IP and per-account buckets share `LOGIN_WINDOW_MS` (`rate-limit.ts:66-67`, `auth-rate-limit.ts`).
- `HEAD_REVALIDATE_TIMEOUT_MS = 300` in the service-worker template (`sw.template.js:39,390`); `MAX_BLUR_DATA_URL_LENGTH = 4096` (`blur-data-url.ts:45`).
- `wide_gamut_max_source_pixels` default `50000000`; `avif_effort` default `6`; `wide_gamut_jpeg_chroma` default `4:4:4`; `sdr_jpeg_chroma` default `4:2:0`; `image_quality_webp`/`image_quality_jpeg` default 90, `image_quality_avif` default 85; default `image_sizes` = 640,1536,2048,4096,5120,7680 (`gallery-config-shared.ts:102-142`).
- All 8 advisory-lock names/prefixes (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit:image-processing:{jobId}`, `gallerykit_color_pipeline_backfill`, `gallerykit_semantic_embedding_backfill`, `gallerykit_web_singleton_<sha256(DB_NAME) 16-hex>`) exist verbatim in `advisory-locks.ts:21-70`.
- Single-writer guard: 60 s `SELECT 1` keepalive, 60 s re-acquire loop, ~25 s re-probe delay (`single-writer-guard.ts:49-50`).
- `DB_SSL`/`DB_SSL_CA` auto-TLS-for-non-localhost behavior (`mysql-connection-options.js:3-19`).
- `MYSQL_PWD` (not `-p`) used for mysqldump/restore (`app/[locale]/admin/db-actions.ts:241,905`).
- Unicode-bidi/zero-width sanitization wired on exactly the documented field set: `topic.alias`/`topic.label` (`actions/topics.ts`), `tag.name` (`actions/tags.ts`), `image.title`/`image.description` (`actions/images.ts`), `seo_title`/`seo_description`/`seo_nav_title`/`seo_author` (`actions/seo.ts`).
- `action-origin` lint gate scope (`apps/web/src/app/actions/` + hard-coded `app/[locale]/admin/db-actions.ts`) matches `check-action-origin.ts` (verified against the committed HEAD version, not the peer's dirty working copy).
- `smart_collections` still has no admin UI/API wiring (`en.json:507-508` still references "Collections are not editable in the admin UI yet").
- Versions: Next.js `^16.2.10`, React/`react-dom` `^19.2.5`, TypeScript `^6`, Node `engines.node: >=24` (`package.json`, `apps/web/package.json`) match CLAUDE.md's "Next.js 16.2", "React 19", "TypeScript 6", "Node.js 24+".
- `AGENTS.md`'s "Vitest 3000+ unit tests" claim: raw `it(`/`test(` count across `apps/web/src/__tests__/` is 3107 — consistent.
- `README.md` and `AGENTS.md` cross-checked line-by-line against the same env-var/formula/nginx/deploy claims verified above for `CLAUDE.md`; no independent drift found in either file beyond the single scope-wording disagreement in DOC-C10b-02 (where `AGENTS.md` is actually the accurate one).
- Migration-runbook function names (`getAllJournalMigrations`, `reconcileLegacySchema`, `baselineAllJournalMigrations`, `prepareLegacyDatabaseIfNeeded`, `runMigrations`, `LEGACY_DML_MIRRORED_BY_RECONCILE`) all exist in `apps/web/scripts/migrate.js` at the referenced roles.

## Not independently re-verified (out of scope / unchanged since last cycle)

- Touch-target `KNOWN_VIOLATIONS` per-file counts in `apps/web/src/__tests__/touch-target-audit.test.ts` (large surface; no code changes since last review suggested drift).
- Deployed-host state (live DB rows, seeded CLIP weights, current `semantic_search_mode` row, host nginx application status) — CLAUDE.md already correctly disclaims these as unverifiable from the repo alone.
