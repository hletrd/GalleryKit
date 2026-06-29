# Security Reviewer — review-plan-fix cycle 3

Role: `security-reviewer`
HEAD reviewed: `3f24038b04f48c73f5dac079cd3276fecbd48282` (`build(sw): 🔨 update cycle 2 service worker stamp`)
Date: 2026-06-29
Scope: current HEAD only; report-only pass.

## Inventory Coverage

- Read first: `AGENTS.md`, `CLAUDE.md`.
- Accounted for prior context: current `.context/reviews/security-reviewer.md`, `.context/reviews/_aggregate.md`, and relevant prior run/cycle review and plan history. Stale cycle-2 findings were rechecked against current HEAD before deciding whether to carry them forward.
- Inventory snapshot: 2,494 tracked files; 482 tracked files under `apps/web/src`; 258 tracked test/e2e files.
- Review-relevant inventory inspected: 207 tracked files across `apps/web/src/app/api`, `apps/web/src/app/actions`, `apps/web/src/app/[locale]/admin`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `.dockerignore`, env examples, package manifests, and lockfile.
- Manual security review covered OWASP Top 10, secrets, auth/authz, admin PATs, CSRF/origin, SSRF, path traversal, upload safety, SQL/raw queries, sessions/cookies, privacy/data leakage, rate limiting, backup/restore, Docker/nginx/deploy scripts, and the existing repo security gates. This was not a sample-only pass.
- Tracked secret/path sweep found no live committed secrets in HEAD. Tracked env-like files are examples only: `.env.deploy.example` and `apps/web/.env.local.example`. Ignored local env files were intentionally not opened.

## Validation Evidence

- `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: pass; all admin API route exports are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: pass; mutating server actions enforce `requireSameOriginAdmin()` or carry a documented exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; public mutating API route scan passes.
- `npm test --workspace=apps/web -- privacy-fields check-api-auth check-action-origin check-public-route-rate-limit sql-restore-scan semantic-route-production semantic-search-rate-limit similar-route og-photo-fallback backup-download-route request-origin api-auth-response-headers safe-json-ld sanitize-stderr`: 14 files / 170 tests passed.

## Findings

### SEC-RISK-01 — Unsupported horizontal scaling weakens process-local security controls

Status: Manual-validation operational risk; not a confirmed defect under the documented deployment topology.
Severity: Medium
Confidence: High

Evidence:
- `CLAUDE.md:224-227` explicitly documents the shipped deployment as single web-instance / single-writer and says restore maintenance flags, upload quota tracking, queue state, admin-backfill status, and non-login rate-limit fast-path buckets are process-local.
- Public OG/share/search/semantic limiter state is in-process (`apps/web/src/lib/rate-limit.ts:68-89`, `apps/web/src/lib/rate-limit.ts:103-108`, `apps/web/src/lib/rate-limit.ts:314-318`).
- Restore maintenance state is stored on `globalThis` (`apps/web/src/lib/restore-maintenance.ts:1-56`).
- Upload quota tracking is a `globalThis` `Map` (`apps/web/src/lib/upload-tracker-state.ts:7-20`) with active-claim checks at `apps/web/src/lib/upload-tracker-state.ts:70-79`.

Failure scenario:
If an operator scales the web service horizontally before moving these states to a shared store, public rate limits become per-instance, restore maintenance may not fence uploads accepted by a sibling process, and upload quota claims can split across instances. That weakens DoS controls and can expose restore/upload race windows.

Concrete fix:
Keep single-instance/single-writer as an enforced production invariant, or migrate these states to shared storage before scale-out. The hardening path is DB/Redis-backed public rate-limit buckets, a DB-backed restore-maintenance flag or lease, and shared upload-claim accounting. Add a startup/deploy guard that fails when multiple replicas are configured without an explicit shared-state mode.

## Rechecked Prior Findings

- Cycle-2 `.claude/` Docker build-context leakage is fixed in HEAD: `.dockerignore:4-14` excludes `.context`, `.omx`, `.omc`, `.agent`, `.claude`, `.claude/`, and env files.
- Cycle-2 direct standalone-container exposure risk is fixed in HEAD for the shipped image/compose defaults: `apps/web/Dockerfile:80-85` sets production `HOSTNAME="127.0.0.1"`, `apps/web/docker-compose.yml:14-21` sets host networking with `HOSTNAME: 127.0.0.1` and `TRUST_PROXY: "true"`, and nginx proxies to loopback at `apps/web/nginx/default.conf:15-18`. Edge limits remain present at `apps/web/nginx/default.conf:29-36`, `apps/web/nginx/default.conf:56-60`, `apps/web/nginx/default.conf:72-77`, `apps/web/nginx/default.conf:131-151`.
- Historical git-secret rotation remains an operational/history issue, not a current-HEAD code defect: the current tracked env examples use placeholders, and no live committed secret was found in HEAD.

## Security Posture Notes

- Auth/session: production refuses weak/missing `SESSION_SECRET` (`apps/web/src/lib/session.ts:16-35`), sessions are HMAC-signed and timing-safe verified (`apps/web/src/lib/session.ts:82-150`), and admin API success/error responses receive no-store/nosniff headers (`apps/web/src/lib/api-auth.ts:7-12`, `apps/web/src/lib/api-auth.ts:91-119`).
- CSRF/origin: `hasTrustedSameOrigin` fails closed by default (`apps/web/src/lib/request-origin.ts:79-107`), `withAdminAuth` enforces origin before cookie auth (`apps/web/src/lib/api-auth.ts:91-100`), and server actions centralize same-origin checks (`apps/web/src/lib/action-guards.ts:37-44`).
- Admin PATs: tokens are random, stored as SHA-256 hashes, scope-checked, expiry-checked, and verified fail-closed (`apps/web/src/lib/admin-tokens.ts:48-85`, `apps/web/src/lib/admin-tokens.ts:136-166`); token creation/revocation actions are same-origin/admin gated (`apps/web/src/app/actions/lr-tokens.ts:27-39`, `apps/web/src/app/actions/lr-tokens.ts:102-115`).
- Path traversal/upload/file serving: backup downloads validate filename, reject symlinks, enforce realpath containment, and stream the resolved path (`apps/web/src/app/api/admin/db/download/route.ts:22-87`); uploaded derivative serving validates safe path segments and realpath containment (`apps/web/src/lib/serve-upload.ts:145-184`, `apps/web/src/lib/serve-upload.ts:261-265`).
- SSRF/OG: per-photo OG generation pins internal fetches to canonical `siteConfig.url` and fails closed instead of using attacker-controlled request origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:100-125`).
- SQL/restore: restore requires admin + same-origin, holds DB and upload-contract locks, writes temp files mode `0600`, scans the entire dump in chunks, blocks dangerous SQL forms, invokes `mysql --one-database`, and sanitizes stderr (`apps/web/src/app/[locale]/admin/db-actions.ts:266-520`, `apps/web/src/lib/sql-restore-scan.ts:39-155`).
- Data leakage: public search enrichment uses a shared compile-guarded select (`apps/web/src/app/api/search/semantic/route.ts:291-302`, `apps/web/src/app/api/search/similar/[id]/route.ts:193-205`), and the targeted privacy tests passed.

## Final Missed-Issues Sweep

- Negative-pattern sweeps covered `eval`, `new Function`, `dangerouslySetInnerHTML`, browser storage, JWT libraries, weak hash names, Transformers remote-model loading, shell execution/deploy commands, destructive script commands, tracked secret-like paths, admin wrappers, origin guards, raw SQL, realpath/lstat file access, and rate-limit helpers.
- No confirmed Critical/High/Medium code-level security defect was found in current HEAD.
- Finding count: 1 total finding, consisting of 0 confirmed code defects and 1 manual-validation operational risk.
