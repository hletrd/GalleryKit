# Tracer review — cycle 3 / RPF prompt 1

Date: 2026-04-29
Scope: causal tracing across auth/origin/rate limits, uploads/processing, restore/locks, public search/load-more, cache revalidation, sharing, navigation, and deployment/proxy flows. Implementation files were not edited.

## Relevant file inventory examined first

I inventoried tracked source, config, deploy, script, and test files, then traced every relevant file in the target flows (not a sample). The review surface was:

- **Auth, origin, sessions, rate limits:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/e2e/origin-guard.spec.ts`.
- **Uploads and processing:** `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/image-url.ts`.
- **Restore, backup, locks:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`, `apps/web/src/__tests__/db-restore.test.ts`.
- **Public search/load-more/data:** `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/tag-filter.tsx`, public pages under `apps/web/src/app/[locale]/(public)/`.
- **Cache revalidation and mutations:** `apps/web/src/lib/revalidation.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, public/admin page `revalidate` exports.
- **Sharing/navigation:** `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/lib/validation.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`.
- **Deployment/proxy/config:** `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/.env.local.example`, `README.md`, `apps/web/README.md`, `CLAUDE.md`.

## Findings

### T-C3-RPF-01 — Restore SQL scanner allows arbitrary `ALTER TABLE` DDL through to `mysql`

- **Severity:** High
- **Confidence:** High
- **Flow:** restore/locks, deployment/runtime DB safety
- **Evidence:**
  - `apps/web/src/lib/sql-restore-scan.ts:23-85` defines the denylist. It blocks `ALTER USER` (`:32`) and `ALTER EVENT` (`:70`), but there is no `ALTER TABLE` pattern.
  - `apps/web/src/lib/sql-restore-scan.ts:93-118` strips comments/literals and returns `true` only when one of the denylist regexes matches; omitted `ALTER TABLE` statements therefore pass.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:414-436` streams the uploaded SQL dump through `containsDangerousSql(combined)` and rejects only when that scanner returns `true`.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:456-462` spawns `mysql --one-database ... DB_NAME`, and `apps/web/src/app/[locale]/admin/db-actions.ts:519-520` pipes the uploaded SQL into that process. `--one-database` does not block DDL against the selected application schema.
  - Existing scanner tests cover destructive table-level `DROP TABLE`, `DELETE FROM`, and `TRUNCATE` at `apps/web/src/__tests__/sql-restore-scan.test.ts:41-48`, plus other statement classes at `:51-82`, but there is no `ALTER TABLE` regression case.
  - Direct proof from this review:
    - `containsDangerousSql('ALTER TABLE admin_users DROP COLUMN password_hash;') === false`
    - `containsDangerousSql('/*!40000 ALTER TABLE `images` DISABLE KEYS */;') === false`
    - `containsDangerousSql('DROP TABLE bad;') === true`
    - `containsDangerousSql('DROP TABLE IF EXISTS images;') === false` (the app-table reset allowance)

- **Concrete failure scenario:**
  1. An admin, compromised admin browser/session, or operator mistake submits a plausible SQL dump whose header passes `hasPlausibleSqlDumpHeader` in `apps/web/src/app/[locale]/admin/db-actions.ts:391-412`.
  2. The dump contains `ALTER TABLE admin_users DROP COLUMN password_hash;` near the end, or `ALTER TABLE images MODIFY processed tinyint(1) DEFAULT 0;` to brick public visibility after restore.
  3. The scanner in `sql-restore-scan.ts:115-118` returns `false`; the restore action proceeds.
  4. The spawned `mysql --one-database` process executes the DDL in the app DB (`db-actions.ts:456-462`, `:519-520`). The app can lose auth capability or silently drift from the Drizzle schema.

- **Fix:**
  - Short-term: add `ALTER TABLE` to the restore scanner, with a narrow exception only if compatibility with app-generated mysqldump output requires `/*!40000 ALTER TABLE <known_app_table> DISABLE/ENABLE KEYS */`.
  - Better: replace the statement denylist with a restore allowlist that validates statement families and table names against `APP_BACKUP_TABLES` in `apps/web/src/lib/sql-restore-scan.ts:2-15`, then rejects non-app tables and unexpected DDL. Restore into a temporary schema and validate the post-restore schema hash before swapping if this workflow must accept untrusted or manually edited dumps.
  - Add regression tests in `apps/web/src/__tests__/sql-restore-scan.test.ts` for `ALTER TABLE ... DROP/MODIFY/ADD/RENAME`, conditional-comment `ALTER TABLE`, and any explicitly allowed `DISABLE/ENABLE KEYS` form.

- **Rejected competing hypotheses:**
  - **“`--one-database` blocks it.”** Rejected: `db-actions.ts:456-462` selects the application database; `--one-database` filters cross-database statements, not DDL on the selected schema.
  - **“Header validation proves it is an app backup.”** Rejected: `db-actions.ts:391-412` only checks a plausible SQL dump header before streaming the whole temp file; it does not bind the file to app-generated schema/content.
  - **“The existing destructive-table tests already cover this class.”** Rejected: `sql-restore-scan.test.ts:41-48` covers `DROP`, `DELETE`, and `TRUNCATE`; `ALTER TABLE` is a separate untested statement family.
  - **“All `ALTER TABLE` is malicious.”** Partially rejected: legacy MySQL dumps can emit conditional `ALTER TABLE ... DISABLE/ENABLE KEYS`; if that compatibility matters, allow only that exact form on known app tables and reject every other table alteration.

## Rejected competing hypotheses across the requested flows

- **Auth/origin bypass on mutating server actions — rejected.** Mutating action files call the centralized same-origin helper (`apps/web/src/lib/action-guards.ts:37-43`), and the helper fails closed when neither `Origin` nor `Referer` matches the trusted host (`apps/web/src/lib/request-origin.ts:79-107`). `login`, `logout`, and `updatePassword` carry direct `hasTrustedSameOrigin` checks at `apps/web/src/app/actions/auth.ts:91-95`, `:248-257`, and `:271-286`. The lint gate inventories mutating action files recursively and hard-codes `db-actions.ts` (`apps/web/scripts/check-action-origin.ts:13-21`, `:86-97`); it passed during this review.

- **Admin API auth bypass — rejected.** The only `/api/admin` route found exports through `withAdminAuth` (`apps/web/src/app/api/admin/db/download/route.ts:13`), and the wrapper rejects unauthenticated users with no-store headers (`apps/web/src/lib/api-auth.ts:14-26`). The route also performs strict same-origin validation before reading backup filenames (`route.ts:13-39`). `npm run lint:api-auth` passed.

- **Login/password/search/share rate-limit TOCTOU — rejected.** Login and password change pre-increment before Argon2 and use strict post-increment DB checks with rollback (`apps/web/src/app/actions/auth.ts:115-143`, `:169-180`, `:231-244`, `:326-345`, `:395-429`). Search validates and caps the query before pre-incrementing and rolls back on DB failure (`apps/web/src/app/actions/public.ts:108-167`). Share creation pre-increments in memory and DB, then rolls both counters back on over-limit or recovery branches (`apps/web/src/app/actions/sharing.ts:52-89`, `:118-134`). Shared IP selection is gated by `TRUST_PROXY=true` and validated proxy-hop parsing (`apps/web/src/lib/rate-limit.ts:82-113`).

- **Upload/restore race where uploads insert while restore is dropping tables — rejected.** Uploads fail fast during maintenance (`apps/web/src/app/actions/images.ts:116-128`), acquire the upload-processing contract lock before quota/file work (`:171-178`), and recheck/cleanup if restore maintenance begins after original-file save (`:274-286`). Restore holds both the DB advisory lock and the upload-processing contract lock across the maintenance window (`apps/web/src/app/[locale]/admin/db-actions.ts:288-367`) and quiesces/resumes the queue inside the window (`:340-362`).

- **Duplicate or stale image processing after restore/delete — rejected.** The queue uses per-image MySQL `GET_LOCK` claims (`apps/web/src/lib/image-queue.ts:157-184`), skips rows that are no longer pending (`:240-246`), conditionally marks rows processed (`:300-313`), and clears queue/bookkeeping during restore quiesce (`:474-503`). Upload enqueue ignores jobs while restore maintenance is active (`:193-199`).

- **Original upload leakage/path traversal — rejected.** Original uploads are stored outside the public upload root by default (`apps/web/src/lib/upload-paths.ts:24-40`), and the serve route exposes only `jpeg`, `webp`, and `avif` top-level directories with segment, extension, symlink, and realpath containment checks (`apps/web/src/lib/serve-upload.ts:7-15`, `:32-60`, `:63-84`, `:95-101`). Nginx also returns 404 for `/uploads/original/` (`apps/web/nginx/default.conf:92-94`).

- **Public search/load-more leaks private fields or enables unbounded scans — rejected.** Public select fields explicitly omit GPS, original filename, user filename, original format/file size, and processing state, with a compile-time privacy guard (`apps/web/src/lib/data.ts:179-225`). Search caps query length and limit, escapes LIKE wildcards, filters `processed=true`, and fills remaining slots with capped tag/alias queries (`apps/web/src/lib/data.ts:909-1015`). Load-more validates topic/tag/cursor/limit and caps legacy offsets (`apps/web/src/app/actions/public.ts:66-105`); the client resets cursor state on query-key changes (`apps/web/src/components/load-more.tsx:32-87`).

- **Stale cache after core mutations — mostly rejected.** The shared helper revalidates localized path variants and can invalidate the whole app layout (`apps/web/src/lib/revalidation.ts:11-57`). Uploads revalidate home/admin/topic after insertion (`apps/web/src/app/actions/images.ts:420-421`), restore calls `revalidateAllAppData()` on success (`apps/web/src/app/[locale]/admin/db-actions.ts:499-509`), and share creation/revocation/deletion revalidates affected public/admin paths (for example `apps/web/src/app/actions/sharing.ts:152`, `:341`, `:384`). Public pages inspected for search/topic/photo/share flows use dynamic/no-cache behavior where needed, e.g. topic `revalidate = 0` at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`. No high-confidence stale public data path remained.

- **Share-key authorization leaks — rejected.** Share creation requires admin and same-origin (`apps/web/src/app/actions/sharing.ts:92-100`), refuses unprocessed images (`:109-116`), uses atomic update/retry for photo keys (`:136-169`), and revalidates the relevant public/admin paths on state changes (`:152`, `:341`, `:384`). Shared group view-count buffering is explicitly approximate and flushed before restore (`apps/web/src/app/[locale]/admin/db-actions.ts:340-342`), which is acceptable for counters.

- **Navigation/dynamic route collision — rejected.** Topic slug validation reserves app route segments such as `admin`, `g`, `p`, `s`, `uploads`, locales, and public metadata routes (`apps/web/src/lib/validation.ts:3-28`). The dynamic topic page separately rejects reserved metadata filenames before metadata/data fetches (`apps/web/src/app/[locale]/(public)/[topic]/page.tsx:19-31`, `:126-136`) and redirects aliases to canonical localized topic URLs while preserving tags (`:146-154`).

- **Deployment/proxy body-cap and trust mismatch — rejected as a current code finding.** The app-side Server Action body cap is tied to `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT` (`apps/web/next.config.ts:69-78`), nginx caps general uploads at 2 GiB and DB restore at 250 MiB (`apps/web/nginx/default.conf:20`, `:60-75`), and compose forces `TRUST_PROXY=true` for the documented host-network deployment (`apps/web/docker-compose.yml:13-20`). Documentation warns that host-side nginx must not copy the container-internal uploads path unchanged (`README.md:181`, `apps/web/README.md:43-44`). One deployment footgun remains: `IMAGE_BASE_URL` must exist at runtime as well as build time for the production CSP default in `apps/web/src/lib/content-security-policy.ts:40-44`; compose supplies it through `.env.local` (`apps/web/docker-compose.yml:16-20`) but only forwards shell values as build args (`:4-9`). I did not promote this to a finding because the env example includes runtime `IMAGE_BASE_URL` (`apps/web/.env.local.example:9-16`), but docs should stay explicit.

## Final missed-issues sweep

- Searched statement scanners/tests for `ALTER TABLE`, `containsDangerousSql`, `DROP TABLE`, `TRUNCATE`, and `DELETE FROM`; only the missing restore scanner coverage above survived as a finding.
- Re-ran the two security lint gates:
  - `npm run lint:api-auth` → passed (`OK: src/app/api/admin/db/download/route.ts`).
  - `npm run lint:action-origin` → passed for all mutating server actions and documented exemptions.
- Reviewed route/deploy documentation for proxy path/body-cap/trust mismatches and rejected current-code hypotheses listed above.
- Attempted `npx vitest run src/__tests__/sql-restore-scan.test.ts`; it did not produce timely output under heavy concurrent local test load and was aborted. I used a direct `npx tsx` proof against `containsDangerousSql` instead for the specific finding.

## Summary

High-confidence actionable finding: **T-C3-RPF-01**, block or allowlist `ALTER TABLE` in restore SQL scanning before uploaded dumps are piped into `mysql`. No implementation files were changed in this prompt.
