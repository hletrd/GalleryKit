# Cycle 22 Security Review — security-reviewer

Date: 2026-07-08 KST
Review HEAD: `856bbc86fded2f9deb99c3a17fb2175f3be31560`
Role: `security-reviewer`
Scope: whole repository, no fixes implemented.

## Inventory First

- Auth/session/admin authz: `src/app/actions/auth.ts`, `admin-users.ts`, `lr-tokens.ts`, `src/lib/session.ts`, `api-auth.ts`, `admin-tokens.ts`, `password-hashing.ts`, `proxy.ts`, admin routes/actions.
- CSRF/origin/rate limits: `src/lib/request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, public route/action lint scripts, nginx template.
- Upload/file serving/path traversal: `src/app/actions/images.ts`, `src/app/api/admin/lr/upload/route.ts`, `src/lib/process-image.ts`, `upload-paths.ts`, `serve-upload.ts`, `pending-file-deletions.ts`, topic/resource upload helpers.
- Restore/backup/destructive boundaries: `src/app/[locale]/admin/db-actions.ts`, `src/lib/sql-restore-scan.ts`, restore maintenance/barrier/locks, backup download route, deploy script.
- Privacy/public data: `src/lib/data.ts`, `search-enrichment-fields.ts`, public feeds/sitemaps/OG/share/map/timeline routes, privacy tests.
- Secrets/config/dependencies: tracked env examples/docs/scripts, `npm audit`, `tracked-secrets.test.ts`, deploy/env handling.
- Product constraints checked: no payment/Stripe surface at HEAD; no culling/scoring features reviewed; storage remains local filesystem only for the wired upload/processing/serve path.

## Findings

### SEC-22-01 — Pending image-file deletions have durable rows but no autonomous retry path

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Files/regions:
  - `apps/web/src/db/schema.ts:134-152` defines `pending_file_deletions` with retry metadata and `updated_at` index.
  - `apps/web/src/app/actions/images.ts:677-716` inserts a pending row before single-image DB deletion, then calls `cleanupPendingFileDeletion()` inline once.
  - `apps/web/src/app/actions/images.ts:808-879` repeats the same inline-only cleanup for batch delete.
  - `apps/web/src/lib/pending-file-deletions.ts:70-90` deletes the row only on full cleanup success; on failures it increments `attempts` and stores `last_error`.
  - `apps/web/src/lib/maintenance-scheduler.ts:34-45` sweeps sessions, pending session revocations, rate buckets, audit logs, and view events, but does not process `pending_file_deletions`.
  - Repo-wide search found no `cleanupPendingFileDeletion` call site outside `images.ts`.
- Failure/exploit scenario: an admin deletes a photo during a transient filesystem failure, permission drift, NAS hiccup, EMFILE/ENOSPC, or process interruption after the DB transaction. The image row is gone, so public listing access disappears, but private originals and/or public derivatives can remain on disk indefinitely. For originals this is a privacy and destructive-operation boundary failure because deleted source files may retain sensitive EXIF/GPS or user intent even though the UI reports deletion success.
- Suggested fix: add a bounded restore-aware maintenance worker for `pending_file_deletions`: select oldest rows by `updated_at`, cap batch size/concurrency, call `cleanupPendingFileDeletion`, back off or dead-letter noisy rows, and expose operator evidence. Add tests proving startup/hourly maintenance retries failed rows and does not run during restore maintenance.

### SEC-22-02 — Public SSR/page limiter is template-only until host nginx is applied

- Severity: Medium
- Confidence: Medium
- Status: Risk / manual-validation
- Files/regions:
  - `apps/web/nginx/default.conf:1-10` defines `zone=public`.
  - `apps/web/nginx/default.conf:274-295` applies it only in the catch-all page location and states this is config-only.
  - `apps/web/deploy.sh:51-55` rebuilds/restarts Docker Compose but does not install/reload host nginx.
  - `CLAUDE.md:510-522` explicitly says nginx template changes are inert until an operator applies and reloads them.
- Failure/exploit scenario: if the live host still runs an older nginx config, unauthenticated dynamic public pages remain outside app-layer route/action limiters. A crawler or bot can force repeated dynamic SSR/database work without the shipped edge backstop.
- Suggested fix: record production `nginx -T` / reload evidence in the release ledger, or make deploy manage and validate this host config. If a CDN/proxy replaces nginx, document equivalent page-rate policy and verification.

### SEC-22-03 — Client-IP protections depend on exact proxy topology

- Severity: Medium
- Confidence: Medium
- Status: Risk / manual-validation
- Files/regions:
  - `apps/web/nginx/default.conf:20-28` documents that nginx `limit_req` keys use `$binary_remote_addr`.
  - `apps/web/nginx/default.conf:59-71` overwrites `X-Forwarded-For` with `$remote_addr` and warns this is correct only when that peer is the true client.
  - `apps/web/src/lib/rate-limit.ts:175-216` trusts proxy headers only with `TRUST_PROXY=true`; otherwise returns `unknown` and all users share a bucket.
  - `apps/web/src/lib/request-origin.ts:81-107` uses canonical base origin first, then trusted proxy/header fallback.
- Failure/exploit scenario: with a TLS/LB/CDN hop in front of nginx but no `real_ip`/PROXY-protocol/hop-count adjustment, every visitor can collapse into one app and edge bucket. Legitimate users can be locked out by another user's failures, and attack detection/rate-limiting evidence loses per-client fidelity.
- Suggested fix: verify live topology with controlled requests and logs. For LB-fronted nginx, configure `real_ip`/PROXY protocol and the matching `TRUSTED_PROXY_HOPS`, while preserving Host/Proto overwrite semantics.

### SEC-22-04 — Multi-instance deployment remains warn-only despite process-local security state

- Severity: Medium
- Confidence: Medium
- Status: Risk / accepted topology constraint
- Files/regions:
  - `CLAUDE.md:245-247` states the shipped topology is single web instance/single writer and lists process-local upload quota, queue, restore, and rate-limit state.
  - `apps/web/src/lib/single-writer-guard.ts:6-16` says the guard cannot enforce single-instance operation and must not fail startup.
  - `apps/web/src/lib/single-writer-guard.ts:218-235` emits a loud warning but explicitly continues startup.
- Failure/exploit scenario: two live web processes sharing one DB can split process-local mutation barriers, rate-limit fast paths, queue memory, and upload quota accounting. Restore and delete/upload paths have DB/advisory-lock hardening, but not every control is shared across processes.
- Suggested fix: keep the single-instance product constraint explicit. If horizontal scaling becomes a requirement, move these states to DB/Redis/shared locks or make the singleton guard fail closed in production after a verified non-rolling contention window.

### SEC-22-05 — Backup confidentiality and DB/file rollback remain operator boundaries

- Severity: Low
- Confidence: High
- Status: Confirmed residual risk
- Files/regions:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:228-243` writes mysqldump output to a local temp SQL file with `0600` mode and credentials in env, not CLI args.
  - `apps/web/src/app/api/admin/db/download/route.ts:21-89` serves backup SQL only through admin auth, filename validation, realpath containment, audit, and no-store headers.
  - `CLAUDE.md:223-228` documents plaintext SQL backups at rest and that DB restore does not roll back uploaded files/resources.
- Failure/exploit scenario: host compromise or overly broad filesystem backup access exposes plaintext SQL dumps. A DB restore can revert metadata without reverting originals/derivatives/resources, leaving filesystem drift for operators to reconcile.
- Suggested fix: keep host/storage encryption and backup retention as explicit operator requirements. For full rollback, pair DB dumps with host-level filesystem snapshots or a reconciliation/audit tool.

### SEC-22-06 — Admin accounts are password-only; PATs are scoped but there is no second factor

- Severity: Low
- Confidence: High
- Status: Risk / design gap
- Files/regions:
  - `apps/web/src/db/schema.ts:193-200` stores admin username/password hash/timestamps only.
  - `apps/web/src/app/actions/auth.ts:79-150` implements same-origin login plus IP/account rate-limit pre-increment.
  - `apps/web/src/app/actions/auth.ts:230-253` rotates sessions and sets `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
  - `apps/web/src/db/schema.ts:225-241` stores hashed scoped PATs for external clients.
- Failure/exploit scenario: a stolen admin password or active session remains sufficient for full admin access until detected/revoked. PAT upload tokens are scoped and hashed, but browser admin login has no TOTP/WebAuthn/passkey step.
- Suggested fix: add optional WebAuthn/TOTP for admin users and recovery codes, plus audit/UX around enforced MFA for root operators.

## Positive Security Evidence

- `npm audit --workspace=apps/web --audit-level=moderate`: 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: passed; admin API route exports are wrapped.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating non-auth server actions have same-origin guards or documented exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public expensive/mutating routes have rate-limit pre-increments or documented exemptions.
- Targeted Vitest: 13 files / 364 tests passed, covering action-origin lint, API-auth lint, public-route rate-limit lint, privacy fields, request origin, DB restore, SQL restore scanner, LR upload route behavior, upload serving, pending-file deletion source contracts, tracked secrets, session verification, and admin tokens.

## Missed-Issue Sweep

- Auth/authz: no missing admin API wrapper found; server-action origin lint is green; admin user deletion protects last-admin invariant through an advisory lock.
- CSRF/origin: fail-closed same-origin behavior is present for mutating actions and admin API cookie path; token-auth upload route deliberately uses PAT scope instead of browser origin.
- Rate limits: public action/route policy lint is green; remaining risk is deployment/proxy topology, not missing code hooks.
- XSS/CSV/Trojan-source: admin/public strings use sanitizers; CSV export escapes formula characters and control/format characters per inspected code/docs.
- SQL injection: app queries are mostly Drizzle-parameterized; restore scanner rejects dangerous SQL shapes before import; raw advisory-lock queries use parameters.
- SSRF: OG canonical-origin pinning documented in `CLAUDE.md`; no payment/webhook URL surface at HEAD.
- File upload/path traversal: UUID disk filenames, safe segment checks, realpath containment, symlink rejection, no public originals, Sharp bounds. SEC-22-01 is the remaining delete cleanup gap.
- Secrets: broad grep produced docs/tests/placeholders and historical-plan references; `tracked-secrets.test.ts` passed.
- Product constraints: no Stripe/payment routes or dependencies found in active source; no culling/scoring feature surface found; storage abstraction is not a supported remote backend.

## Uninspected Or Partially Inspected

- I did not run full `npm run build`, full `npm test`, or Playwright e2e in this review lane.
- I did not inspect binary image fixtures, generated `.next` output, live production nginx, live DB rows, host filesystem permissions, or deployed environment variables.
- I did not perform dynamic adversarial multipart memory profiling, CDN/proxy validation, or browser-driven admin flows.
