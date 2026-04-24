# Document Specialist Review — Cycle 1 / Prompt 1 (2026-04-24)

## Scope and inventory covered

Built the inventory from tracked files plus a final grep sweep, excluding generated/dependency/history surfaces that are not authoritative product docs (`node_modules/`, `.next/`, `package-lock.json`, `*.tsbuildinfo`, `.omx/`, `.omc/`, and historical `.context/**` / `plan/**` artifacts except this output file).

Authoritative surfaces reviewed in full or by targeted line audit:

- Root docs and instructions: `README.md`, `CLAUDE.md`, `AGENTS.md`, `.agent/rules/commit-and-push.md`.
- App docs and examples: `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`.
- Package/script contracts: `package.json`, `apps/web/package.json`, `.nvmrc`, `.vscode/tasks.json`, `.vscode/launch.json`.
- Docker/deploy/proxy contracts: `.dockerignore`, `apps/web/.dockerignore`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/nginx/default.conf`.
- CI/config docs: `.github/workflows/quality.yml`, `.github/dependabot.yml`, `apps/web/drizzle.config.ts`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`.
- Code behavior and invariant-comment sweep: `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/e2e/**`, with focused reads of auth/bootstrap, upload limits, image processing, storage, route auth scanners, DB restore/backup, nginx/static serving, sitemap/cache comments, and privacy/public-query code.

Final missed-doc sweep commands included repository doc/config inventory, uppercase env-token comparison, and invariant-comment search (`must`/`never`/`only`/`source of truth`/`fail closed`/`not yet`/`legacy`/`S3`/`MinIO`/`TODO`/`FIXME`) across the authoritative surfaces above.

## Findings summary

| ID | Severity | Confidence | Summary |
| --- | --- | --- | --- |
| DOC-001 | High | High | Docker/`npm run init` bootstrap docs allow precomputed Argon2 admin hashes, but `migrate.js` hashes them again. |
| DOC-002 | Medium | High | Host-nginx deployment docs conflict with nginx config's container-internal upload root. |
| DOC-003 | Medium | High | `UPLOAD_MAX_FILES_PER_WINDOW` is documented as an env override but is hard-coded. |
| DOC-004 | Medium | High | DB security docs claim all queries use Drizzle, but runtime has documented raw MySQL/CLI exceptions. |
| DOC-005 | Low | High | `SHARP_CONCURRENCY` default is documented as CPU count minus 2, code uses CPU count minus 1. |
| DOC-006 | Low | High | Remote admin Playwright docs omit required `E2E_ADMIN_ENABLED=true`. |
| DOC-007 | Low | High | `CLAUDE.md` points implementers at `src/app/actions.ts` as the server-action implementation file, but it is now a barrel. |
| DOC-008 | Low | Medium | Cache/ISR comments are internally contradictory around homepage/sitemap behavior. |
| DOC-009 | Low | High | Storage comments still describe S3/MinIO semantics despite the local-only storage contract. |

## Findings

### DOC-001 — Precomputed Argon2 bootstrap hashes are documented but broken on the automatic migration path

- **Severity:** High
- **Confidence:** High
- **Docs:**
  - `README.md:121` shows `ADMIN_PASSWORD=<strong-16+-char-secret-or-argon2-hash>`.
  - `README.md:139` says to prefer a generated secret or a precomputed Argon2 hash for bootstrap auth.
  - `CLAUDE.md:78` documents `ADMIN_PASSWORD=<strong-16+-char-secret-or-argon2-hash>`.
  - `apps/web/.env.local.example:21-23` says `ADMIN_PASSWORD` may be a plaintext secret or a precomputed Argon2 hash.
- **Code behavior:**
  - `apps/web/Dockerfile:85-86` starts production by running `node apps/web/scripts/migrate.js`.
  - `apps/web/scripts/init-db.ts:24-30` also delegates `npm run init` to `node scripts/migrate.js`.
  - `apps/web/scripts/migrate.js:111-117` accepts `$argon2...` values as valid, but `apps/web/scripts/migrate.js:511-518` then unconditionally runs `argon2.hash(password, ...)` and stores the result.
  - The older/manual `apps/web/scripts/seed-admin.ts:40-55` does the documented behavior correctly by storing `$argon2...` values as-is, which proves the migration path is the inconsistent one.
- **Failure scenario:** An operator follows the README/env example, sets `ADMIN_PASSWORD` to a precomputed Argon2 hash, and deploys with Docker or `npm run init`. The first admin row is created with a hash of the hash string. Logging in with the intended plaintext password fails; only typing the hash string as the password would match.
- **Fix:** Make `migrate.js` mirror `seed-admin.ts`: if `ADMIN_PASSWORD.startsWith('$argon2')`, store it directly; otherwise validate and hash the plaintext. Add/extend a regression test or script-level fixture for both plaintext and pre-hashed bootstrap inputs. If pre-hashed bootstrap is not meant to be supported on automatic migrations, remove that promise from all docs/examples instead.

### DOC-002 — Shipped nginx config does not match the documented host-network + host-nginx deployment

- **Severity:** Medium
- **Confidence:** High
- **Docs/config claims:**
  - `README.md:136` refers to the documented host-network + nginx deployment.
  - `README.md:166` tells operators to publish the localhost-bound app through a reverse proxy.
  - `apps/web/docker-compose.yml:10-12` says host networking is used and the nginx reverse proxy on the host handles rate limiting/security headers.
- **Code/config behavior:**
  - `apps/web/docker-compose.yml:1-22` defines only the `web` service; there is no nginx container that would naturally have `/app/apps/web/public` mounted.
  - `apps/web/docker-compose.yml:19-22` mounts the host `./public` directory into the web container at `/app/apps/web/public`.
  - `apps/web/nginx/default.conf:89-95` serves uploads directly from `root /app/apps/web/public`, which is a container-internal-looking path, not the host repo path described by the compose comments.
- **Failure scenario:** An operator copies the shipped `apps/web/nginx/default.conf` into host nginx while using the documented compose file. Proxied app pages work, but direct nginx-served uploads resolve under `/app/apps/web/public/uploads/...`; unless the host happens to have that exact path, image requests handled by the nginx static location return 404.
- **Fix:** Either (a) make the nginx config explicitly host-oriented (document/parameterize a root such as `/srv/gallery/apps/web/public` and align `.env.deploy.example` / README), or (b) add/document an nginx container/service that mounts `apps/web/public` at `/app/apps/web/public`. Avoid presenting the current config as a drop-in host-nginx file without a path substitution step.

### DOC-003 — `UPLOAD_MAX_FILES_PER_WINDOW` is documented as configurable but code ignores the env var

- **Severity:** Medium
- **Confidence:** High
- **Docs:** `CLAUDE.md:207-210` documents max upload size and says the batch file-count cap is `UPLOAD_MAX_FILES_PER_WINDOW`, default 100.
- **Code behavior:**
  - `apps/web/src/app/actions/images.ts:56-61` declares `const UPLOAD_MAX_FILES_PER_WINDOW = 100` directly.
  - `apps/web/src/app/actions/images.ts:119-120` also hard-caps a single request at 100 files.
  - `apps/web/src/app/actions/images.ts:145-146` enforces the cumulative tracker against that hard-coded constant.
  - `apps/web/src/lib/upload-limits.ts:3-10` parses `UPLOAD_MAX_TOTAL_BYTES` from env, but there is no equivalent parser for `UPLOAD_MAX_FILES_PER_WINDOW`.
- **Failure scenario:** An operator reads `CLAUDE.md`, sets `UPLOAD_MAX_FILES_PER_WINDOW=500`, and expects larger admin batches. The app still rejects once the hard-coded 100-file window is exceeded.
- **Fix:** Implement a validated env parser for `UPLOAD_MAX_FILES_PER_WINDOW` and use it for both the per-call and cumulative checks, or update `CLAUDE.md` to state that the file-count cap is fixed at 100 and only the byte cap is configurable.

### DOC-004 — DB security docs overstate the “all queries via Drizzle” invariant

- **Severity:** Medium
- **Confidence:** High
- **Docs:** `CLAUDE.md:141-147` says “All queries via Drizzle ORM (parameterized, no raw SQL with user input).”
- **Code behavior:**
  - `apps/web/src/app/actions/admin-users.ts:217-245` uses `connection.getConnection()` and multiple `conn.query(...)` calls for the admin-delete advisory lock and transaction.
  - `apps/web/src/app/actions/topics.ts:37-53` uses `conn.query(...)` for topic-route advisory locks.
  - `apps/web/src/lib/image-queue.ts:135-158` uses a raw `SELECT GET_LOCK(?, 0)` / `RELEASE_LOCK(?)` pair for per-image processing claims.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:136-143` shells out to `mysqldump`, and `apps/web/src/app/[locale]/admin/db-actions.ts:405-410` shells out to `mysql --one-database` for restore.
- **Failure scenario:** A maintainer or auditor relies on the absolute Drizzle-only statement and misses the real exception surface: advisory-lock queries, explicit transactions, migration/backup/restore paths, and CLI SQL execution. That makes future review checklists incomplete even though many of these exceptions are intentional and parameterized/hard-coded.
- **Fix:** Rewrite the invariant to match reality, for example: “Application CRUD generally uses Drizzle and request-derived SQL values must be parameterized. Documented exceptions use lower-level MySQL APIs or CLI tools for advisory locks, explicit transactions, migrations, backups, and restores.” Add a short exception list with the files above.

### DOC-005 — `SHARP_CONCURRENCY` default in the env example is off by one CPU

- **Severity:** Low
- **Confidence:** High
- **Docs:** `apps/web/.env.local.example:30-32` says `SHARP_CONCURRENCY` defaults to CPU count minus 2.
- **Code behavior:** `apps/web/src/lib/process-image.ts:16-23` computes `maxConcurrency = Math.max(1, cpuCount - 1)` and uses that default when `SHARP_CONCURRENCY` is unset.
- **Failure scenario:** An operator sizes CPU/memory headroom from the example and expects two cores to remain free for the app, but Sharp is configured to leave only one logical CPU by default.
- **Fix:** Update the example comment to “default: CPU count - 1” or change the code to the documented CPU count - 2 behavior.

### DOC-006 — Remote admin Playwright docs omit `E2E_ADMIN_ENABLED=true`

- **Severity:** Low
- **Confidence:** High
- **Docs:**
  - `apps/web/README.md:33-34` says to set `E2E_ADMIN_PASSWORD` for hashed-admin flows and `E2E_ALLOW_REMOTE_ADMIN=true` for remote admin Playwright runs.
  - `apps/web/.env.local.example:24-27` lists `E2E_ADMIN_PASSWORD` and `E2E_ALLOW_REMOTE_ADMIN` but not `E2E_ADMIN_ENABLED`.
- **Code behavior:**
  - `apps/web/e2e/helpers.ts:27-44` auto-enables admin E2E only for local non-production runs with plaintext credentials, or when `E2E_ADMIN_ENABLED=true` is explicitly set.
  - `apps/web/e2e/helpers.ts:50-57` then requires `E2E_ALLOW_REMOTE_ADMIN=true` and a plaintext `E2E_ADMIN_PASSWORD` for non-local origins.
  - `apps/web/e2e/admin.spec.ts:6-8` skips the whole admin suite when `adminE2EEnabled` is false, with a message to set `E2E_ADMIN_ENABLED=true`.
- **Failure scenario:** A developer sets `E2E_BASE_URL` to a remote target plus `E2E_ALLOW_REMOTE_ADMIN=true` and `E2E_ADMIN_PASSWORD=...` as documented, then runs Playwright. The admin suite is still skipped because `E2E_ADMIN_ENABLED=true` was not documented.
- **Fix:** Update `apps/web/README.md` and `.env.local.example` to state that remote admin E2E requires all three: `E2E_ADMIN_ENABLED=true`, `E2E_ALLOW_REMOTE_ADMIN=true`, and `E2E_ADMIN_PASSWORD=<plaintext dedicated test password>`.

### DOC-007 — `CLAUDE.md` still describes `src/app/actions.ts` as the action implementation file

- **Severity:** Low
- **Confidence:** High
- **Docs:**
  - `CLAUDE.md:25-31` shows `src/app/actions.ts` under App Router as “Server actions (uploads, CRUD)”.
  - `CLAUDE.md:88-91` labels `apps/web/src/app/actions.ts` as “Server actions for uploads, image CRUD, auth, session management”.
- **Code behavior:**
  - `apps/web/src/app/actions.ts:1-3` says it is a barrel re-export and that each action module has its own `'use server'` directive.
  - `apps/web/src/app/actions.ts:4-30` only re-exports implementations from `apps/web/src/app/actions/*.ts`.
  - The action-origin scanner’s documented and actual scope is the module directory plus DB actions (`CLAUDE.md:236-243`, `apps/web/scripts/check-action-origin.ts:13-21`, `apps/web/scripts/check-action-origin.ts:82-93`).
- **Failure scenario:** A future assistant or maintainer follows the stale key-file table and adds a mutating implementation to the barrel file instead of `apps/web/src/app/actions/`. That is inconsistent with the `'use server'` module pattern and outside the scanner’s action-file discovery scope.
- **Fix:** Change the structure/key-file entries to `apps/web/src/app/actions/` for implementations and describe `apps/web/src/app/actions.ts` as a compatibility barrel only.

### DOC-008 — Homepage/sitemap cache comments are contradictory enough to mislead future cache changes

- **Severity:** Low
- **Confidence:** Medium
- **Docs/comments:**
  - `CLAUDE.md:193-199` documents ISR caching for photo pages, topic/home pages, and force-dynamic admin pages.
  - `apps/web/src/app/[locale]/(public)/page.tsx:12-16` says the homepage is dynamic and suggests sticking to force-dynamic/standard behavior, then immediately exports `revalidate = 3600`.
  - `apps/web/src/app/sitemap.ts:4-6` says “ISR: revalidate daily; force-dynamic required because DB isn't available at build time” while exporting both `dynamic = 'force-dynamic'` and `revalidate = 86400`.
- **Code behavior:** The homepage code matches the external doc’s one-hour `revalidate`, but the inline comment still reads like an abandoned deliberation. The sitemap comment asserts both daily ISR and forced dynamic execution in the same region, so the intended runtime contract is ambiguous from the code.
- **Failure scenario:** A maintainer debugging freshness or DB load can make the wrong change because comments do not clearly say whether each route is intended to be cached, dynamic, or merely prevented from static build-time DB access.
- **Fix:** Replace deliberative comments with declarative contracts. For the homepage, say it uses one-hour ISR and is manually revalidated after mutations if that is intended. For the sitemap, choose and document one contract: daily cached sitemap, or forced dynamic sitemap because DB access at build time is unavailable.

### DOC-009 — Storage interface comments still advertise S3/MinIO semantics despite the local-only contract

- **Severity:** Low
- **Confidence:** High
- **Docs:** `CLAUDE.md:99` says the storage abstraction exists but the product currently supports local filesystem storage only, and warns not to document or expose S3/MinIO switching until the pipeline is wired end-to-end.
- **Code/comments:**
  - `apps/web/src/lib/storage/index.ts:23-25` defines the backend type as only `'local'`.
  - `apps/web/src/lib/storage/index.ts:37-40` initializes `LocalStorageBackend`, and `apps/web/src/lib/storage/index.ts:102` also constructs `LocalStorageBackend` when switching.
  - `apps/web/src/lib/storage/types.ts:11-16` describes S3/MinIO key mapping, `apps/web/src/lib/storage/types.ts:36-39` describes presigned URL parameters as “S3/MinIO only”, and `apps/web/src/lib/storage/types.ts:97-99` says S3/MinIO returns presigned/public URLs.
- **Failure scenario:** A developer reading the type comments can infer that an S3/MinIO backend is present or partially supported, contradicting the higher-level local-only warning and increasing the chance of documenting or exposing a nonfunctional backend.
- **Fix:** Keep the interface generic but remove backend-specific S3/MinIO behavior from comments until an implementation exists, or mark it explicitly as future design notes not current behavior.

## Final missed-doc sweep

- Re-ran authoritative inventory excluding generated/dependency/history files.
- Re-ran env-token grep for documented variables (`ADMIN_PASSWORD`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`, `TRUST_PROXY`, `E2E_*`, deploy vars) against code/config.
- Re-ran invariant-comment grep across `README.md`, `CLAUDE.md`, `AGENTS.md`, `apps/web/README.md`, env examples, Docker/deploy/CI files, `apps/web/src/**`, `apps/web/scripts/**`, and `apps/web/e2e/**`.
- No additional confirmed authoritative doc/code mismatches were found beyond DOC-001 through DOC-009.
