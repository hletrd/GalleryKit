# Document Specialist Review — Cycle 1

Date: 2026-05-02
Scope: documentation/code consistency only. I did not edit application code.

## Inventory / sources examined

### Documentation and operator-facing config
- Root docs: `README.md`, `CLAUDE.md`, `AGENTS.md`, `apps/web/README.md`.
- Package/script surfaces: root `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`.
- Deploy/env surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, root/app `.dockerignore` and `.gitignore`.
- Build/test config: `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/eslint.config.mjs`.

### Source/test files checked against documentation claims
- Auth/session/rate-limit/proxy claims: `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/actions/auth.ts`.
- Upload/image/storage claims: `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/lib/serve-upload.ts`.
- Data/privacy/config claims: `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/gallery-config*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Enforcement tests reviewed: `check-api-auth.test.ts`, `check-action-origin.test.ts`, `nginx-config.test.ts`, `upload-limits.test.ts`, `health-route.test.ts`, `live-route.test.ts`, `next-config.test.ts`, `rate-limit.test.ts`, `touch-target-audit.test.ts`, `storage-local.test.ts`.

## Findings

### DS-C1-01 — Remote deploy docs tell users to create a root `.env.deploy`, but the script reads `~/.gallerykit-secrets/gallery-deploy.env` by default

- Severity: Medium
- Status: confirmed
- Confidence: High
- Evidence:
  - `README.md:105-110` says to keep SSH config in a gitignored root `.env.deploy` and run `cp .env.deploy.example .env.deploy` before `npm run deploy`.
  - `CLAUDE.md:287-294` repeats that the repo-level deploy helper reads a root `.env.deploy` by default.
  - `.env.deploy.example:1-4` says the default is `~/.gallerykit-secrets/gallery-deploy.env`, with `DEPLOY_ENV_FILE` as the override.
  - `scripts/deploy-remote.sh:5-6` sets `DEFAULT_DEPLOY_ENV_FILE="$HOME/.gallerykit-secrets/gallery-deploy.env"` and `ENV_FILE="${DEPLOY_ENV_FILE:-$DEFAULT_DEPLOY_ENV_FILE}"`.
  - `scripts/deploy-remote.sh:47-50` fails with instructions to copy the example to the home-directory default path, not root `.env.deploy`.
- Failure scenario / user impact: A user following the README exactly creates `.env.deploy` in the repo root, then `npm run deploy` exits with “Missing deploy env file: ~/.gallerykit-secrets/gallery-deploy.env”. This breaks the documented deployment path and can lead users to put secrets in the wrong place or duplicate config.
- Suggested fix: Either update README/CLAUDE to use `mkdir -p ~/.gallerykit-secrets && cp .env.deploy.example ~/.gallerykit-secrets/gallery-deploy.env`, or change `scripts/deploy-remote.sh` to fall back to root `.env.deploy` when present. Keep `.env.deploy.example` and docs consistent about `DEPLOY_ENV_FILE`.

### DS-C1-02 — Docker build docs say `BASE_URL` can satisfy the production URL guard, but Compose/Dockerfile do not pass `BASE_URL` at build time

- Severity: Medium
- Status: confirmed
- Confidence: High
- Evidence:
  - `README.md:117-143` tells users to put `BASE_URL` in `apps/web/.env.local`, then says production builds require a real URL and can use `BASE_URL` before `next build` / Docker build.
  - `apps/web/README.md:36` says production builds reject placeholder URLs, so set a real `BASE_URL` or replace `src/site-config.json.url` before building a production image.
  - `apps/web/scripts/ensure-site-config.mjs:11-12` reads `process.env.BASE_URL || siteConfig.url`.
  - `apps/web/scripts/ensure-site-config.mjs:28-37` rejects placeholder hosts during production builds.
  - `apps/web/docker-compose.yml:7-9` forwards only `IMAGE_BASE_URL` and `UPLOAD_MAX_TOTAL_BYTES` as build args.
  - `apps/web/Dockerfile:39-42` declares only `ARG IMAGE_BASE_URL` and `ARG UPLOAD_MAX_TOTAL_BYTES`, then exports only those two env vars for the builder.
  - `apps/web/docker-compose.yml:16-20` loads `.env.local` only as a runtime `env_file`; that does not make `BASE_URL` visible to `npm run build` inside the image build.
- Failure scenario / user impact: A deployer can set `BASE_URL=https://real.example` in `apps/web/.env.local` and leave `src/site-config.json.url` as `https://example.com`, then the Docker production build still sees no `BASE_URL` and fails the guard. The docs imply this should work.
- Suggested fix: Add `ARG BASE_URL` / `ENV BASE_URL=${BASE_URL}` to the Dockerfile builder and forward `BASE_URL: ${BASE_URL:-}` in Compose, or tighten docs to say Docker builds must use a non-placeholder `src/site-config.json.url` unless a build arg is explicitly added/passed.

### DS-C1-03 — Reverse-proxy body-size docs still claim a 2 GiB general nginx cap, but the checked-in nginx config is intentionally narrow

- Severity: Medium
- Status: confirmed
- Confidence: High
- Evidence:
  - `README.md:145` says the shipped nginx config caps general requests at **2 GiB** and `/admin/db` restores at **250 MB**.
  - `CLAUDE.md:219-220` repeats that the reverse proxy uses **2 GiB** for general requests and **250 MB** for `/admin/db`.
  - `apps/web/nginx/default.conf:29-31` sets the server default `client_max_body_size 2M`.
  - `apps/web/nginx/default.conf:72-75` sets `/admin/db` to `250M`.
  - `apps/web/nginx/default.conf:89-92` sets `/admin/dashboard` uploads to `216M`, explicitly “far below the historical 2 GiB blanket cap”.
  - `apps/web/src/__tests__/nginx-config.test.ts:14-19` locks the narrow default/login/db/dashboard limits in tests.
- Failure scenario / user impact: Operators reading the docs expect nginx to accept 2 GiB request bodies. In the shipped config, general requests over 2 MiB and dashboard upload requests over 216 MiB return 413 before the app sees them. This is especially confusing when comparing the app-level cumulative upload cap with the edge request cap.
- Suggested fix: Update README/CLAUDE to say: default 2 MiB, login 64 KiB, DB restore 250 MiB, dashboard upload 216 MiB. Clarify that the 2 GiB value is the app-level rolling/cumulative batch budget, not a per-request nginx body allowance.

### DS-C1-04 — Deployment checklist still recommends `db:push` after container migrations, which appears stale for the committed-migration flow

- Severity: Low
- Status: likely
- Confidence: Medium
- Evidence:
  - `CLAUDE.md:281-282` says the container runs migrations automatically, then step 6 says “Push schema indexes: `npm run db:push`”.
  - `apps/web/Dockerfile:94` starts production with `node apps/web/scripts/migrate.js && node apps/web/server.js`.
  - `apps/web/scripts/migrate.js:496-542` applies committed migrations and seeds the admin user during that startup migration path.
  - `apps/web/scripts/migrate.js:445-454` ensures the documented indexes, and `apps/web/scripts/migrate.js:456-463` ensures the foreign keys.
  - `apps/web/package.json:17` still exposes `db:push`, but CI/deploy paths use migrations/init instead (`.github/workflows/quality.yml:68-79`).
- Failure scenario / user impact: A production operator may run `drizzle-kit push` after the migration startup path, believing it is required for indexes. That can be redundant at best and, depending on future schema drift, can apply unreviewed schema changes outside the committed migration flow.
- Suggested fix: Remove `db:push` from the deployment checklist or label it as a development-only escape hatch. State that production deploys should rely on committed migrations / `scripts/migrate.js`.

### DS-C1-05 — Storage interface comments claim the live upload/Sharp/serve pipeline uses the abstraction, while authoritative docs and code say it is not wired

- Severity: Low
- Status: confirmed
- Confidence: High
- Evidence:
  - `CLAUDE.md:100` says `@/lib/storage` is not yet integrated and the product supports local filesystem storage only.
  - `apps/web/src/lib/storage/index.ts:4-12` also says the live upload, processing, and public-serving paths still use direct filesystem code and do not read from this module yet.
  - `apps/web/src/lib/storage/types.ts:50-60` says `writeStream` is “Used for upload pipeline” and `writeBuffer` is “Used by Sharp output pipeline”.
  - `apps/web/src/lib/storage/types.ts:68-72` says `createReadStream` is “Used by serve-upload.ts”.
  - `apps/web/src/lib/storage/types.ts:89-93` says `copy` is “Used by Sharp pipeline”.
  - Actual serving still uses direct filesystem streaming in `apps/web/src/lib/serve-upload.ts:91-95`.
  - Actual image derivative generation still writes directly via Sharp `.toFile(...)` in `apps/web/src/lib/process-image.ts:488-495` and dispatches formats with `Promise.all` at `apps/web/src/lib/process-image.ts:538-541`.
  - A repository search found no live imports of `@/lib/storage`/`getStorage` outside the storage module and storage-specific tests.
- Failure scenario / user impact: A maintainer may add behavior to `StorageBackend` expecting uploads, Sharp outputs, or serving to honor it, but production continues using direct filesystem paths. This can produce false confidence about future S3/MinIO or storage-policy changes.
- Suggested fix: Rewrite method comments as “intended future caller” / “interface contract” rather than “Used by…”, or wire upload/process/serve paths through the abstraction before documenting those methods as live.

### DS-C1-06 — Upload action comment says `images.topic` has no foreign key, but schema and migrations do enforce one

- Severity: Low
- Status: confirmed
- Confidence: High
- Evidence:
  - `apps/web/src/app/actions/images.ts:239-243` says the schema uses `varchar` without an FK constraint on `images.topic`, so an insert would otherwise succeed.
  - `apps/web/src/db/schema.ts:30` defines `images.topic` with `.references(() => topics.slug, { onDelete: 'restrict' })`.
  - `apps/web/scripts/migrate.js:456` ensures `images_topic_topics_slug_fk` exists in migrated databases.
  - Drizzle migrations also include the FK (`apps/web/drizzle/0000_nappy_madelyne_pryor.sql:77`, `apps/web/drizzle/0001_sync_current_schema.sql:75`).
- Failure scenario / user impact: The pre-insert topic lookup is still useful for a friendly localized error and stale-form handling, but the comment now misstates the database integrity model. A maintainer could incorrectly assume orphaned image topics are still possible via normal inserts.
- Suggested fix: Update the comment to say the explicit lookup returns a friendly `topicNotFound` before the DB FK throws, and protects UX around stale admin forms; remove the “without a FK” claim.

### DS-C1-07 — Blur-data-url documentation and comments contain stale `actions/images.ts:307` line references

- Severity: Low
- Status: confirmed
- Confidence: High
- Evidence:
  - `CLAUDE.md:185` points to `actions/images.ts:307` for the consumer-side throttled warning/barrier discussion.
  - `apps/web/src/lib/process-image.ts:393-397` repeats the same `actions/images.ts:307` reference.
  - The current upload write barrier is `blur_data_url: assertBlurDataUrl(data.blurDataUrl)` at `apps/web/src/app/actions/images.ts:316-321`.
  - The throttled rejection warning is implemented in `apps/web/src/lib/blur-data-url.ts:98-118`, not at `actions/images.ts:307`.
- Failure scenario / user impact: Developers following the doc/comment land on the wrong line and may miss the current source of the warning/barrier behavior.
- Suggested fix: Replace line-number references with symbol references (`assertBlurDataUrl` in `actions/images.ts` and `blur-data-url.ts`) or update the current line numbers whenever docs are regenerated.

### DS-C1-08 — Touch-target docs overclaim “all interactive elements” are enforced, but the test scope and patterns are narrower

- Severity: Low
- Status: risk
- Confidence: High
- Evidence:
  - `CLAUDE.md:257` states that all interactive elements must be at least 44x44 px and that this is enforced as a blocking unit test.
  - `CLAUDE.md:259` narrows the actual audit to `SCAN_ROOTS` = `components/` plus `app/[locale]/admin/`.
  - `apps/web/src/__tests__/touch-target-audit.test.ts:39-52` confirms only those two roots are scanned.
  - `apps/web/src/__tests__/touch-target-audit.test.ts:120-152` documents existing component exceptions, and `apps/web/src/__tests__/touch-target-audit.test.ts:161-190` documents admin route exceptions.
  - `apps/web/src/__tests__/touch-target-audit.test.ts:193-204` describes regex-based forbidden patterns, not a semantic audit of every button/link/checkbox shape.
- Failure scenario / user impact: A compact interactive element added directly under an unscanned public route file, or a pattern outside the regex set, can pass while docs imply universal enforcement. The test remains valuable, but the documentation overstates coverage.
- Suggested fix: Either expand `SCAN_ROOTS`/patterns to match the “all interactive elements” promise, or reword the policy to “covered components and admin route files; known regex-detectable compact controls”.

## Positive alignments verified (no finding)

- AGENTS rules are minimal and current: `AGENTS.md:1-4` matches the commit/push and gitmoji workflow used for this report.
- Package scripts documented in root/app READMEs map to actual scripts: root `package.json:11-22`, app `package.json:8-25`.
- Health/liveness docs align with implementation/tests: Docker healthcheck uses `/api/live` in `apps/web/Dockerfile:82-85`; `/api/health` DB readiness is gated by `HEALTH_CHECK_DB` in tests at `apps/web/src/__tests__/health-route.test.ts:42-69`.
- Trust-proxy docs align with `getClientIp` behavior: `apps/web/src/lib/rate-limit.ts:123-153` only trusts forwarded headers when `TRUST_PROXY=true`.
- Public privacy claims align with `publicSelectFields` and compile-time guards: `apps/web/src/lib/data.ts:280-326`.
- Security lint gate docs align with scripts and CI: `CLAUDE.md:238-253`, scripts in `apps/web/scripts/check-*.ts`, and `.github/workflows/quality.yml:54-66`.

## Final missed-issues sweep

- Ran an `omx explore` inventory over repository documentation/config/test/source candidates before targeted review.
- Ran targeted `rg` sweeps for high-drift terms: deploy env paths, `BASE_URL`, body limits, `2 GiB`, `db:push`, storage abstraction, `actions/images.ts:307`, touch-target claims, and foreign-key comments.
- Cross-checked key claims against implementation/test files named in the inventory above.
- Skipped as non-authoritative or generated/binary for this docs review: `node_modules/`, `.next/`, `test-results/`, screenshot/image artifacts under `.context/` and `apps/web/.context/`, runtime `.omc/`/`.omx/` state, historical `.context/plans/` and older `.context/reviews/` (except to overwrite this report), and generated upload directories. `package-lock.json` was not line-reviewed because the requested package-script authority is in `package.json`; dependency/version claims were checked against `apps/web/package.json`.

## Counts by severity

- Critical: 0
- High: 0
- Medium: 3
- Low: 5
- Total findings: 8
