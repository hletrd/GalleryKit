# Security Reviewer Report - Review-Plan-Fix Cycle 33

Date: 2026-06-30
Scope: `/Users/hletrd/flash-shared/gallery`
Lane: `security-reviewer`

## Executive Summary

No Critical or High severity vulnerabilities were confirmed in this pass.

The app has strong baseline controls for admin authentication, HMAC-backed sessions, same-origin enforcement on mutating server actions, admin API wrapping, path containment for uploads/downloads, public-field privacy guards, and focused security lint/test coverage. The remaining findings are trust-boundary risks rather than obvious missing guards: all admins are root-equivalent, restore accepts scanner-compliant state for sensitive auth tables, several expensive public/PAT limits are process-local, and SQL backups remain plaintext inside the operator/host boundary.

## Inventory

Relevant files and flows inspected:

- Project guidance and threat model: `AGENTS.md`, `CLAUDE.md`
- Auth/session/token core: `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`
- Admin actions and APIs: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`
- Backup/restore/raw SQL: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/sanitize.ts`, `apps/web/scripts/migrate.js`
- Uploads/file/path handling: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/process-image.ts`
- Public/search/share/OG/privacy flows: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- Rate limiting and network/deploy boundaries: `apps/web/src/lib/rate-limit.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/Dockerfile`
- Security tests/lints: `apps/web/src/__tests__/check-api-auth.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`, `apps/web/src/__tests__/request-origin.test.ts`, `apps/web/src/__tests__/serve-upload.test.ts`, `apps/web/src/__tests__/upload-paths.test.ts`, `apps/web/src/__tests__/db-restore.test.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/tracked-secrets.test.ts`, `apps/web/src/__tests__/backup-download-route.test.ts`, `apps/web/src/__tests__/content-security-policy.test.ts`, `apps/web/src/__tests__/session-verify.test.ts`, `apps/web/src/__tests__/password-hashing-policy.test.ts`, `apps/web/src/__tests__/auth-rate-limit.test.ts`

## Validation Evidence

- `npm audit --workspace=apps/web --audit-level=low --json`: passed, 0 vulnerabilities reported.
- `npm run lint:api-auth --workspace=apps/web`: passed; admin API exports are wrapped as expected.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating server actions have same-origin enforcement or explicit exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; scanned public routes have required rate-limit coverage or documented exemptions.
- Focused security test suite: passed, 15 files and 225 tests.
  - Included API auth, action origin, public route rate-limit, request-origin, upload serving/path containment, DB restore scanning, privacy fields, tracked secret scanning, backup download, CSP, session verification, password hashing policy, and auth rate limiting.

## Findings

### SEC-C33-01 - Root-equivalent admin accounts widen compromise blast radius

Severity: Medium
Confidence: High
OWASP: A01 Broken Access Control, A04 Insecure Design

Evidence:

- `CLAUDE.md:5` documents multiple root-admin accounts.
- `CLAUDE.md:234-236` explicitly documents no role/capability model and calls the boundary root admin plus host operator trust.
- `apps/web/src/app/actions/admin-users.ts:77-84` allows any current admin to create another admin after same-origin/admin checks.
- `apps/web/src/app/actions/admin-users.ts:186-204` blocks self-delete and last-admin deletion, but otherwise any admin can delete other admins.
- `apps/web/src/app/[locale]/admin/db-actions.ts:164-175` allows any admin to create a DB backup.
- `apps/web/src/app/[locale]/admin/db-actions.ts:365-372` allows any admin to start DB restore.
- `apps/web/src/app/api/admin/db/download/route.ts:21-29` allows any admin to download a named backup file.

Exploit/failure scenario:

A phishing-compromised or low-trust admin account can create persistent admin users, remove other admins except the last/self-protected cases, download full SQL backups, and restore arbitrary scanner-compliant application state. That turns one admin session compromise into full confidentiality, integrity, and persistence compromise for the gallery.

Suggested fixes:

- Add capability-scoped admin roles for destructive or highly sensitive operations: user management, backup download, restore, Lightroom PAT creation/revocation, and site settings.
- Require fresh re-authentication and ideally a second factor for backup download, restore, user creation/deletion, and token issuance.
- Add audit log review surfaces for these actions and consider notification hooks for root-equivalent operations.
- Invalidate existing sessions and PATs after privilege-changing events where operationally acceptable.

### SEC-C33-02 - Restore accepts sensitive auth/session/token table state from scanner-compliant dumps

Severity: Medium
Confidence: High
OWASP: A01 Broken Access Control, A04 Insecure Design, A08 Software and Data Integrity Failures

Evidence:

- `apps/web/src/lib/sql-restore-scan.ts:12-31` includes sensitive application tables in the allowed restore target set, including `admin_users`, `sessions`, and `admin_tokens`.
- `apps/web/src/lib/sql-restore-scan.ts:61-129` blocks dangerous SQL primitives such as `DROP DATABASE`, `CREATE USER`, `GRANT`, `LOAD DATA`, `INTO OUTFILE`, and related server-level operations.
- `apps/web/src/lib/sql-restore-scan.ts:210-251` rejects writes to disallowed tables but does not distinguish benign from malicious data inside allowed auth/session/token tables.
- `apps/web/src/app/[locale]/admin/db-actions.ts:570-649` saves, size-checks, header-checks, and scanner-checks uploaded SQL before restore.
- `apps/web/src/app/[locale]/admin/db-actions.ts:651-680` runs `mysql --one-database` with array arguments and sanitized environment.
- `apps/web/src/app/[locale]/admin/db-actions.ts:718-744` reruns migrations and audits after restore, but does not prove backup provenance or invalidate restored credentials.

Exploit/failure scenario:

An admin can upload a syntactically allowed SQL dump that changes rows in `admin_users`, reintroduces active `sessions`, or installs `admin_tokens` with chosen hashed values. The scanner appropriately prevents server-level SQL abuse, but a malicious or stale application-state restore can still rewrite the app's security state.

Suggested fixes:

- Treat restore as a privileged recovery operation separate from ordinary admin rights.
- Sign backups at creation time and verify signature/provenance before restore.
- Add a restore preview that highlights changes to `admin_users`, `sessions`, `admin_tokens`, and site settings before execution.
- After restore, rotate or delete all sessions and PATs by default, with an explicit recovery-mode exception if needed.
- Use a DB account for restore with only the minimum schema/data privileges needed for this app.

### SEC-C33-03 - Process-local limits depend on single-instance deployment assumptions

Severity: Low
Confidence: High
OWASP: A04 Insecure Design, A07 Identification and Authentication Failures

Evidence:

- `CLAUDE.md:234-236` documents single-process assumptions for rate limiting and locks.
- `apps/web/docker-compose.yml:3-22` defines a single `web` service deployment.
- `apps/web/src/lib/rate-limit.ts:74-99` defines in-memory windows for PAT auth, OG, share, semantic, and upload-related limits.
- `apps/web/src/lib/rate-limit.ts:238-254` implements PAT auth pre-increment in process memory.
- `apps/web/src/lib/rate-limit.ts:318-375` implements share and semantic pre-increment in process memory.
- `apps/web/src/app/api/search/semantic/route.ts:173-201` charges semantic limits before expensive config/model work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:98-126` charges similar-search limits before semantic lookup.
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:98-109` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:104-117` charge share limits before lookup.

Exploit/failure scenario:

If the app is scaled horizontally, restarted frequently, or placed behind multiple independent Node processes, attackers can multiply or reset per-IP budgets for PAT brute force attempts, semantic-search cost, share-link enumeration attempts, and OG render work. Current controls are sound for the documented single-instance deployment, but the assumption is security-sensitive.

Suggested fixes:

- Keep the single-instance invariant explicit in deploy/runbooks and block accidental multi-replica deployment unless shared limits are configured.
- Move PAT auth, public search, share, and OG rate-limit counters to Redis, MySQL, or another shared store before horizontal scaling.
- Add a startup warning or health assertion when a multi-worker/multi-instance topology is detected without distributed rate limiting.

### SEC-C33-04 - Plaintext SQL backups are protected only by host/operator controls

Severity: Low
Confidence: High
OWASP: A02 Cryptographic Failures, A09 Security Logging and Monitoring Failures

Evidence:

- `CLAUDE.md:213-218` documents plaintext SQL backup handling and places backup confidentiality at the root admin plus host operator boundary.
- `apps/web/src/app/[locale]/admin/db-actions.ts:185-192` creates the backup directory with restrictive permissions.
- `apps/web/src/app/[locale]/admin/db-actions.ts:221-230` writes dumps using `0o600`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:288-332` verifies the dump and returns an authenticated download URL.
- `apps/web/src/app/api/admin/db/download/route.ts:21-29` requires admin auth and validates filename shape.
- `apps/web/src/app/api/admin/db/download/route.ts:45-90` enforces path containment, opens a file descriptor, audits download, and streams with `no-store` and `nosniff`.

Exploit/failure scenario:

A compromised deploy host account, leaked filesystem snapshot, or overly broad backup copy can expose plaintext SQL containing password hashes, sessions, token hashes, metadata, share links, and operational state. The app-level download path is well guarded, but at-rest confidentiality depends on host controls.

Suggested fixes:

- Encrypt SQL backups at rest before writing or immediately after creation, preferably with a key outside the web container filesystem.
- Add retention/pruning controls so sensitive dumps are not kept indefinitely.
- Document and enforce host-level backup access boundaries.
- Consider excluding or post-processing volatile auth/session/token rows in operator-facing backups when full forensic restore is not required.

## Reviewed Controls With No Confirmed Finding

- Admin sessions: `apps/web/src/lib/session.ts:16-35` requires `SESSION_SECRET` in production and refuses the legacy database fallback there. `apps/web/src/lib/session.ts:94-150` verifies token shape, HMAC, age, hash, and expiry.
- Admin API auth: `apps/web/src/lib/api-auth.ts:68-111` handles scoped PAT auth with pre-increment rate limiting and constant-time token verification. `apps/web/src/lib/api-auth.ts:114-129` enforces same-origin admin cookie auth for non-token paths.
- CSRF/same-origin: `apps/web/src/lib/request-origin.ts:79-107` fails closed for unsafe methods when origin checks fail. Security lint confirmed mutating server actions carry same-origin guards.
- Login/password controls: `apps/web/src/app/actions/auth.ts:95-180` enforces same-origin checks, per-IP/account login limits, DB availability checks, and dummy Argon2 verification on missing users. `apps/web/src/app/actions/auth.ts:287-416` enforces same-origin checks, current-password verification, rate limiting, password hashing, and session rotation for password changes.
- Upload path traversal: `apps/web/src/lib/upload-paths.ts:124-170`, `apps/web/src/lib/serve-upload.ts:132-190`, and `apps/web/src/lib/storage/local.ts:41-61` apply path normalization, extension allowlists, realpath checks, symlink rejection, and containment checks.
- Upload handling: `apps/web/src/app/actions/images.ts:128-205` and `apps/web/src/app/api/admin/lr/upload/route.ts:68-112` apply admin auth, same-origin/token scope checks, file count/size/content-length validation, maintenance gates, and upload-lock/disk-space controls before processing.
- Public derivative serving: `apps/web/src/lib/serve-upload.ts:197-280` streams only allowed derivative directories/extensions with cache and `nosniff`; private originals are not served.
- Privacy guards: `apps/web/src/lib/data.ts:368-489` and `apps/web/src/lib/search-enrichment-fields.ts:29-47` keep public select fields separate from admin/PII fields with compile-time guard coverage.
- XSS/markup: `apps/web/src/lib/safe-json-ld.ts:14-19` escapes dangerous JSON-LD characters; `apps/web/src/lib/content-security-policy.ts:68-123` builds a production CSP with nonce-based scripts, object blocking, base-uri restrictions, and frame-ancestor restrictions.
- SSRF/OG image fetch: `apps/web/src/lib/seo-og-url.ts:3-43`, `apps/web/src/app/api/og/photo/[id]/route.tsx:97-129`, and `apps/web/src/lib/og-photo-fetch.ts:64-118` keep OG image fetches pinned to the configured internal origin and bounded by timeout/content-length/body budgets.
- Backup download traversal: `apps/web/src/app/api/admin/db/download/route.ts:23-67` validates backup filenames, verifies realpath containment, rejects directories, and opens a descriptor before streaming.
- Raw SQL/command execution: reviewed SQL restore, migration, and admin DB actions. The restore path uses scanner checks and array arguments for `mysql`/`mysqldump`; Drizzle query templates or parameter arrays are used for request-derived values in inspected flows.
- Secrets: focused tracked-secret tests passed. Tracked example env files are present; real `.env.local` and `.env.deploy` are not tracked in the inspected git file list.
- Deployment safety: `apps/web/nginx/default.conf:58-185` applies body limits, upload-original blocking, derivative-only upload proxying, and proxy header normalization. `apps/web/deploy.sh:56-81` keeps disk cleanup after successful health checks and avoids `volume prune -a`.

## Final Sweep Result

Final sweep covered auth/authz, OWASP access-control and integrity boundaries, secrets, raw SQL, command invocation, SSRF, XSS/CSP, CSRF/same-origin, rate limiting, upload/file/path handling, backup/restore, and public privacy surfaces. No additional Critical or High severity issues were confirmed. The four findings above are the remaining security-relevant risks to track for remediation or explicit acceptance.
