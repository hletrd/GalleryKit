# Quality Review — Cycle 1 (`quality-reviewer`)

Date: 2026-05-02  
Repository: `/Users/hletrd/flash-shared/gallery`  
Constraint honored: report-only; no application code edited.

## Review method

- Inventory source: `git ls-files`, `omx explore --prompt ...`, targeted line-numbered reads (`nl -ba`), grep/static sweeps for TypeScript escapes, lint disables, console/error paths, schema/migration drift, config/script contracts, and docs/config mismatches.
- Automated gates run locally:
  - `npm run lint` — PASS.
  - `npm run typecheck` — PASS.
  - `npm test` — PASS, 85 files / 607 tests.
  - `npm run lint:api-auth && npm run lint:action-origin` — PASS.
  - `npm run build` — PASS. It emitted the expected local build-time sitemap DB fallback warning because no local `.env.local` / selected DB was present.
- Not run locally: `npm run test:e2e` because this checkout has no `apps/web/.env.local` / DB credentials; the Playwright config and CI e2e wiring were reviewed instead.

## Inventory of quality-relevant files reviewed

Reviewed all tracked, non-binary, non-historical application/config/test/script files in the following inventory: **312 files**.

### Root metadata / docs / repo config (10)
- `.dockerignore`
- `.env.deploy.example`
- `.gitignore`
- `.nvmrc`
- `AGENTS.md`
- `CLAUDE.md`
- `LICENSE`
- `README.md`
- `package-lock.json`
- `package.json`

### CI / GitHub (2)
- `.github/dependabot.yml`
- `.github/workflows/quality.yml`

### Root scripts (1)
- `scripts/deploy-remote.sh`

### App config/deploy metadata (21)
- `apps/web/.dockerignore`
- `apps/web/.env.local.example`
- `apps/web/.gitignore`
- `apps/web/Dockerfile`
- `apps/web/README.md`
- `apps/web/components.json`
- `apps/web/docker-compose.yml`
- `apps/web/drizzle.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/public/.gitkeep`
- `apps/web/public/histogram-worker.js`
- `apps/web/tailwind.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.scripts.json`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/vitest.config.ts`

### App scripts (18)
- `apps/web/deploy.sh`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-js-scripts.mjs`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/migrate-admin-auth.ts`
- `apps/web/scripts/migrate-aliases.ts`
- `apps/web/scripts/migrate-capture-date.js`
- `apps/web/scripts/migrate-titles.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/migration-add-column.ts`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/prepare-next-typegen.mjs`
- `apps/web/scripts/run-e2e-server.mjs`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/scripts/seed-e2e.ts`

### Drizzle migrations / metadata (7)
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`
- `apps/web/drizzle/0001_sync_current_schema.sql`
- `apps/web/drizzle/0002_fix_processed_default.sql`
- `apps/web/drizzle/0003_audit_created_at_index.sql`
- `apps/web/drizzle/meta/0000_snapshot.json`
- `apps/web/drizzle/meta/0001_snapshot.json`
- `apps/web/drizzle/meta/_journal.json`

### Next app routes/actions (56)
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/apple-icon.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/icon.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`

### Runtime libraries/db/i18n/proxy (59)
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/seed.ts`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/action-result.ts`
- `apps/web/src/lib/advisory-locks.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/blur-data-url.ts`
- `apps/web/src/lib/bounded-map.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/csp-nonce.ts`
- `apps/web/src/lib/csv-escape.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/utils.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/site-config.example.json`

### React components (45)
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/i18n-provider.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/components/ui/aspect-ratio.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/ui/scroll-area.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/separator.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/ui/sonner.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/upload-dropzone.tsx`

### Tests and i18n (93)
- `apps/web/src/__tests__/**/*.test.ts` — all 85 tracked Vitest tests were included in the sweep.
- `apps/web/e2e/*.spec.ts` and `apps/web/e2e/helpers.ts` — all 6 tracked Playwright files were included.
- `apps/web/messages/en.json`, `apps/web/messages/ko.json` — key parity checked (499 keys each; no missing keys).

## Findings

### HIGH

#### Q1-HIGH-01 — Docker production builds are not lockfile-reproducible
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** CI installs exactly from the root lockfile via `npm ci` (`.github/workflows/quality.yml:48-49`), but the Docker build intentionally copies only package manifests and omits the lockfile (`apps/web/Dockerfile:21-30`, `apps/web/Dockerfile:32-36`). The app package uses broad semver ranges for critical runtime packages (`apps/web/package.json:48-57`) and dev/build packages (`apps/web/package.json:60-73`).
- **Failure scenario:** CI is green against `package-lock.json`, then a deploy rebuild resolves a newer `next`, `react`, `sharp`, `mysql2`, or transitive package because Docker uses `npm install`. The production image can differ from the tested artifact and fail at build/runtime with no corresponding CI failure.
- **Suggested fix:** Copy `package-lock.json` into the Docker dependency stages and use `npm ci --workspace=apps/web` / `npm ci --omit=dev --workspace=apps/web`. If the macOS-generated lockfile misses Linux optional dependencies, regenerate/update the lockfile in a Linux CI job instead of bypassing it in production.

#### Q1-HIGH-02 — Remote deploy script can report success after failed commands
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** The root wrapper is fail-fast (`scripts/deploy-remote.sh:1-3`), but the remote script it runs has no `set -euo pipefail` (`apps/web/deploy.sh:1-10`). It runs `git pull --ff-only` and `docker compose ... up -d --build` (`apps/web/deploy.sh:9-30`), then always prints success messages (`apps/web/deploy.sh:32-34`) if the last `echo` runs.
- **Failure scenario:** `git pull --ff-only` fails due divergence, or `docker compose` fails to build/start. Bash continues and the script ends on `echo`, so automation sees exit 0 and operators believe a deployment completed.
- **Suggested fix:** Add `set -euo pipefail` immediately after the shebang, quote variables, and optionally trap failures to print the failing step.

#### Q1-HIGH-03 — Admin user creation rate-limit is rolled back after every successful creation
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** The action says the `user_create` bucket prevents brute-force / CPU DoS (`apps/web/src/app/actions/admin-users.ts:113-126`) before running `argon2.hash` (`apps/web/src/app/actions/admin-users.ts:137-139`), but successful creation then decrements the same in-memory and DB bucket (`apps/web/src/app/actions/admin-users.ts:151-154`). The test suite locks this behavior (`apps/web/src/__tests__/admin-users.test.ts:150-160`).
- **Failure scenario:** A compromised admin session, automation bug, or malicious insider creates many unique admin accounts in one hour. Each request performs Argon2 work and inserts a row but leaves the rate-limit bucket unchanged, so the documented CPU/user-creation cap is ineffective for successful requests.
- **Suggested fix:** Decide the public contract. If this is a failed-attempt-only throttle, rename comments/constants/tests accordingly and add a separate hard cap for successful creations. If it is meant to cap user creation / CPU, remove the success rollback and update the test.

### MEDIUM

#### Q1-MED-01 — Drizzle schema declares `admin_users.updated_at`, but migrations/reconcile do not create it
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** The runtime schema exposes `adminUsers.updated_at` (`apps/web/src/db/schema.ts:106-113`). The committed migration creates `admin_users` without that column (`apps/web/drizzle/0001_sync_current_schema.sql:1-8`), and the legacy reconcile path also creates the table without it (`apps/web/scripts/migrate.js:276-289`). Grep of migration SQL only finds `updated_at` for `images`, not `admin_users`.
- **Failure scenario:** A future page/action selects `adminUsers.updated_at`; TypeScript accepts it because the schema exports the column, but fresh/CI/deployed DBs initialized through committed migrations fail at runtime with `Unknown column 'admin_users.updated_at'`.
- **Suggested fix:** Add a committed migration plus `reconcileLegacySchema` `ensureColumn(...)` for `admin_users.updated_at`, or remove the schema field. Add a CI drift gate (`drizzle-kit check`/generate diff check) so schema-only changes cannot land without migrations.

#### Q1-MED-02 — Existing photo-share no-op path rolls back a rate-limit attempt that was never incremented
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** `createPhotoShareLink` returns an existing `share_key` before calling `checkShareRateLimit` / `incrementRateLimit` (`apps/web/src/app/actions/sharing.ts:95-115`), but that branch still calls `rollbackShareRateLimitFull(...)` (`apps/web/src/app/actions/sharing.ts:100-105`). The source-contract test only covers the later concurrent-winner branch (`apps/web/src/__tests__/sharing-source-contracts.test.ts:7-15`).
- **Failure scenario:** After creating one share link, repeatedly invoking the already-shared image path decrements or deletes the `share_photo` bucket for prior real attempts. The admin can erase pressure in the current window before generating more new keys, weakening the write throttle and making rate-limit behavior hard to reason about.
- **Suggested fix:** Remove the rollback from the initial `if (image.share_key)` branch, or move the pre-increment before all DB/no-op branches and consistently roll back exactly once for every no-op.

#### Q1-MED-03 — Database TLS/connection configuration has three divergent implementations
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** Runtime DB pool enables TLS for non-local hosts unless `DB_SSL=false` (`apps/web/src/db/index.ts:6-12`). Migration scripts use a separate helper with similar logic (`apps/web/scripts/mysql-connection-options.js:1-23`). Drizzle Kit config builds only a URL and has no equivalent TLS handling (`apps/web/drizzle.config.ts:4-12`).
- **Failure scenario:** A hosted MySQL instance requires TLS. The app and `migrate.js` can connect, while `npm run db:push`/Drizzle Kit fails or connects with different security semantics. Future config changes (CA support, proxy hosts, socket paths) must be manually copied to multiple places and can drift again.
- **Suggested fix:** Extract a shared connection option builder usable by runtime, scripts, and `drizzle.config.ts`, or at least add `ssl`/`DB_SSL` handling and tests for `drizzle.config.ts`.

#### Q1-MED-04 — README deploy instructions point to a root `.env.deploy`, but the script defaults elsewhere
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** README instructs users to copy `.env.deploy.example` to root `.env.deploy` and run `npm run deploy` (`README.md:103-113`). The script defaults to `$HOME/.gallerykit-secrets/gallery-deploy.env` unless `DEPLOY_ENV_FILE` is set (`scripts/deploy-remote.sh:4-6`) and exits if that file is missing (`scripts/deploy-remote.sh:47-50`). The example file itself says to copy outside the repo by default (`.env.deploy.example:1-4`).
- **Failure scenario:** A user follows README exactly; `npm run deploy` ignores root `.env.deploy` and fails with “Missing deploy env file: ~/.gallerykit-secrets/gallery-deploy.env”.
- **Suggested fix:** Align the contract: either update README to the external default, or make `scripts/deploy-remote.sh` prefer root `.env.deploy` when present before falling back to the external path.

#### Q1-MED-05 — Critical JavaScript deploy/migration scripts only receive syntax checking
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** `typecheck:scripts` runs `check:js-scripts` plus TypeScript over `scripts/**/*.ts` (`apps/web/package.json:15-25`). The JS checker only calls `node --check` for `.js/.mjs/.cjs` (`apps/web/scripts/check-js-scripts.mjs:38-40`). Critical JS files include `apps/web/scripts/migrate.js:1-10`, `apps/web/scripts/mysql-connection-options.js:1-23`, `apps/web/scripts/migrate-capture-date.js:17-25`, and `apps/web/scripts/run-e2e-server.mjs:44-60`.
- **Failure scenario:** A typo such as a wrong property name, missing import, or wrong return shape lands in `migrate.js`; `node --check` passes because syntax is valid, and the failure appears only during production container startup.
- **Suggested fix:** Convert JS scripts to TypeScript, or enable `// @ts-check` + `checkJs` for scripts and include JS in ESLint/typecheck. Keep `node --check` as a fast syntax layer, not the only JS quality gate.

#### Q1-MED-06 — CI performs redundant DB initialization and builds around e2e
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** CI runs `npm run init --workspace=apps/web` before Playwright (`.github/workflows/quality.yml:65-76`) and then runs a final build (`.github/workflows/quality.yml:78-79`). The Playwright web server command itself runs `npm run init`, `npm run e2e:seed`, and `npm run build` (`apps/web/scripts/run-e2e-server.mjs:75-84`).
- **Failure scenario:** CI time grows and failures become harder to triage: migrations can run twice, seed state can be reset unexpectedly, and production build failures can appear during e2e setup and again in the final build. With a 30-minute timeout (`.github/workflows/quality.yml:10-11`), this duplication reduces headroom.
- **Suggested fix:** Split “prepare DB”, “seed”, “build”, and “serve standalone” into separate scripts. In CI, build once, initialize/seed once, and point Playwright at the prepared artifact, or make `run-e2e-server.mjs` honor `E2E_SKIP_INIT` / `E2E_SKIP_BUILD`.

#### Q1-MED-07 — Runtime is Node 24 while type surface is Node 25
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** `.nvmrc` pins Node 24 (`.nvmrc:1`), and package engines require Node `>=24` (`apps/web/package.json:5-7`), but the app type dependency is `@types/node` `^25.6.0` (`apps/web/package.json:59-63`).
- **Failure scenario:** A future script uses a Node 25-only API. TypeScript accepts it, CI using Node 24 compiles, but runtime on Node 24 fails when that API is missing.
- **Suggested fix:** Pin `@types/node` to the active runtime major (`^24`) or raise `.nvmrc`/Docker/CI to Node 25 together.

#### Q1-MED-08 — `.context/` is ignored but many historical `.context` files are tracked; new reports are easy to miss
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** Root `.gitignore` ignores `.context/` (`.gitignore:16-20`), yet `git ls-files` reports 1,098 tracked `.context` files. This report path is under the ignored tree, requiring force-add.
- **Failure scenario:** Reviewers write required reports under `.context/reviews/`; `git status` does not show new files unless they remember `git add -f`. Meanwhile old tracked context files keep accumulating and confuse repository inventory/review scope.
- **Suggested fix:** Pick one policy: untrack/archive generated `.context` history and keep it ignored, or stop ignoring the specific report subdirectory and document retention. Consider `.gitignore` exceptions for required reports.

### LOW

#### Q1-LOW-01 — Vitest discovery only includes `src/__tests__/**/*.test.ts`
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** `apps/web/vitest.config.ts:10-12` includes only `src/__tests__/**/*.test.ts`.
- **Failure scenario:** A contributor adds `src/components/foo.test.tsx`, `src/lib/foo.spec.ts`, or a colocated test next to the module; `npm test` and CI ignore it silently.
- **Suggested fix:** Broaden the include to something like `src/**/*.{test,spec}.{ts,tsx}` or document/enforce the `src/__tests__/*.test.ts` convention with a lint/check script.

#### Q1-LOW-02 — Upload-limit documentation is stale relative to nginx config
- **Status:** confirmed
- **Confidence:** High
- **Evidence:** README says the shipped nginx config caps “general requests at **2 GiB**” and `/admin/db` at 250 MB (`README.md:142-146`). The actual nginx config sets the default `client_max_body_size` to 2 MB (`apps/web/nginx/default.conf:29-31`), restore to 250 MB (`apps/web/nginx/default.conf:72-76`), and dashboard uploads to 216 MB (`apps/web/nginx/default.conf:89-93`).
- **Failure scenario:** An operator raises app upload limits based on README but not nginx, or believes general requests allow 2 GiB when edge rejects them at 2 MB / 216 MB.
- **Suggested fix:** Update README to document the current per-location caps and the distinction between batch budget, per-file budget, Server Action cap, and reverse-proxy body caps.

#### Q1-LOW-03 — Dependabot watches `/apps/web` but not root workspace metadata/overrides
- **Status:** likely
- **Confidence:** Medium
- **Evidence:** Root dependency metadata contains workspaces and security overrides (`package.json:4-10`) and the root lockfile is authoritative (`package-lock.json`). Dependabot npm config only targets `/apps/web` (`.github/dependabot.yml:3-12`).
- **Failure scenario:** A vulnerable root override or root lockfile/workspace metadata issue is not surfaced by Dependabot, even though CI installs from the root.
- **Suggested fix:** Add an npm update entry for `/` or confirm Dependabot workspace behavior explicitly and document why `/apps/web` is sufficient.

#### Q1-LOW-04 — Select-field omission pattern in `data.ts` is hard to maintain
- **Status:** risk
- **Confidence:** Medium
- **Evidence:** `adminListSelectFields` and `publicSelectFields` are derived through long destructuring blocks with repeated `eslint-disable-next-line @typescript-eslint/no-unused-vars` comments (`apps/web/src/lib/data.ts:227-307`). Compile-time privacy guards help (`apps/web/src/lib/data.ts:317-344`), but the omission mechanism is noisy and easy to edit incorrectly.
- **Failure scenario:** A future schema field is added and reviewers miss whether it belongs in admin listing, public listing, or privacy-sensitive omissions because the signal is buried in many local lint disables.
- **Suggested fix:** Replace the destructuring/disable pattern with a typed `omitSelectFields(adminSelectFields, [...])` helper or explicit allowlist objects backed by compile-time `satisfies`/key-diff tests.

## Positive observations

- Lint, typecheck, unit tests, security lint gates, and production build all passed locally.
- i18n message key parity is exact: `en.json` and `ko.json` both expose 499 flattened keys.
- The custom security lint gates for `/api/admin/**` and mutating server actions are well-tested and recursive (`apps/web/scripts/check-api-auth.ts:17-45`, `apps/web/scripts/check-action-origin.ts:41-98`).
- Many historical high-risk areas have explicit regression tests (origin checks, CSP, upload limits, rate limits, restore scanning, image processing, touch targets).

## Final missed-issues sweep

Performed after drafting findings:
- Re-ran inventory counts from `git ls-files` and confirmed reviewed set: 312 quality-relevant text/code/config/test/script files.
- Confirmed no TypeScript `any`/`@ts-ignore` escape hatches in non-test app source beyond documented lint-disable comments.
- Confirmed i18n message parity between English and Korean.
- Confirmed local gates still pass after the read-only inspection commands; only this report file was created.
- Confirmed the schema/migration mismatch for `admin_users.updated_at` by direct grep across `apps/web/drizzle/*.sql` and `apps/web/scripts/migrate.js`.

## Skipped files confirmation

Skipped **1,164 tracked files** as not quality-relevant application review targets for this cycle:
- 1,098 historical `.context/` review/plan/log artifacts (except this new report path).
- 60 historical `plan/` docs.
- 4 binary/static assets: `.github/assets/logo.svg`, two e2e fixture JPEGs, and `PretendardVariable.woff2`.
- 1 tracked `.omc` plan artifact.
- 1 generated `test-results/.last-run.json` artifact.

Generated/ignored local directories (`node_modules`, `.next`, `.omx`, `.omc` runtime state, app data, screenshots) were not reviewed as source and were not modified for commit.

## Counts by severity

- CRITICAL: 0
- HIGH: 3
- MEDIUM: 8
- LOW: 4
- TOTAL: 15
