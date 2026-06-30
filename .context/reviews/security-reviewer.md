# Cycle 32 Security Reviewer Report

Date: 2026-06-30
Role: security-reviewer
Scope: `/Users/hletrd/flash-shared/gallery` current working tree
Mode: review and report only. No source-code edits.

## Inventory

Read first:
- `AGENTS.md`
- `CLAUDE.md`

Auth, authz, session, token, and CSRF/origin surfaces:
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/proxy.ts`

Admin and public API surfaces:
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/actions/*.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`

Upload, path traversal, file serving, SSRF, backup/restore, SQL, deploy, and destructive-operation surfaces:
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`

Privacy, XSS/CSV/JSON-LD/CSP, sharing, and secrets:
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/csv-escape.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/og-sanitize.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`

## Validation Evidence

Commands run:
- `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities reported.
- `npm run lint:api-auth --workspace=apps/web`: passed; both admin API routes are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed; all scanned mutating server actions enforce same-origin provenance or carry explicit read-only/public exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; current public API routes have required rate-limit helpers or documented cheap-health exemptions.
- `npm test --workspace=apps/web -- src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/upload-paths.test.ts src/__tests__/db-restore.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/session-verify.test.ts src/__tests__/password-hashing-policy.test.ts src/__tests__/auth-rate-limit.test.ts`: passed, 15 files and 225 tests.

Secret sweep:
- Repo-wide scans for credential assignments, private-key markers, API keys, DB URLs, session secrets, and token prefixes found placeholders, docs/tests, env variable names, and intended code references only.
- Gitignored runtime secret files such as `.env.local` and `.env.deploy` were not read.

Final missed-security sweep:
- Searched exported route handlers, `withAdminAuth`, `hasTrustedSameOrigin`, `requireSameOriginAdmin`, public exemptions, `fetch`, child processes, Docker prune, `unlink`, SQL destructive statements, upload body parsing, `Content-Length`, `transfer-encoding`, and `client_max_body_size`.
- No uncited Critical or High issue found in current HEAD.

## Confirmed Issues

### SEC-C32-01 - Medium - Admin authorization is all-or-nothing, including backup, restore, and user management

Severity: Medium
Confidence: High
Category: Authz / privilege separation

Locations:
- `CLAUDE.md:5`
- `CLAUDE.md:234-236`
- `apps/web/src/app/actions/admin-users.ts:77-84`
- `apps/web/src/app/actions/admin-users.ts:186-204`
- `apps/web/src/app/[locale]/admin/db-actions.ts:164-175`
- `apps/web/src/app/[locale]/admin/db-actions.ts:365-371`
- `apps/web/src/app/api/admin/db/download/route.ts:21-29`

Finding:
- The product documents multiple root-admin accounts and no role/capability separation (`CLAUDE.md:5`, `234-236`).
- Any authenticated admin can create another admin after same-origin and `isAdmin()` checks (`admin-users.ts:77-84`), delete other admins subject only to self-delete and last-admin protections (`admin-users.ts:186-204`), create plaintext SQL backups (`db-actions.ts:164-175`), restore SQL dumps (`db-actions.ts:365-371`), and download backup files through the admin route (`route.ts:21-29`).
- The CSRF/session checks are strong; this is not an unauthenticated bypass. The issue is that every admin account is effectively a database/operator account.

Exploit/failure scenario:
- A photographer, contractor, or compromised admin account intended only for upload work can create another persistent admin account, download the full SQL backup, or restore a dump that rewrites application state. A phishing compromise of any admin therefore becomes full application takeover and data exfiltration, including admin tables, session rows, PAT hashes, audit rows, image metadata, share links, and settings.

Suggested fix:
- Introduce capability-scoped admin roles before adding lower-trust operators. At minimum split `backup:read`, `db:restore`, `admin-users:write`, `tokens:write`, and `upload:write`.
- Require fresh password re-authentication or a second confirmation factor before DB restore and backup download.
- Consider invalidating sessions and PATs after restore unless the restored dump provenance is cryptographically trusted.

### SEC-C32-02 - Medium - DB restore treats allowed application tables as trusted state, including auth tables

Severity: Medium
Confidence: High
Category: Database restore / supply-chain input

Locations:
- `apps/web/src/lib/sql-restore-scan.ts:12-31`
- `apps/web/src/lib/sql-restore-scan.ts:61-129`
- `apps/web/src/lib/sql-restore-scan.ts:210-251`
- `apps/web/src/app/[locale]/admin/db-actions.ts:570-649`
- `apps/web/src/app/[locale]/admin/db-actions.ts:651-680`

Finding:
- The restore scanner allowlist includes all app backup tables, including `admin_users`, `sessions`, and `admin_tokens` (`sql-restore-scan.ts:12-31`).
- It blocks dangerous statement classes and write targets outside app tables (`sql-restore-scan.ts:61-129`, `210-251`), and `runRestore` validates the dump header, scans chunks, requires DB config, and invokes `mysql --one-database` without shell interpolation (`db-actions.ts:570-680`).
- Those controls reduce cross-database and statement-class abuse, but a dump that stays within allowed app tables can still rewrite security-sensitive application state by design.

Exploit/failure scenario:
- If an admin is tricked into restoring a crafted but scanner-compliant dump, the dump can replace admin password hashes, add sessions, alter admin token hashes, change sharing links, or weaken site/security settings inside the GalleryKit database. The scanner should not be expected to distinguish a legitimate full backup from malicious rows in allowed tables.

Suggested fix:
- Treat SQL restore files as privileged executable state. Require provenance controls such as signed backups, backup-origin metadata, or an operator-only restore workflow.
- Before production use, verify MySQL grants for `DB_USER` are restricted to the configured `DB_NAME.*` and exclude global, sibling-schema, FILE, user-management, routine, event, plugin, and server-admin privileges.
- Consider post-restore invalidation of sessions/PATs and a restore preview that highlights auth-table changes.

### SEC-C32-03 - Low - Public expensive-route and token-spray limits are process-local under a documented single-instance assumption

Severity: Low
Confidence: High
Category: Rate limiting / deployment topology

Locations:
- `CLAUDE.md:234-236`
- `apps/web/docker-compose.yml:3-22`
- `apps/web/src/lib/rate-limit.ts:74-99`
- `apps/web/src/lib/rate-limit.ts:238-254`
- `apps/web/src/lib/rate-limit.ts:318-375`
- `apps/web/src/app/api/search/semantic/route.ts:173-201`
- `apps/web/src/app/api/search/similar/[id]/route.ts:98-126`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:98-109`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:104-117`

Finding:
- The documented production topology is a single web instance and explicitly warns not to horizontally scale until process-local coordination state is moved to shared storage (`CLAUDE.md:234-236`).
- The compose file defines one `web` service with host networking and `TRUST_PROXY=true` (`docker-compose.yml:3-22`).
- Several budgets are in process memory: admin-token spray guard (`rate-limit.ts:74-76`, `238-254`), OG/share lookup budgets (`rate-limit.ts:78-99`, `318-345`), and semantic budgets (`rate-limit.ts:354-375`). Current routes use them before expensive work (`semantic/route.ts:173-201`, `similar/[id]/route.ts:98-126`, `s/[key]/page.tsx:98-109`, `g/[key]/page.tsx:104-117`).

Exploit/failure scenario:
- If the app is scaled to multiple Node processes or hosts, an attacker can multiply effective request budgets by spreading traffic across instances. Public OG/share/semantic work and invalid PAT spray become per-instance rather than global. A restart also clears the process-local budgets.

Suggested fix:
- Preserve the single-instance deployment contract unless these limits are moved to a shared store or enforced at the edge.
- Before horizontal scaling, move public expensive-route, share lookup, semantic, and PAT pre-auth budgets into Redis/MySQL/edge rate limiting, and re-check upload/queue/restore coordination state.

### SEC-C32-04 - Low - Plaintext SQL backups are an operator storage boundary

Severity: Low
Confidence: High
Category: Backup confidentiality / host security

Locations:
- `CLAUDE.md:213-218`
- `apps/web/src/app/[locale]/admin/db-actions.ts:185-192`
- `apps/web/src/app/[locale]/admin/db-actions.ts:221-230`
- `apps/web/src/app/[locale]/admin/db-actions.ts:288-332`
- `apps/web/src/app/api/admin/db/download/route.ts:21-29`
- `apps/web/src/app/api/admin/db/download/route.ts:45-90`

Finding:
- The docs explicitly state DB backups are plaintext SQL at rest and that host/storage encryption is the operator boundary (`CLAUDE.md:213-218`).
- The implementation creates `data/backups` owner-only and writes backup files as `0600` (`db-actions.ts:185-192`, `221-230`), validates non-empty plausible SQL output before returning a URL (`db-actions.ts:288-332`), and streams downloads only after admin auth, filename validation, realpath containment, file-handle validation, and no-store/nosniff headers (`route.ts:21-29`, `45-90`).
- These are good application controls, but backup files still contain full database contents in plaintext.

Exploit/failure scenario:
- A host filesystem compromise, overly broad host user access, leaked VM snapshot, or insecure backup sync can expose admin password hashes, session rows, token hashes, share links, image metadata, audit logs, and settings without needing to exploit the web app.

Suggested fix:
- Encrypt backup storage or move backups to an encrypted host path with explicit retention.
- Add backup aging/pruning policy if not handled outside the app.
- Keep `.env.deploy` and deploy-host access limited because deployment scripts can reach the same persisted data boundary.

## Reviewed Controls With No Finding

Auth/session:
- Production refuses a DB-stored session-secret fallback and requires `SESSION_SECRET` (`session.ts:19-35`).
- Session tokens are HMAC-SHA256 verified with `timingSafeEqual`, then checked against a DB hash and expiry (`session.ts:107-148`).
- Login uses same-origin checks, per-IP and per-account rate limiting, a dummy Argon2 hash for missing users, transaction-based session insertion/old-session deletion, and `httpOnly`/`secure`/`sameSite=lax` cookies (`auth.ts:95-185`, `205-242`).

CSRF/origin:
- Same-origin checking fails closed without matching `Origin` or `Referer` (`request-origin.ts:87-107`).
- Admin API cookie auth checks origin before `isAdmin()` (`api-auth.ts:114-129`).
- Admin token auth is intentionally cross-origin only for routes that opt into a scope; the current LR upload route opts into `lr:upload` (`api-auth.ts:68-111`, `api/admin/lr/upload/route.ts:548-555`).

Rate limiting:
- Public search/load-more actions validate inputs and rate-limit before DB search/page loads (`public.ts:121-168`, `170-234`, `236-318`).
- Public semantic and similar-search routes enforce origin, body/id validation, and pre-increment limits before semantic config/vector work (`semantic/route.ts:107-184`, `similar/[id]/route.ts:68-126`).
- Security lints pin admin API auth, action-origin checks, and public route rate-limit coverage.

SSRF:
- Per-photo OG fetches use a bounded same-origin derivative path, byte caps, and fetch timeouts (`og-photo-fetch.ts:64-94`), with route-level canonical-origin hardening reviewed in `CLAUDE.md:222`.

Path traversal and upload safety:
- Public derivative serving whitelists top-level dirs/extensions, rejects unsafe segments, symlinks, and realpath escapes before opening files (`serve-upload.ts:132-195`).
- Private original upload storage is outside public uploads, owner-only, and original path resolution rejects unsafe filenames, symlinks, and realpath escapes (`upload-paths.ts:49-57`, `120-170`).
- nginx blocks `/uploads/original/` and only proxies derivative formats (`nginx/default.conf:165-185`).
- Upload and semantic endpoints reject chunked bodies where size must be known and enforce `Content-Length`/body limits (`api/admin/lr/upload/route.ts:85-173`, `semantic/route.ts:136-167`).

Privacy/XSS/content handling:
- Public selectors omit sensitive/admin-only image fields, with compile-time and test guards (`data.ts:368-489`; `privacy-fields.test.ts:47-131`).
- Map GPS is intentionally exposed only through the map-visible selector/filter path; no broad public selector leak found.
- JSON-LD and OG text sanitizers escape or strip risky characters; CSP and security headers are configured in Next/nginx (`safe-json-ld.ts:14-19`, `og-sanitize.ts:24-30`, `next.config.ts:75-88`, `nginx/default.conf:49-55`).

Deploy/destructive operations:
- `apps/web/deploy.sh` prunes Docker artifacts only after a successful `up -d` and health check; comments document bind-mounted persistence and no `volume prune -a` (`deploy.sh:56-81`).
- `scripts/deploy-remote.sh` refuses group/world-readable deploy env files before sourcing them, then executes the derived or explicit deploy command (`deploy-remote.sh:61-86`). Treat the deploy env file as a local code-execution boundary.

## Final Sweep Result

No Critical or High vulnerabilities were confirmed. The main residual risks are intentional trust-boundary decisions: root-admin equivalence, full-state DB restore, single-instance process-local coordination, and plaintext backup storage at the host boundary.
