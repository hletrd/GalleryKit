# Cycle 18 Security Review

Date: 2026-06-30
Reviewer: security-reviewer
Scope: whole repository under `/Users/hletrd/flash-shared/gallery`

## Summary

Confirmed findings: 2 total.

- Critical: 0
- High: 0
- Medium: 0
- Low: 2

No confirmed authentication bypass, authorization bypass, CSRF bypass, SQL injection, path traversal, SSRF, upload execution, tracked-secret, or vulnerable dependency issue was found in this pass.

## Relevant File Inventory

- Auth/session/origin: `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/admin/login/*`.
- Admin APIs and server actions: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/[locale]/admin/actions/*`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public APIs and public actions: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/[locale]/(public)/actions/*`.
- Upload/file/storage paths: `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/clip-paths.ts`.
- SQL/database/restore/search: `apps/web/src/lib/db.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/drizzle/**/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/scripts/*.ts`.
- Privacy, XSS, CSV, Unicode, CSP: `apps/web/src/lib/csv-escape.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/og-photo-fetch.ts`.
- Rate limits: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, public API routes, admin token auth, public share actions.
- Deploy/config/secrets: `.env.deploy.example`, `apps/web/.env.local.example`, `.gitignore`, `apps/web/.gitignore`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `CLAUDE.md`, `AGENTS.md`.
- Security tests and gates: `apps/web/src/__tests__/tracked-secrets.test.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/request-origin.test.ts`, `apps/web/src/__tests__/content-security-policy.test.ts`, `apps/web/src/__tests__/csv-escape.test.ts`, `apps/web/src/__tests__/upload-paths.test.ts`, `apps/web/src/__tests__/db-restore.test.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`, `apps/web/scripts/lint-api-auth.ts`, `apps/web/scripts/lint-action-origin.ts`, `apps/web/scripts/lint-public-route-rate-limit.ts`.

## Findings

### LOW-1: repo-local deploy secret file is the default path

Severity: Low
Confidence: High

Evidence:

- `.env.deploy.example:1-4` tells operators to copy the sample to a gitignored repo-root `.env.deploy` by default and only use `DEPLOY_ENV_FILE` when intentionally keeping it outside the checkout.
- `.gitignore:18` ignores `.env.deploy`, so the intended default file is untracked but still inside the working tree.
- `scripts/deploy-remote.sh:22-28` prefers `$ROOT_DIR/.env.deploy` whenever it exists before falling back to `$HOME/.gallerykit-secrets/gallery-deploy.env`.
- `scripts/deploy-remote.sh:61-72` sources the selected env file and executes the resulting deploy command through `bash -lc`.
- `apps/web/src/__tests__/tracked-secrets.test.ts:33-38` only scans `git ls-files`, so local ignored deploy env files are outside the tracked-secret safety net.

Problem:

The repo intentionally supports a gitignored deploy env file in the checkout, and the helper gives it precedence over the external secrets location. This reduces friction, but it keeps real deploy host/user/key/path values adjacent to source code and outside the tracked-secret scanner.

Exploit/failure scenario:

An operator creates `.env.deploy` in the repo as documented. Later, a support archive, workspace backup, compromised editor extension, misconfigured CI cache, or forced `git add -f` captures the ignored file. The file can expose deploy host metadata, SSH identity paths, and any optional deploy command override, giving an attacker a clearer path to the production deploy surface.

Fix:

Invert the default precedence so `$HOME/.gallerykit-secrets/gallery-deploy.env` is preferred, and make repo-root `.env.deploy` opt-in via `DEPLOY_ENV_FILE`. Update `.env.deploy.example` to recommend the external path by default. Add a local preflight warning or test that reports when repo-local `.env.deploy` exists with non-placeholder values without printing those values.

### LOW-2: deploy env allows arbitrary shell command overrides without a separate guard

Severity: Low
Confidence: Medium

Evidence:

- `.env.deploy.example:11` makes `DEPLOY_REMOTE_SCRIPT` a configurable shell fragment.
- `.env.deploy.example:13-14` documents `DEPLOY_CMD` as an optional complete command override.
- `scripts/deploy-remote.sh:31-53` inserts `DEPLOY_REMOTE_SCRIPT` into the remote command after quoting only `DEPLOY_PATH`.
- `scripts/deploy-remote.sh:66-72` lets `DEPLOY_CMD` bypass command derivation and executes it through `bash -lc`.

Problem:

The deploy env is not just declarative configuration; it can carry local or remote shell. That is an intentional escape hatch, but the script does not require a second acknowledgement such as `ALLOW_DEPLOY_CMD=true`, and this combines poorly with the repo-local default secret-file path in LOW-1.

Exploit/failure scenario:

A stale, copied, or maliciously edited deploy env changes `DEPLOY_REMOTE_SCRIPT` or `DEPLOY_CMD` to run extra shell during `npm run deploy`. Because the helper sources the file and executes the command, the change can run with the operator's local privileges and the remote deploy account's privileges. In the worst case, this can exfiltrate deploy metadata or damage the remote checkout before the deploy script runs.

Fix:

Keep the normal path declarative: host, user, key, path, and a fixed deploy script. Require an explicit guard for arbitrary command mode, for example `ALLOW_DEPLOY_CMD=true`, before honoring `DEPLOY_CMD` or a custom `DEPLOY_REMOTE_SCRIPT`. Prefer an allowlisted remote script value if the escape hatch is not needed day to day.

## Missed-Issues Sweep

- OWASP access control: Admin pages are gated by middleware cookie presence and real authorization happens in `withAdminAuth` and server actions. `npm run lint:api-auth --workspace=apps/web` passed, confirming admin API exports are wrapped. `npm run lint:action-origin --workspace=apps/web` passed, confirming mutating server actions return early on same-origin admin checks or carry explicit exemptions.
- Auth/session: Production session secret is required, session tokens are HMAC hashed, comparisons use timing-safe equality, and cookie flags are hardened. No session fixation or unsigned-token acceptance path was found.
- CSRF/origin: `hasTrustedSameOrigin` fails closed unless `Origin` or `Referer` exactly matches the derived trusted origin. Admin cookie API access runs the origin check before `isAdmin`. No current call site uses the optional missing-source allowance.
- Rate limits: Login, account, admin token auth, public semantic search, OG generation, and public share mutation paths have rate-limit coverage. `npm run lint:public-route-rate-limit --workspace=apps/web` passed for public mutating routes.
- SSRF/open redirect: OG image fetching is pinned to configured same-origin/base URLs, and image-base configuration is validated. No arbitrary URL fetch from user input was confirmed.
- Path traversal/file serving: Upload serving resolves paths under allowed roots and rejects symlinks and non-file entries. Upload processing uses UUID storage names and Sharp metadata/size checks. Backup download paths are resolved and filename constrained.
- SQL/database restore: Drizzle query construction and allowlisted sort/filter paths are used for app queries. Restore scanning blocks dangerous SQL shapes, and restore execution avoids passing database passwords on the process command line.
- Privacy: Public data projections omit admin-only fields, privacy guard tests cover sensitive keys, and map visibility controls are present. No direct leak of originals, admin notes, or private search enrichment fields was confirmed.
- CSV/Unicode spoofing: CSV export escaping and Unicode format-character rejection tests passed. Formula prefixes, bidi overrides, and zero-width controls are covered by the dedicated CSV and validation helpers.
- XSS/CSP: JSON-LD is serialized through the safe helper, React-rendered content is escaped by default, and production `script-src` uses nonce/self sources. `style-src 'unsafe-inline'` remains a framework compatibility tradeoff covered by CSP tests and was not counted as a confirmed finding in this pass.
- Secrets/dependencies: `tracked-secrets.test.ts` passed for tracked files, and `npm audit --workspace=apps/web --audit-level=low` reported `found 0 vulnerabilities`.

## Verification Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/request-origin.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/csv-escape.test.ts src/__tests__/upload-paths.test.ts src/__tests__/db-restore.test.ts src/__tests__/sql-restore-scan.test.ts`: 8 files, 84 tests passed.
- `npm audit --workspace=apps/web --audit-level=low`: passed, 0 vulnerabilities.
- `npm ls --workspace=apps/web --depth=0`: dependency inventory reviewed.
