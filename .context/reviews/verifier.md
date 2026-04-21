# Verifier Review — Cycle 1 Prompt 1

**Date:** 2026-04-22  
**Scope:** repo-wide verification review of docs/plans + core app paths, with direct code/test/build evidence.

## Verification evidence

- `npm run build --workspace=apps/web` — PASS
- `npm test --workspace=apps/web` — PASS (13 files, 94 tests)
- `npm run lint --workspace=apps/web` — PASS
- Reviewed source/docs/plans: `README.md`, `CLAUDE.md`, `.omc/prd.json`, `.omc/progress.txt`, `.context/plans/173-cycle1-fixes.md`, `.context/plans/167-deferred-cycle1-review.md`, and the code paths cited below.

## Confirmed discrepancies

### 1) Plan 173 is marked done, but its own progress checklist is still open

- `.context/plans/173-cycle1-fixes.md:4` says `Status: DONE`.
- `.context/plans/173-cycle1-fixes.md:64-66` still has all three non-deferred items unchecked.

**Why this matters:** the plan artifact is internally inconsistent. The code in the scheduled files is implemented, but the plan record itself is stale, which can mislead future cycles about what is actually complete.

**Recommended fix:** either mark the remaining checklist items complete or retitle the plan as partially completed / deferred.

**Confidence:** high

## Likely discrepancies / risk

### 2) CSV export still materializes the full result set and full CSV string in memory

- `apps/web/src/app/[locale]/admin/db-actions.ts:43-91`

The function still:

1. loads up to 50,000 rows into `results`,
2. builds a second `csvLines` array,
3. then joins that array into `csvContent`.

`results = [] as typeof results` only drops one reference; it does not remove the already-allocated line array or final string.

**Failure scenario:** on a large gallery near the 50k cap, this can create a noticeable memory spike and GC pressure, and in a constrained deployment it can still OOM.

**Recommended fix:** stream the CSV or batch-write it to disk/response instead of building the whole payload in memory.

**Confidence:** high

### 3) Tag counts are inconsistent between public and admin surfaces

- `apps/web/src/app/actions/tags.ts:24-33` counts all image-tag links for admin tags.
- `apps/web/src/lib/data.ts:218-235` counts only `processed = true` images for public tags.

This means the same tag can show different counts depending on which surface is used.

**Failure scenario:** an admin looking at tag counts on a gallery with queued/unprocessed uploads may see counts that do not match the public gallery, which makes tag cleanup and moderation decisions harder.

**Recommended fix:** either align the count definition across both surfaces or explicitly label the admin count as “all images” so the difference is intentional and visible.

**Confidence:** medium

### 4) Shared-group view-count flush can keep retrying indefinitely under DB failure

- `apps/web/src/lib/data.ts:41-89`

The flush path re-buffers failed increments into the same in-process map and uses exponential backoff, but there is no hard retry ceiling for a persistently failing group. When the buffer reaches capacity, new increments can be dropped.

**Failure scenario:** a prolonged DB outage or repeated deadlock can keep view counts in memory for a long time; once the buffer fills, later increments are silently dropped with only a warning.

**Recommended fix:** add a hard retry budget or a durable fallback path for repeated flush failures.

**Confidence:** medium

### 5) Duplicate-username errors in admin user creation still depend on a brittle message substring

- `apps/web/src/app/actions/admin-users.ts:142-145`

The duplicate-user branch checks both `ER_DUP_ENTRY` and `e.message?.includes('users.username')`.

**Failure scenario:** a MySQL driver / schema / message-format change could stop matching the substring and turn a friendly validation error into a generic failure.

**Recommended fix:** rely on structured MySQL error metadata or a stable constraint-name check instead of a message substring.

**Confidence:** low

## Verified as not issues in this sweep

- `apps/web/src/app/actions/public.ts:25-99` now rolls back the in-memory search counter when the DB rate-limit check returns limited.
- `apps/web/src/lib/validation.ts:24-30` already rejects null bytes in aliases and tag names.
- `apps/web/src/lib/data.ts:41-89` already chunks the view-count flush work at 20 entries per batch; the old “1000 concurrent promises” issue is no longer present.
- `apps/web/src/app/api/health/route.ts:6-16` already returns only `{ status }` and does not leak DB internals.

## Final sweep for skipped-file risks

The following surfaces were not line-audited in the same depth as the core app/data/actions paths above, so they remain residual-risk areas even though build/test/lint are green:

- `apps/web/scripts/*` — DB init, migration, seed, and auth-check scripts
- `apps/web/drizzle/*` — migration history and schema snapshots
- `apps/web/docker-compose.yml` and `apps/web/nginx/default.conf` — deployment/runtime edge behavior
- `apps/web/src/lib/storage/*` — storage adapters and backend-specific behavior
- `apps/web/e2e/*` — Playwright flows not exhaustively re-run in this review

One extra process note: the working tree also contains an uncommitted `.gitignore` edit adding `.env.deploy`; I did not treat that as a functional defect, but it is a hidden-file risk if the deploy workflow relies on that file being visible to git.

## Bottom line

No HIGH or CRITICAL runtime regressions were confirmed in this sweep. The strongest confirmed issue is doc-state drift in Plan 173; the remaining items are low-to-medium risk behaviors that are either intentionally deferred or worth tightening in a future cycle.

---

# Verifier Review — Cycle 2 Ultradeep Review

**Date:** 2026-04-22  
**Scope:** repo-wide behavior verification with direct code/test/build evidence. I audited the behavior-defining files first, then cross-checked docs/messages against the implementation.

## Verification evidence

- `npm test --workspace=apps/web` — PASS (13 files, 96 tests)
- `npm run lint --workspace=apps/web` — PASS
- `npm run build --workspace=apps/web` — PASS
- Behavior-defining files reviewed first: `apps/web/src/app/actions/*`, `apps/web/src/lib/*`, `apps/web/src/db/schema.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/api/*`, `apps/web/src/app/[locale]/admin/*`, `apps/web/messages/*`, `README.md`, `CLAUDE.md`

## Findings

### 1) Storage backend support is advertised, but the app still uses direct filesystem I/O everywhere

- `apps/web/src/lib/storage/index.ts:4-13` says the admin settings page allows switching backends, but also admits the backend is not integrated into uploads/serving yet.
- `apps/web/messages/en.json:532-539` advertises a Storage Backend settings section with Local/MinIO/S3 choices.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:76-165` renders only image-processing and privacy controls; there is no storage selector.
- `apps/web/src/lib/gallery-config-shared.ts:10-19` and `apps/web/src/app/actions/settings.ts:14-31` only persist image-processing + GPS settings; `storage_backend` is not a supported setting key.
- `apps/web/src/lib/process-image.ts:207-423` and `apps/web/src/lib/serve-upload.ts:32-113` still read/write files directly through `fs`, not through `@/lib/storage`.

**Severity:** Medium  
**Confidence:** High  
**Concrete failure scenario:** an operator following the storage docs expects to switch to S3 or MinIO, but the UI has no such control and the upload/serve pipeline ignores the storage abstraction entirely, so nothing changes.  
**Suggested fix:** either wire the upload, processing, and serving paths through `@/lib/storage` and persist a real `storage_backend` setting, or remove the storage-backend UI/docs/messages until the feature is actually implemented.

### 2) CLAUDE.md says the session secret is auto-generated and stored in the database, but production code requires `SESSION_SECRET`

- `CLAUDE.md:116-121` says the session secret is auto-generated via `crypto.randomBytes` and stored in `admin_settings`.
- `apps/web/src/lib/session.ts:16-36` requires `SESSION_SECRET` in production and throws if it is missing or too short; the DB fallback is dev-only.

**Severity:** Medium  
**Confidence:** High  
**Concrete failure scenario:** a production deploy that follows the CLAUDE.md guidance and omits `SESSION_SECRET` will fail to authenticate because the runtime refuses to fall back to the DB-stored secret.  
**Suggested fix:** update the doc to state that production requires a pre-provisioned `SESSION_SECRET`, and keep the DB-generated fallback explicitly marked as development-only.

### 3) CLAUDE.md claims a 10GB default upload batch limit, but the code and README use 2 GiB

- `CLAUDE.md:200-203` says the max upload size is `200MB per file, 10GB total per batch, 100 files max`.
- `apps/web/src/lib/upload-limits.ts:1-10` sets the actual default `UPLOAD_MAX_TOTAL_BYTES` to `2 * 1024 * 1024 * 1024` bytes (2 GiB).
- `README.md:126-131` matches the code, not CLAUDE.md, by documenting `UPLOAD_MAX_TOTAL_BYTES=2147483648`.

**Severity:** Low  
**Confidence:** High  
**Concrete failure scenario:** an operator relying on CLAUDE.md alone will expect 10GB batches to work, but the app rejects uploads above 2 GiB unless the env var is raised.  
**Suggested fix:** bring CLAUDE.md into sync with the actual default, or change the code default if 10GB is the intended baseline.

### 4) `getImage()` claims legacy `processed = NULL` rows are supported, but the query only returns `processed = true`

- `apps/web/src/lib/data.ts:374-386` says “processed is true OR null/undefined for legacy” but the WHERE clause is only `eq(images.processed, true)`.
- The same file’s public list/count paths also filter on `processed = true`, so there is no actual legacy-null path anywhere in this behavior surface.

**Severity:** Medium  
**Confidence:** High  
**Concrete failure scenario:** a migrated gallery with legacy rows where `processed` is still `NULL` will hide those images from the photo-viewer path even though the comment claims they remain visible.  
**Suggested fix:** either update the query to include legacy-null rows if that support is intended, or remove the legacy-support claim and migrate existing data to explicit `processed` values.

## Final sweep

I re-checked the auth guard, backup download, rate-limit, and queue/bootstrap paths for missed high-severity issues. Build, lint, and the full web test suite are green, and I did not find any additional CRITICAL/HIGH issues beyond the four findings above.
