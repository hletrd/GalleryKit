# Document Specialist Compatibility Review — RETRY (2026-04-24)

Default-agent retry for `/Users/hletrd/flash-shared/gallery` because no registered `document-specialist` agent type was available. Scope: documentation/configuration/source mismatch review only; no application code changes and no commit.

## Inventory and method

I built the inventory from `git ls-files` and opened/read the relevant tracked documentation, examples, deploy/config, source, script, test, and current plan/context surfaces rather than sampling snippets.

Authoritative surfaces inspected:

- Root docs/instructions: `README.md`, `CLAUDE.md`, `AGENTS.md`, `.agent/rules/commit-and-push.md`, root `package.json`, `.nvmrc`, `.dockerignore`, `.gitignore`.
- App docs/examples/config: `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig*.json`, `apps/web/components.json`.
- Docker/deploy/nginx: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/nginx/default.conf`, both dockerignore files.
- Implementation surface: all tracked non-binary `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/e2e/**`, `apps/web/messages/**`, and relevant CI files.
- Plan/context docs: `.context/plans/README.md`, current `.context/reviews/_aggregate.md`, current/active root `plan/**` docs, and active `.context/plans/plan-*` files that the index marks as current.

Sweep evidence: the no-sampling inventory pass opened 307 non-binary tracked doc/config/source/test/plan surfaces (33,495 text lines) after excluding dependency/build/binary artifacts (`node_modules`, `.next`, image/font assets, tsbuildinfo, lockfile). Follow-up targeted sweeps compared documented env vars, scripts, build-time/runtime config, deploy paths, security invariants, and current plan status against implementation.

## Findings summary

| ID | Status | Severity | Confidence | Summary |
| --- | --- | --- | --- | --- |
| DOC-RETRY-001 | Confirmed | HIGH | High | Docker docs tell operators to put build-time Next config env in `.env.local`, but the Docker build never receives that file. |
| DOC-RETRY-002 | Confirmed | MEDIUM | High | `DB_SSL=false` is documented as the non-local DB TLS opt-out, but backup/restore CLI paths ignore it and `db:push` has no TLS handling. |
| DOC-RETRY-003 | Confirmed | MEDIUM | High | Quick-start docs run `npm run init` before instructing users to create `.env.local`, but init requires DB/admin env. |
| DOC-RETRY-004 | Likely | HIGH | Medium-High | Shipped host-nginx deployment guidance conflicts with nginx's fixed container-internal upload root. |
| DOC-RETRY-005 | Risk | MEDIUM | High | Deploy docs imply a real site config is enforced, but the tracked localhost `site-config.json` passes the only existence check. |
| DOC-RETRY-006 | Confirmed | MEDIUM | High | `CLAUDE.md` says public search/load-more rely on validation plus rate limiting; load-more is bounded but not rate-limited. |
| DOC-RETRY-007 | Confirmed | LOW | High | `CLAUDE.md`'s 2FA deferral rationale says “single-user admin” while the product implements multi-user admin auth. |
| DOC-RETRY-008 | Confirmed | MEDIUM | High | `.context/plans/README.md` is stale relative to current root plans and aggregate review state. |

---

## Findings

### DOC-RETRY-001 — Docker build-time env guidance is incompatible with the compose/Dockerfile path

- **Status:** Confirmed documentation/config mismatch.
- **Severity:** HIGH
- **Confidence:** High
- **Docs/config claims:**
  - `README.md:111-130` tells operators to copy/edit `apps/web/.env.local` and places `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, and `TRUST_PROXY` there.
  - `README.md:137-138` says `IMAGE_BASE_URL` must be set before `next build` / `docker compose ... --build`, and upload byte caps must stay aligned.
  - `apps/web/README.md:29-32` repeats that `IMAGE_BASE_URL` must be set before `next build` and that `UPLOAD_MAX_TOTAL_BYTES` controls the batch upload size.
  - `apps/web/.env.local.example:11-15` puts the CDN origin/prefix in `.env.local` and says to set it before Docker image build.
- **Implementation/config behavior:**
  - Root `.dockerignore:6` excludes `**/.env*`, so `apps/web/.env.local` is not in the build context.
  - `apps/web/Dockerfile:38-44` runs `COPY . .`, `node scripts/ensure-site-config.mjs`, then `npm run build`; there is no `ARG`, `ENV`, or dotenv load for `.env.local` in the builder stage.
  - `apps/web/docker-compose.yml:13-17` applies `.env.local` as `env_file` only to the runtime container, not to `build.args`.
  - `apps/web/next.config.ts:50-54` reads `process.env.IMAGE_BASE_URL` to build the CSP image source list, and `apps/web/next.config.ts:107-119` serializes image `remotePatterns` from that same value.
  - `apps/web/next.config.ts:100-105` serializes the server-action/proxy body size from `NEXT_UPLOAD_BODY_SIZE_LIMIT`, which is derived from `UPLOAD_MAX_TOTAL_BYTES` at `apps/web/src/lib/upload-limits.ts:11-24`.
- **Failure scenario:** An operator follows the documented Docker path, sets `IMAGE_BASE_URL=https://cdn.example.com` in `apps/web/.env.local`, and runs `docker compose -f apps/web/docker-compose.yml up -d --build`. The runtime container sees `IMAGE_BASE_URL`, but the Next build did not. The standalone config lacks the CDN `remotePatterns` and CSP allowance, so optimized CDN images can fail or be blocked. Similarly, raising `UPLOAD_MAX_TOTAL_BYTES` in `.env.local` can leave the framework-level body-size limit built with the default while runtime app code expects the customized value.
- **Concrete fix:** Make build-time env explicit. Options:
  1. Add `build.args` in `apps/web/docker-compose.yml` for `IMAGE_BASE_URL` and `UPLOAD_MAX_TOTAL_BYTES`, and add matching `ARG`/builder-stage `ENV` lines in `apps/web/Dockerfile` before `npm run build`.
  2. Or document that these values must be exported in the shell / Compose project `.env` before build, not merely written to `apps/web/.env.local`.
  3. Prefer a small prebuild check that warns/fails when `.env.local` has a build-time-only key that is absent from the Docker build environment.

### DOC-RETRY-002 — `DB_SSL=false` does not apply consistently to all documented DB tools

- **Status:** Confirmed documentation/config mismatch.
- **Severity:** MEDIUM
- **Confidence:** High
- **Docs/config claim:** `apps/web/.env.local.example:7` says TLS is auto-enabled for non-localhost `DB_HOST`, and `DB_SSL=false` disables it.
- **Implementation behavior:**
  - The app pool honors this contract: `apps/web/src/db/index.ts:6-11` reads `DB_SSL === 'false'`, and `apps/web/src/db/index.ts:13-25` spreads SSL config only when enabled.
  - Migration connection options also honor it: `apps/web/scripts/mysql-connection-options.js:11-23` checks `DB_SSL === 'false'`.
  - Backup ignores the opt-out: `apps/web/src/app/[locale]/admin/db-actions.ts:127-139` adds `--ssl-mode=REQUIRED` for every non-local DB host and never checks `DB_SSL`.
  - Restore ignores the opt-out the same way: `apps/web/src/app/[locale]/admin/db-actions.ts:396-408` adds `--ssl-mode=REQUIRED` for every non-local DB host.
  - `apps/web/drizzle.config.ts:4-12` builds a bare MySQL URL for `drizzle-kit` and does not model either auto-TLS or `DB_SSL=false`.
- **Failure scenario:** A deployment uses an internal/VPC MySQL endpoint with TLS disabled and sets `DB_SSL=false` as instructed. Runtime app queries and automatic migrations work, but admin backup/restore fail because the CLI forces `--ssl-mode=REQUIRED`. Conversely, a remote DB that requires TLS may work in app/migration paths while `npm run db:push` behaves differently because `drizzle.config.ts` has no equivalent TLS option.
- **Concrete fix:** Centralize DB TLS policy for all DB consumers. Have backup/restore build CLI SSL flags from the same `DB_SSL` + localhost logic, and update `drizzle.config.ts` to use an equivalent SSL-capable credential config or explicitly document `db:push` as a local/dev-only command with separate TLS requirements.

### DOC-RETRY-003 — Quick-start order runs DB init before required environment setup

- **Status:** Confirmed documentation/onboarding mismatch.
- **Severity:** MEDIUM
- **Confidence:** High
- **Docs:**
  - `README.md:89-95` lists installation as `npm install`, copy `site-config`, then `npm run init --workspace=apps/web`.
  - The root README does not introduce `.env.local` until `README.md:109-115`.
  - `apps/web/README.md:9-13` has the same app quick start: copy site config, run `npm run init`, then `npm run dev`; it omits `.env.local` entirely.
- **Implementation behavior:**
  - `apps/web/scripts/init-db.ts:14-30` loads `apps/web/.env.local` and delegates to `node scripts/migrate.js`.
  - `apps/web/scripts/migrate.js:103-109` throws on missing required env values.
  - `apps/web/scripts/migrate.js:525-538` requires `DB_NAME` and then creates a MySQL connection.
  - `apps/web/scripts/mysql-connection-options.js:3-9` and `apps/web/scripts/mysql-connection-options.js:16-22` require `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
- **Failure scenario:** A fresh user follows either quick start literally. `npm run init` fails with missing DB env variables before the docs have told the user to create/edit `apps/web/.env.local` with DB credentials and `ADMIN_PASSWORD`.
- **Concrete fix:** Move environment setup before `npm run init` in both READMEs. Minimal sequence: copy/edit `apps/web/.env.local.example`, ensure MySQL is reachable, copy/edit `site-config.json`, then run `npm run init --workspace=apps/web` (root) or `npm run init` (app workspace).

### DOC-RETRY-004 — Host-nginx deployment docs conflict with nginx's upload root

- **Status:** Likely deployment break; confirmed config/docs disagreement, host path dependency determines runtime impact.
- **Severity:** HIGH
- **Confidence:** Medium-High
- **Docs/config claims:**
  - `README.md:160-169` documents a host-network Docker deployment where the app listens on localhost and processed derivatives remain under `public/uploads/`.
  - `apps/web/docker-compose.yml:10-12` says nginx runs on the host and handles rate limiting/security headers.
  - `apps/web/docker-compose.yml:19-22` mounts host `./public` into the web container at `/app/apps/web/public`.
  - `apps/web/deploy.sh:3-7` says the deploy script runs from an arbitrary repo root such as `/home/ubuntu/gallery`; `apps/web/deploy.sh:32-34` says data persists under `apps/web/data` and `apps/web/public`.
- **Implementation/config behavior:**
  - `apps/web/nginx/default.conf:89-95` intercepts upload URLs and serves them with `root /app/apps/web/public`.
  - The Next fallback route can serve uploads securely (`apps/web/src/lib/serve-upload.ts:28-33`, `apps/web/src/lib/serve-upload.ts:63-66`, `apps/web/src/lib/serve-upload.ts:95-101`), but the nginx static location consumes matching URLs first.
- **Failure scenario:** An operator deploys under `/home/ubuntu/gallery`, copies `apps/web/nginx/default.conf` into host nginx as the docs imply, and uploads images. The files exist at `/home/ubuntu/gallery/apps/web/public/uploads/...`, but nginx looks under `/app/apps/web/public/uploads/...`, so valid gallery images return 404 unless the host happens to have that exact `/app` path.
- **Concrete fix:** Parameterize/template the nginx `root` to the actual host repo path, add an nginx container/service with a matching bind mount at `/app/apps/web/public`, or remove the static upload location and proxy `/uploads` to Next until the static root is configured. Add a deploy smoke check that requests one processed derivative through the reverse proxy.

### DOC-RETRY-005 — “Real site config” fail-fast docs are bypassed by the tracked localhost config

- **Status:** Risk from confirmed behavior; failure depends on operator leaving defaults unchanged.
- **Severity:** MEDIUM
- **Confidence:** High
- **Docs/config claim:**
  - `README.md:160-162` tells operators to provide a real `apps/web/src/site-config.json` and says production/deploy builds fail fast when it is missing.
  - `apps/web/README.md:34` repeats that build/deploy flows fail fast if `src/site-config.json` is missing.
- **Implementation behavior:**
  - The tracked `apps/web/src/site-config.json:1-12` already exists and uses `http://localhost:3000` for both `url` and `parent_url`.
  - `apps/web/scripts/ensure-site-config.mjs:4-8` only checks existence; it does not reject localhost/default values in production/deploy builds.
  - Production URL derivation falls back to this file when `BASE_URL` is absent: `apps/web/src/lib/constants.ts:9-14` and `apps/web/src/lib/data.ts:883-890`.
- **Failure scenario:** A deployer sees the fail-fast note, assumes the build will catch missing/placeholder public URL config, and forgets to set `BASE_URL` or customize `site-config.json`. The Docker build passes because the tracked file exists, and production metadata/sitemaps/JSON-LD can advertise `http://localhost:3000`.
- **Concrete fix:** Either stop tracking a deployable-looking `site-config.json` with localhost values and require a local ignored copy, or extend `ensure-site-config.mjs` to reject localhost/default `url`/`parent_url` when `NODE_ENV=production` unless `BASE_URL` is explicitly set for local/demo builds. Update docs to say exactly what is enforced.

### DOC-RETRY-006 — Public load-more is documented as rate-limited but is only bounded/validated

- **Status:** Confirmed documentation/security-invariant mismatch.
- **Severity:** MEDIUM
- **Confidence:** High
- **Docs:** `CLAUDE.md:127-130` says public actions such as search/load-more are anonymous and rely on validation plus rate limiting.
- **Implementation behavior:**
  - `apps/web/src/app/actions/public.ts:43-107` rate-limits `searchImagesAction` using in-memory and DB-backed search buckets.
  - `apps/web/src/app/actions/public.ts:23-40` implements `loadMoreImages` with slug validation, `limit` clamping, offset capping, and tag-array caps, but it never reads request headers or calls the rate-limit helpers.
- **Failure scenario:** A future reviewer/maintainer trusts the documented invariant and assumes anonymous load-more has a request budget. In reality a client can repeatedly call the bounded load-more action and drive DB pagination work until other controls intervene.
- **Concrete fix:** Either add a lightweight per-IP rate limit for `loadMoreImages`, or change `CLAUDE.md` to be precise: search is rate-limited; load-more is anonymous with strict input bounds (`limit <= 100`, `offset <= 10000`, max 20 tag filters) but no rate-limit bucket.

### DOC-RETRY-007 — 2FA deferral rationale says single-user admin despite multi-user auth

- **Status:** Confirmed documentation/product-rationale mismatch.
- **Severity:** LOW
- **Confidence:** High
- **Docs:**
  - `README.md:37` advertises multi-user admin auth.
  - `CLAUDE.md:103-107` lists `adminUsers` / `sessions` as multi-user authentication.
  - `CLAUDE.md:202-203` then says 2FA/WebAuthn is not planned because “Single-user admin with Argon2id + rate limiting is sufficient.”
- **Implementation behavior:**
  - `apps/web/src/db/schema.ts:106-134` models multiple `admin_users` and per-user sessions.
  - `apps/web/src/app/actions/admin-users.ts:57-67` lists admin users and `apps/web/src/app/actions/admin-users.ts:69-180` creates additional admin users.
  - `apps/web/src/components/admin-user-manager.tsx:17-31` renders a multi-user admin management UI.
- **Failure scenario:** Future security planning or product copy can wrongly treat the admin surface as single-user and understate risk/requirements for shared admin accounts.
- **Concrete fix:** Update the deferred rationale to “personal/self-hosted admin surface” or “multi-user admin without planned 2FA/WebAuthn,” and state the actual tradeoff without contradicting the implemented multi-user feature.

### DOC-RETRY-008 — Plan/context index is stale relative to current root plans and aggregate state

- **Status:** Confirmed context-document drift.
- **Severity:** MEDIUM
- **Confidence:** High
- **Docs/context:**
  - `.context/plans/README.md:3-24` still lists plan 230 and 231 as active TODOs, plus many older TODO/deferred items.
  - `.context/plans/README.md:235-240` says build was verified after cycle 22 and cumulative cycles 1-24 had 0 critical/high findings.
- **Current context/implementation state:**
  - `plan/plan-231-cycle1-core-fixes.md:1-16` records current Plan 231 as complete and says every aggregate finding is scheduled, fixed/validated, or deferred in Plan 232.
  - `plan/plan-231-cycle1-core-fixes.md:84-88` records completed gates and follow-up verification on 2026-04-24.
  - `plan/plan-232-cycle1-deferred.md:1-8` records the current active-deferred plan.
  - `.context/reviews/_aggregate.md:28-45` records 54 deduped current-cycle findings, including high-severity items.
- **Failure scenario:** A review-plan-fix or future agent uses `.context/plans/README.md` as the active index and reopens obsolete `.context/plans/plan-230/231` work, misses root `plan/plan-232-cycle1-deferred.md`, or reports an inaccurate “0 HIGH” status while current aggregate/context says otherwise.
- **Concrete fix:** Refresh `.context/plans/README.md` to point to the active root `plan/` files, mark superseded `.context/plans/plan-230/231` entries as superseded/archival, and update the notes/findings counts or clearly label the file as historical-only.

## Closed / not re-raised from the earlier document-specialist report

The retry did not re-raise these older doc findings because current implementation/docs now align:

- Precomputed Argon2 bootstrap hashes: `apps/web/scripts/migrate.js:515-520` stores `$argon2...` values directly and hashes only plaintext.
- `UPLOAD_MAX_FILES_PER_WINDOW`: parsed from env at `apps/web/src/lib/upload-limits.ts:11-12` and used by upload actions.
- `SHARP_CONCURRENCY` docs: `apps/web/.env.local.example:32` now says default CPU count minus 1, matching `apps/web/src/lib/process-image.ts:16-23`.
- Remote admin E2E docs: `apps/web/README.md:35-36` and `apps/web/.env.local.example:26-28` now include `E2E_ADMIN_ENABLED=true` plus `E2E_ALLOW_REMOTE_ADMIN=true`.
- Server action implementation path: `CLAUDE.md:90` points at `apps/web/src/app/actions/`, while `apps/web/src/app/actions.ts:1-3` is only a barrel re-export.
- DB security docs: `CLAUDE.md:141-147` now describes Drizzle as the common path and calls out audited raw-SQL/CLI exceptions instead of claiming an absolute Drizzle-only invariant.

## Final missed-doc sweep

Final sweeps performed after identifying the findings:

- Re-ran tracked-file inventory and opened non-binary doc/config/source/test/plan surfaces for this lane.
- Re-ran uppercase/env-token comparison across README/CLAUDE/app README/env examples/Docker/deploy/nginx docs vs source/config consumers.
- Re-read Docker build path, `.dockerignore`, `next.config.ts`, `upload-limits`, DB SSL consumers, init scripts, public actions, admin-user docs/code, and active plan/context docs with line-number citations.
- Checked current git status before writing; pre-existing modified review artifacts were present, and this retry only writes `.context/reviews/document-specialist.md` as requested.
