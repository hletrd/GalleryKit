# Architect Review — Cycle 1

Date: 2026-05-02  
Role: architect  
Scope: architectural/design risks, coupling, layering, boundaries, single-instance assumptions, data contracts, Next.js App Router conventions, storage abstractions, deployment topology, and future-change hazards.

## Review method

- Started with `omx explore --prompt ...` to inventory architecture-relevant surfaces.
- Inspected line-numbered source for every file category listed below.
- Performed a missed-issues sweep with:
  - `rg "single-instance|single-writer|process-local|globalThis|in-memory|GET_LOCK|network_mode|public/uploads|UPLOAD_ROOT|LOCALES|\[a-z\]\{2\}" ...`
  - `rg "UPLOAD_DIR|UPLOAD_ROOT|createReadStream|createWriteStream|fs\.(write|read|copy|rename|unlink|mkdir|rm|readdir|opendir|stat|access|link)" ...`
  - `rg "export .* (GET|POST|PUT|PATCH|DELETE)|withAdminAuth" apps/web/src/app/api ...`
- Application code was not edited; only this report file was written.

## Architecture inventory examined

### Root, deployment, config, and scripts
- `package.json`, `package-lock.json`, `.env.deploy.example`, `README.md`, `CLAUDE.md`
- `apps/web/package.json`, `apps/web/README.md`, `apps/web/.env.local.example`
- `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/tsconfig*.json`
- `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`
- `apps/web/scripts/check-action-origin.ts`, `check-api-auth.ts`, `ensure-site-config.mjs`, `entrypoint.sh`, `init-db.ts`, `migrate*.ts/js`, `mysql-connection-options.js`, `prepare-next-typegen.mjs`, `run-e2e-server.mjs`, `seed-*.ts`
- `.github/workflows/quality.yml`, `.github/dependabot.yml`

### App Router, actions, routes, and UI boundary surfaces
- All `apps/web/src/app/**` files, including localized layouts/pages, admin protected pages, server actions, API routes, metadata routes (`manifest`, `robots`, `sitemap`, icon routes), `global-error.tsx`, and upload routes.
- Client/server boundary components that import actions or encode route/data contracts: `upload-dropzone.tsx`, `image-manager.tsx`, `photo-viewer.tsx`, `search.tsx`, `load-more.tsx`, `admin-header.tsx`, `admin-user-manager.tsx`, admin `topic-manager.tsx`, admin `tag-manager.tsx`, settings/SEO/password clients.

### Data, auth, storage, queueing, and domain libraries
- `apps/web/src/db/index.ts`, `schema.ts`, `seed.ts`
- `apps/web/src/proxy.ts`, `instrumentation.ts`, `i18n/request.ts`, `site-config.example.json`
- All architecture-relevant `apps/web/src/lib/**`: `data.ts`, `session.ts`, `api-auth.ts`, `action-guards.ts`, `request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `restore-maintenance.ts`, `advisory-locks.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `gallery-config*.ts`, `image-queue.ts`, `queue-shutdown.ts`, `process-image.ts`, `process-topic-image.ts`, `upload-paths.ts`, `upload-limits.ts`, `upload-tracker*.ts`, `storage/*`, `serve-upload.ts`, `validation.ts`, `sanitize.ts`, `revalidation.ts`, `locale-path.ts`, `content-security-policy.ts`, `csp-nonce.ts`, and small shared data-contract helpers.

### Contract tests examined
- Source-contract and boundary tests: `shared-route-rate-limit-source.test.ts`, `sharing-source-contracts.test.ts`, `client-source-contracts.test.ts`, `settings-image-sizes-lock.test.ts`, `restore-upload-lock.test.ts`, `next-config.test.ts`, `nginx-config.test.ts`, `action-guards.test.ts`, `check-action-origin.test.ts`, `check-api-auth.test.ts`, plus db/storage/rate-limit/queue/public/action tests relevant to the findings below.

## Findings

### HIGH-01 — Share-route rate limiting does not protect `generateMetadata` DB lookups

- **Severity:** High
- **Status:** confirmed
- **Confidence:** High
- **Evidence:**
  - The single-photo share page intentionally skips rate limiting in `generateMetadata`, then fetches the share row: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-55`.
  - The same page only rate-limits in the page body after metadata has already run: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:101-113`.
  - The group share page has the same shape: metadata fetch at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37-50`, body rate-limit at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-121`.
  - The test locks this tradeoff in as intentional: `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:32-50`.
  - The share-key limiter itself is an in-memory public unauthenticated anti-enumeration control: `apps/web/src/lib/rate-limit.ts:57-65`, `apps/web/src/lib/rate-limit.ts:228-244`.
- **Failure scenario:** A bot requests many random `/en/s/<key>` or `/en/g/<key>` URLs. For each full App Router render, `generateMetadata` performs the DB share lookup before the page body can return `notFound()` for over-limit clients. The page body is throttled, but the expensive unauthenticated key-probing query remains unthrottled.
- **Suggested fix:** Move share-key throttling to a layer that runs before metadata and page rendering, e.g. `src/proxy.ts` for `/[locale]/(s|g)/...`, or make share pages emit generic no-DB metadata and perform the protected lookup only in the page body. If per-route metadata must remain specific, use a request-level route handler/proxy gate so metadata and body share one pre-render authorization/rate-limit decision without double-incrementing.

### HIGH-02 — Restore/maintenance coordination is process-local while future scaling paths are easy to enable accidentally

- **Severity:** High
- **Status:** risk
- **Confidence:** High
- **Evidence:**
  - The repo documents a single writer topology and says restore maintenance, upload quotas, and queue state are process-local: `README.md:146-148`; `CLAUDE.md:160`.
  - Compose enforces a single host-networked container by convention, not by an app-level invariant: `apps/web/docker-compose.yml:10-24`.
  - Restore maintenance state lives in `globalThis` inside one Node process only: `apps/web/src/lib/restore-maintenance.ts:1-22`.
  - `restoreDatabase()` sets that local flag around restore: `apps/web/src/app/[locale]/admin/db-actions.ts:310-343`.
  - Other mutation/read surfaces consult only that process-local flag before proceeding, e.g. upload at `apps/web/src/app/actions/images.ts:117-129`, load-more/search at `apps/web/src/app/actions/public.ts:75-76` and `apps/web/src/app/actions/public.ts:152-154`, and health at `apps/web/src/app/api/health/route.ts:7-18`.
  - Upload quota state is also process-local: `apps/web/src/lib/upload-tracker-state.ts:7-20`, consumed by upload at `apps/web/src/app/actions/images.ts:172-184`.
- **Failure scenario:** An operator later runs two web replicas for zero-downtime deploys or load balancing. Replica A starts DB restore and drops/recreates tables while setting only its local maintenance flag. Replica B continues to pass `getRestoreMaintenanceMessage()` checks, can accept admin mutations or public read/query work, and its `/api/health` can still report healthy. The upload path has an advisory lock, but tags/topics/settings/deletes/public reads are not uniformly gated by a shared maintenance lease.
- **Suggested fix:** Promote restore/maintenance to a shared coordination primitive: a DB row/lease or advisory-lock-backed `isMaintenanceActive()` checked by every mutating action, public expensive action, queue bootstrap, and health/readiness. If horizontal scaling remains unsupported, add a startup/deploy guard and documentation that make singleton deployment an enforced invariant rather than a comment.

### HIGH-03 — Production Docker builds are not reproducible because the lockfile is intentionally omitted

- **Severity:** High
- **Status:** confirmed
- **Confidence:** High
- **Evidence:**
  - The Dockerfile copies only package manifests and explicitly excludes the lockfile: `apps/web/Dockerfile:21-30`.
  - Production dependencies are also installed without the lockfile: `apps/web/Dockerfile:32-36`.
  - The workspace package uses semver ranges for core runtime dependencies such as Next, React, Drizzle, mysql2, sharp, etc.: `apps/web/package.json:38-58`.
  - The tested repository does include a root lockfile (`package-lock.json`) and local `npm run build/test` uses it outside Docker.
- **Failure scenario:** CI/test passes against the checked-in lockfile, but a later Docker build resolves a newer allowed Next/React/Drizzle/sharp patch or transitive package. Server Actions, App Router metadata, native image processing, or migration behavior can change only in production images, making rollback and incident reproduction difficult.
- **Suggested fix:** Make Docker use a deterministic install (`npm ci --workspace=apps/web`) from a lockfile that includes Linux optional/native packages. If macOS lockfile generation is the blocker, generate/refresh the lockfile in CI/Linux or use npm settings that preserve optional platform entries instead of dropping the lockfile from production builds.

### MEDIUM-01 — The storage abstraction is not the actual upload/storage boundary

- **Severity:** Medium
- **Status:** confirmed
- **Confidence:** High
- **Evidence:**
  - The storage interface itself states that live upload, processing, and public-serving paths still use direct filesystem helpers: `apps/web/src/lib/storage/types.ts:1-15`.
  - The singleton module repeats that production paths do not read from the abstraction yet: `apps/web/src/lib/storage/index.ts:1-12`.
  - The upload pipeline writes originals directly via `UPLOAD_DIR_ORIGINAL` and `createWriteStream`: `apps/web/src/lib/process-image.ts:12-15`, `apps/web/src/lib/process-image.ts:329-352`.
  - Processing writes derived images directly to filesystem directories: `apps/web/src/lib/process-image.ts:441-542`; queue verification/deletion also uses direct paths: `apps/web/src/lib/image-queue.ts:268-331`.
  - The app serving route reads direct filesystem paths: `apps/web/src/lib/serve-upload.ts:63-105`.
  - nginx can bypass Node and serve `/uploads` directly from `/app/apps/web/public`: `apps/web/nginx/default.conf:139-160`.
- **Failure scenario:** A future S3/MinIO/CDN backend is added behind `StorageBackend` and `switchStorageBackend()`. Explicit `getStorage()` callers work, but actual uploads still land on local disk, image processing still reads local paths, deletes scan local directories, and nginx still points at a local web root. Operators believe storage has migrated while production keeps two divergent sources of truth.
- **Suggested fix:** Treat `StorageBackend` as experimental until the end-to-end pipeline is migrated. Introduce a single `ImageStorageService` used by upload, processing, delete, serve, and URL generation; make nginx direct-serving a named local-backend optimization with parity tests against the Node route.

### MEDIUM-02 — Auth/API layering is inverted through App Router server-action modules

- **Severity:** Medium
- **Status:** confirmed
- **Confidence:** High
- **Evidence:**
  - `lib/api-auth.ts` imports `isAdmin` from an App Router server action module: `apps/web/src/lib/api-auth.ts:1-5`.
  - The auth module is itself a `'use server'` action file and exports both action entry points and auth services: `apps/web/src/app/actions/auth.ts:1-22`, `apps/web/src/app/actions/auth.ts:22-55`.
  - Other action modules import auth helpers from the action layer rather than a lower-level auth service, e.g. `apps/web/src/app/actions/images.ts:11`, `apps/web/src/app/actions/settings.ts:7`, `apps/web/src/app/actions/topics.ts:28`, `apps/web/src/app/actions/tags.ts:7`.
  - The public action barrel re-exports both auth helpers and all mutation actions to support client imports: `apps/web/src/app/actions.ts:1-30`; client components import from this barrel, e.g. `apps/web/src/components/upload-dropzone.tsx:1-8`, `apps/web/src/components/image-manager.tsx:1-5`, `apps/web/src/components/photo-viewer.tsx:1-17`.
- **Failure scenario:** A new API route, background job, or library imports `@/lib/api-auth` or `@/app/actions/auth` for a simple auth check and unintentionally couples itself to Server Action compilation semantics, request cookies/headers, and a broad action manifest. Refactoring auth then requires changing app actions, API route wrappers, and client import barrels together.
- **Suggested fix:** Move request-scoped auth services (`getSession`, `getCurrentUser`, `isAdmin`) into a server-only library such as `src/lib/server-auth.ts`. Keep `app/actions/auth.ts` as thin Server Action wrappers for login/logout/password changes, and have API routes/actions import the lower-level service rather than importing across App Router action boundaries.

### MEDIUM-03 — Schema/table contracts are duplicated across four layers

- **Severity:** Medium
- **Status:** confirmed
- **Confidence:** High
- **Evidence:**
  - Canonical Drizzle schema defines the table set: `apps/web/src/db/schema.ts:4-145`.
  - Drizzle config points migrations at that schema: `apps/web/drizzle.config.ts:6-12`.
  - Restore scanning maintains a separate hard-coded app table allow-list: `apps/web/src/lib/sql-restore-scan.ts:2-21`.
  - The startup migration script embeds its own legacy schema reconciliation DDL for the same tables and indexes/FKs: `apps/web/scripts/migrate.js:247-464`.
- **Failure scenario:** A future `albums` or `collections` table is added to `schema.ts` and migrations. If `APP_BACKUP_TABLES` is not updated, a normal mysqldump containing `DROP TABLE IF EXISTS albums` is rejected by restore scanning. If `migrate.js` is not updated, legacy installs baseline without the new compatibility DDL/index/FK path. The data model then depends on which install/restore path an operator used.
- **Suggested fix:** Generate or centralize a table/constraint manifest consumed by the restore scanner, legacy migrator, and tests. Add a contract test that derives expected table names from `schema.ts` and fails if `APP_BACKUP_TABLES` or legacy reconciliation drift.

### MEDIUM-04 — Locale support is centralized in TypeScript but hard-coded as two lowercase letters in proxy/nginx

- **Severity:** Medium
- **Status:** risk
- **Confidence:** High
- **Evidence:**
  - Locales are a shared TypeScript constant today: `apps/web/src/lib/constants.ts:1-4`.
  - App code iterates `LOCALES` in several places, e.g. proxy route checks: `apps/web/src/proxy.ts:55-75`.
  - The same proxy falls back to hard-coded two-letter extraction for login redirects: `apps/web/src/proxy.ts:91-115`.
  - nginx rate-limit/body-limit/upload locations use `(/[a-z]{2})?` and strip only two-letter locale prefixes: `apps/web/nginx/default.conf:57-60`, `apps/web/nginx/default.conf:74-77`, `apps/web/nginx/default.conf:91-94`, `apps/web/nginx/default.conf:107-110`, `apps/web/nginx/default.conf:146-149`.
  - The nginx contract test also locks the two-letter regex: `apps/web/src/__tests__/nginx-config.test.ts:14-19`.
- **Failure scenario:** Adding `en-US`, `pt-BR`, or `zh-Hant` to `LOCALES` works in Next/next-intl helpers but misses nginx admin upload/restore limits and static upload rewriting, and proxy login redirects may not preserve the route locale. A security/rate-limit rule becomes locale-dependent.
- **Suggested fix:** Generate locale regexes from `LOCALES` for runtime code and deployment templates, or explicitly document that locale identifiers are restricted to `[a-z]{2}` and enforce that with a test on `LOCALES` plus generated nginx snippets.

### MEDIUM-05 — Startup migrations are coupled to app boot and lack a cross-process migration lock

- **Severity:** Medium
- **Status:** risk
- **Confidence:** Medium
- **Evidence:**
  - The container command runs migrations immediately before starting the Next server: `apps/web/Dockerfile:90-94`.
  - `migrate.js` connects and runs legacy reconciliation, Drizzle migrations, and admin seeding in the startup process: `apps/web/scripts/migrate.js:525-542`.
  - The inspected migration script has no `GET_LOCK` / `RELEASE_LOCK` coordination, while advisory locks are centralized for other cross-process operations: `apps/web/src/lib/advisory-locks.ts:17-39`.
- **Failure scenario:** During a rolling deploy or accidental second replica, two containers can run startup DDL/Drizzle migration/seeding concurrently against the same database. Depending on MySQL DDL timing and Drizzle migration table writes, one instance can fail startup or leave partially applied compatibility DDL while the other starts serving.
- **Suggested fix:** Run migrations as a single external deployment job, or wrap the entire startup migration/seed sequence in a MySQL advisory lock whose name is instance/database-scoped. Keep the app server start separate from schema mutation where possible.

### LOW-01 — Upload/restore size limits remain spread across app, processor, client, and nginx layers

- **Severity:** Low
- **Status:** risk
- **Confidence:** High
- **Evidence:**
  - Central app transport and restore/upload constants live in `apps/web/src/lib/upload-limits.ts:1-6`.
  - The image processor separately hard-codes the 200 MiB per-file cap: `apps/web/src/lib/process-image.ts:46`.
  - Next Server Action body size imports the central constant: `apps/web/next.config.ts:69-78`.
  - nginx repeats upload/restore request caps in config: `apps/web/nginx/default.conf:72-93`.
  - The admin DB UI imports the restore limit separately: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:23-24`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:59-66`.
- **Failure scenario:** A future limit increase is applied in `upload-limits.ts` but not in `process-image.ts` or nginx. Users see client/server transports accept a file that image validation rejects later, or nginx rejects a request before the app can produce the intended localized error.
- **Suggested fix:** Import `MAX_UPLOAD_FILE_BYTES` in `process-image.ts` instead of duplicating it. Add tests that compare documented/nginx limits to `upload-limits.ts`, or generate nginx snippets/docs from a single source.

## Positive architecture observations

- Mutating server actions consistently use explicit same-origin guards, and there is a scanner/test suite for this pattern: `apps/web/src/lib/action-guards.ts:37-44`, `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts:17-96`.
- `/api/admin/*` has a wrapper and a scanner for admin API auth; current sweep found no additional `/api/admin` route missing `withAdminAuth`: `apps/web/src/lib/api-auth.ts:13-26`, `apps/web/src/app/api/admin/db/download/route.ts:17-24`.
- Public/admin select-field separation is explicit and guarded at compile time for key privacy fields: `apps/web/src/lib/data.ts:184-225`, `apps/web/src/lib/data.ts:280-325`.
- Image queue work uses DB advisory locks per image claim and graceful shutdown flushes both queue and view-count buffer: `apps/web/src/lib/image-queue.ts:170-197`, `apps/web/src/instrumentation.ts:8-30`.

## Final missed-issues sweep

- **API auth sweep:** only `apps/web/src/app/api/admin/db/download/route.ts` exists under `/api/admin` and it is wrapped with `withAdminAuth`; public `/api/health`, `/api/live`, and `/api/og` are intentionally outside admin auth.
- **Process-local state sweep:** confirmed `globalThis` / module-memory state in restore maintenance, image queue, upload tracker, storage singleton, and rate-limit fast paths. Findings above cover the topology risk; no additional unbounded map without caps was found in reviewed architecture surfaces.
- **Direct filesystem sweep:** confirmed that storage abstraction is partial and live upload/serve/process/delete still uses direct filesystem paths; covered by MEDIUM-01.
- **Locale/deployment regex sweep:** found two-letter locale regexes in nginx/proxy/tests; covered by MEDIUM-04.
- **Skipped files confirmed:** skipped historical `.context/plans/**`, prior `.context/reviews/**` other than overwriting this file, screenshots/images/fonts/fixtures, `node_modules`, `test-results`, UI primitive components under `apps/web/src/components/ui/**`, and message JSON content. These were skipped because they are assets, historical reports, generated/vendor artifacts, or presentation/i18n content without architecture-relevant boundaries. Existing uncommitted application edits in messages/components/tests were not touched.

## Counts by severity

- Critical: 0
- High: 3
- Medium: 5
- Low: 1
- Total findings: 9
