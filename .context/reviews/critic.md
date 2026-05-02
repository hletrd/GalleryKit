# Critic Review — Cycle 1

Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewer role: critic  
Date: 2026-05-02 (Asia/Seoul)  
Constraint honored: **application code was not edited**; this report is the only intended change.

## Inventory first: review-relevant files and surfaces

Tracked repository inventory: 1,475 files. Review-relevant inventory was separated from generated/binary/history-only files before code reading.

### Files/surfaces examined

- **Repository/package/docs/config**: `package.json`, `package-lock.json`, `.nvmrc`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `.env.deploy.example`, `apps/web/package.json`, `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.json`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`.
- **CI/deploy/ops**: `.github/workflows/quality.yml`, `.github/dependabot.yml`, `scripts/deploy-remote.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/init-db.ts`, `apps/web/scripts/run-e2e-server.mjs`.
- **Database/schema/migrations**: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/*`.
- **Auth/session/security gates**: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/proxy.ts`, security lint scripts.
- **Public gallery/share/search/data paths**: public route pages under `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`.
- **Uploads/images/storage/queue**: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/serve-upload.ts`, upload route handlers, storage helpers, instrumentation/shutdown helpers.
- **Admin/DB restore/backup/settings/topics/tags**: `apps/web/src/app/[locale]/admin/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, admin user/topic/tag/SEO/settings actions.
- **Client components with behavior risk**: `home-client.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `admin-user-manager.tsx`, `tag-input.tsx`, `search.tsx`, `tag-filter.tsx`.
- **Tests relevant to reviewed behavior**: unit/source-contract tests under `apps/web/src/__tests__/**` and Playwright tests under `apps/web/e2e/**`, especially admin-user, sharing/share-route-rate-limit, health, rate-limit, upload, public, origin-guard, and DB-restore coverage.

### Skipped files confirmed

Skipped as not review-relevant application behavior for this critic pass:

- Dependency/build outputs: `node_modules/`, `apps/web/node_modules/`, `apps/web/.next/`, `test-results/`, coverage/cache directories.
- Binary/static artifacts: `apps/web/e2e/fixtures/*.jpg`, `apps/web/public/fonts/*.woff2`, icon/image artifacts.
- Historical review/planning archives: `.context/plans/**`, prior `.context/reviews/**` except the target report path, and `plan/**`/`plan/done/**` as history-only context rather than source of truth.
- VCS/internal tool state: `.git/**`, `.omx/**`, `.omc/**`.

## Verification commands run

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run test` — passed: 84 test files, 586 tests.
- `npm run build` — passed, but emitted a sitemap DB fallback warning caused by missing DB selection in this local environment.
- `npm run lint:api-auth && npm run lint:action-origin` — passed.
- Final sweep commands included `rg` searches for TODO/FIXME/unchecked suppressions, risky process/env use, advisory locks, rollback patterns, and DB/health/sitemap paths.

## Findings

### C1-HIGH-01 — Per-target admin delete advisory lock can violate the “at least one admin remains” invariant

- **Severity:** High
- **Status:** Likely
- **Confidence:** High
- **Perspectives:** correctness, robustness, operational recovery, hidden coupling

**Evidence**

- `apps/web/src/app/actions/admin-users.ts:198-215` says deletion is serialized so concurrent requests cannot both observe more than one admin, but then scopes the lock to the **target user ID** via `getAdminDeleteLockName(id)`.
- `apps/web/src/lib/advisory-locks.ts:26-32` confirms the lock is intentionally `gallerykit_admin_delete:${userId}`, i.e. different target users use different MySQL advisory locks.
- `apps/web/src/app/actions/admin-users.ts:227-247` checks `SELECT COUNT(*) AS count FROM admin_users` and deletes the target in the same transaction, but it does not lock the full admin-user set or a shared sentinel row.
- `apps/web/src/app/actions/admin-users.ts:270-273` releases only the per-target advisory lock.

**Concrete failure scenario**

Two admin accounts exist: admin A and admin B. A has an active browser session targeting deletion of B; B has an active session targeting deletion of A. Because the lock names differ (`gallerykit_admin_delete:A` vs `gallerykit_admin_delete:B`), both transactions can proceed concurrently, both can read count `2`, and both can delete the other row. The system can be left with zero admin users, preventing normal administrative recovery.

The same class also appears with three admins: two concurrent deletes of different non-self targets can both read count `3` and leave only one admin, defeating the stated serialization goal.

**Suggested fix**

Use one global advisory lock for all admin deletion operations, or use a transactional row/table lock that protects the invariant (`SELECT ... FOR UPDATE` on a dedicated invariant row, or a global `gallerykit_admin_delete` advisory lock). Add a concurrent integration test that runs two deletes of different users and asserts at least one admin remains.

---

### C1-MED-01 — Public share-key lookup throttling is bypassed by `generateMetadata()` DB reads

- **Severity:** Medium
- **Status:** Confirmed
- **Confidence:** High
- **Perspectives:** product behavior, robustness, abuse resistance, observability, hidden coupling

**Evidence**

- `apps/web/src/lib/rate-limit.ts:57-64` documents the share-key lookup throttle for unauthenticated `/s/[key]` and `/g/[key]` routes at 60 requests/minute/IP because each lookup hits the DB.
- Single-photo share metadata deliberately skips the limiter and then queries by key: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-55`.
- The single-photo page body rate-limits later: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:101-114`.
- Group share metadata also skips the limiter and queries by key: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37-50`.
- The group page body rate-limits later: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-124`.
- The queried functions perform live DB work: `apps/web/src/lib/data.ts:873-906` for photo share keys and `apps/web/src/lib/data.ts:940-980` plus `apps/web/src/lib/data.ts:982-1025` for group share keys/images/tags.
- The source-contract test enshrines “no metadata limiter” rather than the intended route-wide behavior: `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:32-50`.

**Concrete failure scenario**

A bot requests thousands of random `/en/s/<base56>` or `/en/g/<base56>` URLs. After the page body exceeds 60/minute it returns `notFound()`, but `generateMetadata()` has already performed an unauthenticated DB lookup for every request. For valid keys, metadata can also reveal title/OG image data without consuming the lookup budget. The intended protection therefore does not cover the full request render path.

**Suggested fix**

Move share-key throttling to a route/middleware-level guard that runs before both metadata and page rendering, or make share metadata generic/no-DB and perform the only key lookup in the already-limited page body. If metadata needs DB data, use a request-scoped throttle/deduplication mechanism so metadata and page share one limiter increment and one fetch.

---

### C1-MED-02 — Docker production builds intentionally ignore `package-lock.json`, creating CI/deploy dependency drift

- **Severity:** Medium
- **Status:** Risk
- **Confidence:** High
- **Perspectives:** developer ergonomics, operational risk, correctness, supply chain/reproducibility

**Evidence**

- CI installs with the lockfile: `.github/workflows/quality.yml:48-49` runs `npm ci`.
- The Dockerfile explicitly copies only package manifests and omits the lockfile: `apps/web/Dockerfile:21-27`.
- The Dockerfile then resolves dependencies during image build with `npm install`: `apps/web/Dockerfile:29-36`.
- Runtime image startup uses the separately resolved production dependency tree: `apps/web/Dockerfile:72-75`.

**Concrete failure scenario**

A transitive dependency publishes a breaking patch, yanked optional package, or compromised package after CI passed against `package-lock.json`. A deployment image built later resolves a different tree with `npm install`, so production behavior can diverge from tested behavior even with the same Git SHA. This is especially risky here because native dependencies (`sharp`, `argon2`, Next/SWC optional packages) are part of the runtime/build path.

**Suggested fix**

Make Docker use a lockfile-based install (`npm ci`) and fix the platform optional-dependency issue directly. Options include regenerating/updating the lockfile with Linux optional packages represented, using `npm ci --include=optional`, building the lockfile in a Linux environment, or maintaining a deployment lockfile. Add a CI job that builds the Docker image so this path is tested.

---

### C1-LOW-01 — Existing photo share-link no-op path decrements counters that this request never incremented

- **Severity:** Low
- **Status:** Confirmed
- **Confidence:** High
- **Perspectives:** correctness, hidden coupling, abuse resistance

**Evidence**

- `createPhotoShareLink()` computes IP/bucket before validation: `apps/web/src/app/actions/sharing.ts:87-90`.
- It loads the image before any share-write rate-limit pre-increment: `apps/web/src/app/actions/sharing.ts:95-99`.
- If the image already has `share_key`, it calls full rollback and returns: `apps/web/src/app/actions/sharing.ts:100-105`.
- The actual in-memory and DB pre-increments occur only later: `apps/web/src/app/actions/sharing.ts:108-120`.
- Full rollback decrements both in-memory and DB buckets: `apps/web/src/app/actions/sharing.ts:55-75`.

**Concrete failure scenario**

An admin creates several new share links, consuming `share_photo` budget. The admin then repeatedly presses/calls “share” for an image that already has a share key. Each no-op call reaches `rollbackShareRateLimitFull()` without a corresponding increment from that call, restoring prior budget and permitting more than the documented 20 share creations/minute.

**Suggested fix**

Remove rollback from the already-shared pre-increment-free branch, or move the share-write pre-increment before the image lookup/no-op branch and keep rollback symmetry. Add a test that seeds a nonzero bucket, calls the already-shared path, and asserts the bucket is unchanged.

---

### C1-LOW-02 — Admin user creation rate limit does not throttle sequential successful creates

- **Severity:** Low
- **Status:** Confirmed
- **Confidence:** High
- **Perspectives:** product behavior, operational risk, docs-code mismatch

**Evidence**

- The action states the rate limit is to prevent brute-force / CPU DoS: `apps/web/src/app/actions/admin-users.ts:113-125`.
- It pre-increments both in-memory and DB rate-limit counters: `apps/web/src/app/actions/admin-users.ts:126-130`.
- After a successful Argon2 hash and insert, it rolls back the same attempt: `apps/web/src/app/actions/admin-users.ts:137-155`.
- The test suite explicitly asserts rollback after successful creation: `apps/web/src/__tests__/admin-users.test.ts:150-161`.

**Concrete failure scenario**

With a valid admin session, a client can create many unique admin users sequentially. Each request performs an expensive Argon2 hash and a DB insert, then rolls back the rate-limit counters, so the 10/hour budget only protects concurrent in-flight bursts, not sustained sequential abuse or an accidental automation loop.

**Suggested fix**

Clarify the intended product behavior. If the limit is meant to be a real hourly budget, charge successful creates and only roll back malformed/duplicate/infrastructure failures as appropriate. If the limit is intentionally only an in-flight CPU burst guard, rename comments/messages/tests to avoid implying a 10/hour create budget and consider a separate quota on created users per hour/day.

---

### C1-LOW-03 — Build and default health behavior can mask DB misconfiguration until user traffic hits DB-backed pages

- **Severity:** Low
- **Status:** Confirmed
- **Confidence:** Medium
- **Perspectives:** operational risk, observability, docs-code mismatch

**Evidence**

- Runtime DB pool creation accepts undefined credentials/database fields: `apps/web/src/db/index.ts:13-25`.
- `sitemap()` catches all DB errors and emits a homepage-only sitemap: `apps/web/src/app/sitemap.ts:24-46`.
- `/api/health` skips DB probing unless `HEALTH_CHECK_DB=true`: `apps/web/src/app/api/health/route.ts:18-25`; `/api/live` always returns ok: `apps/web/src/app/api/live/route.ts:1-9`.
- `ensure-site-config` fail-fast checks cover `site-config.json` and `BASE_URL`, not DB readiness: `apps/web/scripts/ensure-site-config.mjs:6-42`.
- Documentation correctly lists DB env as required for setup (`README.md:115-148`, `apps/web/.env.local.example:1-7`) and says health is liveness-only (`README.md:178-179`, `apps/web/README.md:40`), but the default operational signal can still be green while DB-backed pages fail.
- Local `npm run build` in this review passed while logging `[sitemap] falling back to homepage-only sitemap` with MySQL `ER_NO_DB_ERROR: No database selected`.

**Concrete failure scenario**

An operator runs `next build`/`next start` or a non-Docker deployment with `BASE_URL` set but `DB_NAME` missing. Build passes, `/api/live` and default `/api/health` return ok, and only sitemap warnings/logs indicate trouble. Public pages, admin login, and uploads then fail on first real DB access.

**Suggested fix**

Add an explicit production readiness mode or startup validation that fails when required DB env is absent, while preserving intentional DB-less Docker build behavior via an opt-in such as `ALLOW_DB_LESS_BUILD=true`. Alternatively make the deploy docs and default health check safer by recommending/setting `HEALTH_CHECK_DB=true` for private readiness probes and exposing a clear startup log banner when DB env is incomplete.

---

### C1-LOW-04 — Upload action comment contradicts the current schema/migration foreign-key enforcement

- **Severity:** Low
- **Status:** Confirmed
- **Confidence:** High
- **Perspectives:** docs-code mismatch, developer ergonomics, hidden coupling

**Evidence**

- Upload action comment says `images.topic` is varchar without a foreign-key constraint: `apps/web/src/app/actions/images.ts:239-243`.
- Current Drizzle schema declares `images.topic` as a non-null FK to `topics.slug` with `onDelete: 'restrict'`: `apps/web/src/db/schema.ts:16-31`.
- Runtime migration script also ensures the FK exists: `apps/web/scripts/migrate.js:448-456`.

**Concrete failure scenario**

A future maintainer reads the upload action comment and assumes the application-level topic existence check is the only orphan-prevention mechanism. They may weaken migration/FK handling or mis-triage a production FK error as impossible, increasing the chance of schema/action drift.

**Suggested fix**

Update the comment to say the application-level existence check provides a friendly pre-insert error and races are still protected by the database FK. Keep the DB FK as the source-of-truth invariant.

## Final missed-issues sweep

- Searched for TODO/FIXME/XXX/HACK, `@ts-ignore`, `@ts-expect-error`, and broad `eslint-disable` suppressions. No untriaged high-risk suppressions found; existing suppressions are localized and documented.
- Searched risky execution/process patterns (`spawn`, `child_process`, advisory `GET_LOCK`, raw `SELECT COUNT(*)`, rollback helpers). This sweep produced the admin-delete lock finding and the share/admin-user rollback findings above. DB restore/backup spawn paths sanitize passwords in stderr and use argument arrays rather than shell strings.
- Searched environment-variable usage and compared against docs/examples. Main residual operational risk is DB readiness/build-health behavior described in C1-LOW-03.
- Rechecked unauthenticated/public surfaces (`/s`, `/g`, `/api/og`, sitemap, public search/load-more). `/api/og` and public search have explicit in-memory throttles; the missed route-wide coverage is the share metadata path in C1-MED-01.
- Rechecked admin mutation origin/auth gates via the dedicated lint gates; both passed. Read-only exemptions are explicitly annotated.
- Rechecked upload/static-file path traversal protections. `serve-upload` constrains roots/extensions, rejects symlink escapes, and serves only known derivative directories; no new issue recorded.
- Rechecked DB restore SQL scanning at a source level. The restore path has size limits, maintenance mode, a dedicated advisory lock, mysql CLI TLS handling, and dangerous-statement scanning; no higher-confidence new issue recorded in this pass.

## Finding counts by severity

- **High:** 1
- **Medium:** 2
- **Low:** 4
- **Total:** 7
