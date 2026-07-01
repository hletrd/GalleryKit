# Cycle 79 Security + Privacy Review

Reviewer: security/privacy lane  
Date: 2026-07-01  
HEAD reviewed: `9cc143d06f3b4f9fe1862316c0f449f745926829`  
Scope: auth/authz, CSRF/same-origin, public API rate-limit coverage, SSRF, secret handling, DB backup/restore, upload/file path handling, privacy-sensitive fields, and deployment/security drift.

## Summary

No confirmed security or privacy issue was identified in this lane.

The post-Cycle-78 source delta is small and does not modify request handlers: `apps/web/Dockerfile`, `apps/web/scripts/check-public-route-rate-limit.ts`, and focused tests changed; the rest of the delta is review/plan context and `.gitignore`. The changed public-route rate-limit linter now avoids marker words in comments/strings while still checking AST call/new expressions for expensive work.

Older deferred items were not re-raised. In particular, Cycle 78 already carries the restore-maintenance whole-action foreground mutation barrier as a residual architecture item; this review found no new evidence changing its severity.

## Findings

### No Confirmed Finding - Auth/Authz And Admin API Protection

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: a new or existing `/api/admin/*` route accepts cookie-authenticated cross-site requests, unauthenticated access, or PAT access without the required scope.
- Evidence: admin API routes are wrapped by `withAdminAuth(...)` at `apps/web/src/app/api/admin/db/download/route.ts:21` and `apps/web/src/app/api/admin/lr/upload/route.ts:84`. The wrapper rate-limits PAT attempts, verifies token scope, clears request token context, and adds no-store/nosniff headers at `apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:83`, `apps/web/src/lib/api-auth.ts:90`, and `apps/web/src/lib/api-auth.ts:98`. Cookie-authenticated API requests must pass same-origin before `isAdmin()` at `apps/web/src/lib/api-auth.ts:114` and `apps/web/src/lib/api-auth.ts:123`.
- Suggested fix: none.

### No Confirmed Finding - CSRF / Same-Origin

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: mutating server actions or admin API requests mutate state from a forged cross-site form/fetch using the admin cookie.
- Evidence: the shared origin verifier fails closed without trusted `Origin` or `Referer` at `apps/web/src/lib/request-origin.ts:87` and compares normalized origin/referer to the expected host at `apps/web/src/lib/request-origin.ts:91`, `apps/web/src/lib/request-origin.ts:96`, and `apps/web/src/lib/request-origin.ts:101`. Mutating upload actions call `requireSameOriginAdmin()` before auth-dependent mutation at `apps/web/src/app/actions/images.ts:134`; DB backup/restore actions do the same at `apps/web/src/app/[locale]/admin/db-actions.ts:170` and `apps/web/src/app/[locale]/admin/db-actions.ts:367`.
- Suggested fix: none.

### No Confirmed Finding - Public API Rate-Limit Coverage

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: a public mutating route or expensive public GET/HEAD route performs DB/image/embedding work before a rate-limit pre-increment.
- Evidence: the modified linter detects mutating methods and expensive read methods at `apps/web/scripts/check-public-route-rate-limit.ts:37`, approved limiter imports at `apps/web/scripts/check-public-route-rate-limit.ts:43`, public route filtering at `apps/web/scripts/check-public-route-rate-limit.ts:128`, and expensive work by AST call/new expressions at `apps/web/scripts/check-public-route-rate-limit.ts:615`. The new tests prove marker words in string literals and comments are not false positives at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:419`. Current route sweep passed and reported OG/search routes rate-limited, while feed/upload/health routes carry explicit exemptions.
- Suggested fix: none.

### No Confirmed Finding - SSRF / Open Redirect

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: an attacker controls `Host`/`X-Forwarded-Host` to make server-side OG image generation fetch an attacker origin or redirect to an attacker-controlled fallback.
- Evidence: the per-photo OG route rate-limits before DB/image work at `apps/web/src/app/api/og/photo/[id]/route.tsx:100`, builds internal derivative fetches from the trusted canonical `BASE_URL` rather than request origin at `apps/web/src/app/api/og/photo/[id]/route.tsx:176`, parses `new URL(BASE_URL).origin` at `apps/web/src/app/api/og/photo/[id]/route.tsx:188`, and fails closed to a canonical fallback if canonical URL parsing fails at `apps/web/src/app/api/og/photo/[id]/route.tsx:191`.
- Suggested fix: none.

### No Confirmed Finding - Secret Handling

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: checked-in secrets, logged DB credentials, CLI password leakage through process arguments, or production session signing fallback to DB-stored data.
- Evidence: production refuses to use a DB-stored session secret when `SESSION_SECRET` is missing or too short at `apps/web/src/lib/session.ts:26`. Session tokens are HMAC-SHA256 signed and timing-safe compared at `apps/web/src/lib/session.ts:82` and `apps/web/src/lib/session.ts:117`. Backup/restore child processes pass DB credentials through `MYSQL_PWD` env rather than `-p` CLI arguments at `apps/web/src/app/[locale]/admin/db-actions.ts:221` and `apps/web/src/app/[locale]/admin/db-actions.ts:674`. Stderr redacts DB password and sensitive connection values at `apps/web/src/lib/sanitize.ts:117`. A repo-wide secret-pattern sweep found only test/example password literals and sanitizer comments.
- Suggested fix: none.

### No Confirmed Finding - DB Backup / Restore

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: unauthorized backup download, path traversal to arbitrary files, concurrent restore corruption, dangerous SQL import, plaintext secret log leakage, or restore against non-local MySQL without verified TLS.
- Evidence: backup download validates filename and realpath containment before streaming from an opened descriptor at `apps/web/src/app/api/admin/db/download/route.ts:23`, `apps/web/src/app/api/admin/db/download/route.ts:45`, `apps/web/src/app/api/admin/db/download/route.ts:51`, and `apps/web/src/app/api/admin/db/download/route.ts:58`. Backup writes owner-only files and checks plausible SQL dump headers at `apps/web/src/app/[locale]/admin/db-actions.ts:192`, `apps/web/src/app/[locale]/admin/db-actions.ts:230`, and `apps/web/src/app/[locale]/admin/db-actions.ts:300`. Restore takes advisory locks and upload/backfill locks at `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, and `apps/web/src/app/[locale]/admin/db-actions.ts:429`; streams uploaded SQL to a random temp path with `0600` mode at `apps/web/src/app/[locale]/admin/db-actions.ts:581`; scans for dangerous SQL at `apps/web/src/app/[locale]/admin/db-actions.ts:620` and blocks dangerous patterns including user/privilege, database/table destructive, `DO`, file IO, plugin, routine/view/definer, prepared statement, and global-setting classes at `apps/web/src/lib/sql-restore-scan.ts:61`. Non-local MySQL CLI TLS requires `DB_SSL_CA` unless `DB_SSL=false` at `apps/web/src/lib/mysql-cli-ssl.ts:3` and `apps/web/src/lib/mysql-cli-ssl.ts:18`.
- Suggested fix: none.

### No Confirmed Finding - Upload And File Path Handling

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: user-controlled filenames escape upload roots, public routes serve private originals, symlink traversal reaches arbitrary files, or upload quota can be bypassed before a claim.
- Evidence: browser uploads sanitize original client filenames before storing metadata at `apps/web/src/app/actions/images.ts:180`, claim quota synchronously before awaited disk/DB work at `apps/web/src/app/actions/images.ts:225`, and create private original/upload directories before disk checks at `apps/web/src/app/actions/images.ts:264`. Public derivative serving allowlists only `jpeg`, `webp`, and `avif` directories at `apps/web/src/lib/serve-upload.ts:15`, validates every segment at `apps/web/src/lib/serve-upload.ts:154`, rejects symlinks at `apps/web/src/lib/serve-upload.ts:182`, and checks realpath containment at `apps/web/src/lib/serve-upload.ts:186`. Private original resolution requires basename-only valid filenames, rejects symlinks, and checks root containment at `apps/web/src/lib/upload-paths.ts:120`, `apps/web/src/lib/upload-paths.ts:147`, `apps/web/src/lib/upload-paths.ts:160`, and `apps/web/src/lib/upload-paths.ts:165`. Lightroom upload route requires content length, caps body/file sizes, claims upload budget, and releases the upload contract lock in `finally` at `apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:117`, `apps/web/src/app/api/admin/lr/upload/route.ts:160`, and `apps/web/src/app/api/admin/lr/upload/route.ts:587`.
- Suggested fix: none.

### No Confirmed Finding - Privacy-Sensitive Fields

- Severity: N/A
- Confidence: High
- Failure scenario reviewed: public listings/search/map/search-enrichment routes expose GPS coordinates, original filenames, uploader IDs, source color/HDR internals, processing errors, or pipeline settings snapshots.
- Evidence: `publicSelectFields` explicitly omits latitude/longitude, original/user filenames, original format/size, processed state, HDR/color internals, uploader, processing diagnostics, and settings snapshots at `apps/web/src/lib/data.ts:368`. The compile-time sensitive-key guard is defined at `apps/web/src/lib/data.ts:473`. Public map select is the only unauthenticated path allowed to retain latitude/longitude and is documented as requiring the `map_visible` filter at `apps/web/src/lib/data.ts:410`. Search enrichment selects only public result-card fields and carries its own type guard at `apps/web/src/lib/search-enrichment-fields.ts:29` and `apps/web/src/lib/search-enrichment-fields.ts:43`. The privacy fixture enforces sensitive schema presence, public omission, symmetric admin-only keys, timeline omission, and search enrichment omission at `apps/web/src/__tests__/privacy-fields.test.ts:47`, `apps/web/src/__tests__/privacy-fields.test.ts:86`, `apps/web/src/__tests__/privacy-fields.test.ts:104`, and `apps/web/src/__tests__/privacy-fields.test.ts:126`.
- Suggested fix: none.

### No Confirmed Finding - Deployment / Security Drift

- Severity: N/A
- Confidence: Medium-High
- Failure scenario reviewed: Docker runtime loses required native Sharp deps, deploy scripts source unsafe env files, deploy auto-prune removes persistent data, or new Dockerfile behavior violates the production-container dependency boundary.
- Evidence: the Cycle 79 Dockerfile delta installs and smoke-loads runtime Sharp native packages in the `prod-deps` stage only, not in a running production container, at `apps/web/Dockerfile:63`, `apps/web/Dockerfile:77`, and `apps/web/Dockerfile:80`. The runner copies standalone output, immutable public assets, migrations, and production deps into the image at `apps/web/Dockerfile:132`, `apps/web/Dockerfile:135`, and `apps/web/Dockerfile:143`; persistent upload/resource/data paths are created as bind-mount targets at `apps/web/Dockerfile:145`. The deploy contract tests cover env-file permission refusal, prune-after-health ordering, no `docker volume prune -a`, config-driven remote deploy, and the new Sharp prod-deps smoke contract at `apps/web/src/__tests__/deploy-script-contract.test.ts:23`, `apps/web/src/__tests__/deploy-script-contract.test.ts:55`, `apps/web/src/__tests__/deploy-script-contract.test.ts:75`, and `apps/web/src/__tests__/deploy-script-contract.test.ts:264`.
- Suggested fix: none.

## Validation

- `git rev-parse HEAD` -> `9cc143d06f3b4f9fe1862316c0f449f745926829`.
- `npm run lint:api-auth --workspace=apps/web` passed: both admin API routes reported OK.
- `npm run lint:action-origin --workspace=apps/web` passed: all mutating server actions reported same-origin enforcement or approved exemptions; public view-recording actions reported rate-limited.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed: public OG/search routes reported rate-limited; cheap or cache-bounded public routes reported explicit exemptions.
- `npm audit --omit=dev --workspace=apps/web --audit-level=high` passed with `found 0 vulnerabilities`.
- Focused Vitest command passed: 12 files, 187 tests. Covered public-route rate-limit lint, deploy script contract, privacy fields, backup download, SQL restore scanner, MySQL CLI SSL, stderr sanitization, upload serving, OG fallback/source contracts, search privacy, Lightroom upload route, and images action blur wiring.
- `npm run typecheck --workspace=apps/web` passed, including app typecheck, script typecheck, Next route typegen, and JavaScript script checks.

## Residual Risk / Not Run

- Full `npm run lint --workspace=apps/web`, full `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and Playwright e2e were not run in this review lane.
- This was source/static/targeted-test review only. I did not inspect the live production host, live database rows, deployed env files, proxy config, or runtime logs.
- Restore SQL scanning remains a heuristic defense around an admin-only operation, not a formal SQL parser proof.
- Some public rate-limit fast paths remain in-memory and rely on the documented single web-instance topology.
- Admin users remain full-power by product design; no role/capability separation is implemented.
- DB backups remain plaintext at rest inside the documented operator boundary.
