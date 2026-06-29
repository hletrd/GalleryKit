# Security Reviewer - cycle 9

Role: `security-reviewer`
HEAD reviewed: `23e96c34fb08`
Date: 2026-06-29
Scope: full repository security review for `/Users/hletrd/flash-shared/gallery`; report-only lane. No source code or plan files edited.

## Inspection Inventory

Read first:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/security-review/SKILL.md`

Repository inventory reviewed:
- 2,532 tracked files total.
- 495 tracked files under `apps/web/src/**`.
- 8 API route files under `apps/web/src/app/api/**`: admin DB download, Lightroom upload, health/live, topic OG, photo OG, semantic search, and similar search.
- 14 server-action files: `apps/web/src/app/actions/*.ts` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- 27 Drizzle SQL migrations plus migration journal state.
- Relevant docs and review history: `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/**`, `plan/**`, and `.context/reviews/**`.

Review-relevant file groups covered:
- Auth/authz/sessions/PATs: `apps/web/src/lib/api-auth.ts`, `session.ts`, `password-hashing.ts`, `admin-tokens.ts`, `request-origin.ts`, `action-guards.ts`, `auth-rate-limit.ts`, `rate-limit.ts`, `proxy.ts`, `app/actions/auth.ts`, `app/actions/lr-tokens.ts`, `app/actions/admin-users.ts`.
- Admin APIs and same-origin defenses: all `apps/web/src/app/api/admin/**/route.{ts,tsx}`, all mutating server actions, lint guard scripts under `apps/web/scripts/check-*.ts`.
- Public mutating surfaces and rate limits: `app/actions/public.ts`, `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts`, share pages, OG routes.
- Upload/file handling/path traversal: `process-image.ts`, `process-topic-image.ts`, `serve-upload.ts`, `upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `storage/local.ts`, `gps-exif-strip.ts`, upload tracker/contract lock helpers, nginx upload locations.
- SSRF/XSS/output injection: `api/og/**`, `og-photo-fetch.ts`, `ensure-site-config.mjs`, `safe-json-ld.ts`, `og-sanitize.ts`, `seo-og-url.ts`, `content-security-policy.ts`, `proxy.ts`, `csv-escape.ts`, `atom-feed.ts`, SEO actions/pages.
- SQL/raw query/restore/migrations: `db-actions.ts`, `sql-restore-scan.ts`, `db-restore.ts`, `backup-filename.ts`, `download-filename.ts`, `scripts/migrate.js`, `scripts/mysql-connection-options.js`, `smart-collections.ts`, data/search modules.
- Secrets/deploy: tracked env examples, `.gitignore`, Dockerfiles, compose, nginx, deploy helpers, GitHub Actions quality workflow, CLIP model download/manifest scripts.
- Privacy leaks: `data.ts`, `search-enrichment-fields.ts`, public photo/topic/share/map pages, privacy tests and fixtures, map/GPS handling, direct download filename helpers.

Coverage targets explicitly checked: OWASP Top 10, auth/authz, sessions, PAT scopes, admin APIs, same-origin defenses, public mutating route rate limits, upload/file handling, path traversal, SSRF/open redirect, XSS, CSV/JSON-LD/OG injection, secrets, SQL raw query safety, migrations/restore, deploy scripts, and privacy leaks.

## Validation Evidence

Commands run:
- `npm run lint:api-auth --workspace=apps/web` - passed; both admin API routes are wrapped.
- `npm run lint:action-origin --workspace=apps/web` - passed; mutating server actions enforce same-origin or documented exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed; public mutating API route exports use rate-limit pre-increment helpers or documented exemptions.
- `npm audit --workspace=apps/web --omit=dev` - passed; 0 vulnerabilities.
- `npm audit --workspace=apps/web` - passed; 0 vulnerabilities.
- Targeted security test set - 17 files, 162 tests passed:
  `tracked-secrets`, `request-origin`, `safe-json-ld`, `csv-escape`, `serve-upload`, `backup-download-route`, `sql-restore-scan`, `db-restore`, `privacy-fields`, `search-route-privacy`, `admin-tokens`, `session`, `password-hashing-policy`, `seo-actions`, `og-sanitize`, `upload-filenames`, `upload-paths`.

Worktree note: `.context/reviews/verifier.md` was already modified before this report write and was not touched.

## Confirmed Issues

### C9-SEC-01 - Tracked review/plan artifacts still contain credential-assignment strings

Severity: Low
Confidence: High
Status: confirmed issue
OWASP: A02 Cryptographic Failures; A05 Security Misconfiguration

File/region:
- `.context/plans/done/plan-166-cycle1-admin-upload-test-and-docs.md:22`
- `.context/reviews/archive/security-reviewer-cycle1-rpf.md:167-196`
- `.context/reviews/archive/security-reviewer-cycle7-rpf.md:36-38`
- `.context/reviews/logs-cycle4/designer.log:2467`
- `.context/reviews/run7-cycle1/security-reviewer.md:42`
- `plan/plan-353-run6-cycle3-deferred.md:168`
- Current narrow scanner: `apps/web/src/__tests__/tracked-secrets.test.ts:5-20`

Problem:
The app env examples are placeholders and ignored local env files are not tracked, but several committed review/plan/log artifacts still contain literal credential-assignment patterns or historical credential references. Some are placeholders or truncated historical values, but they remain committed strings matching secret shapes. The current tracked-secrets test only scans a fixed artifact allowlist rather than all committed `.md`/`.log` review and plan material.

Concrete failure scenario:
A future operator or automation indexes `.context`/`plan` files, copies an old credential-looking assignment into an environment, or secret-scanning infrastructure treats the repository as containing live credentials. If any historical value was ever reused after the documented rotation warning, this keeps the value discoverable.

Suggested fix:
Redact committed review/plan/log credential assignments to placeholders without preserving concrete values. Expand `tracked-secrets.test.ts` to scan all tracked `.md`, `.log`, `.env*`, `.yml`, `.yaml`, `.ts`, `.tsx`, `.js`, and `.mjs` files, with explicit placeholder allowlists and no hard-coded subset of review artifacts.

### C9-SEC-02 - Lightroom upload can relay raw processor error messages to PAT callers

Severity: Low
Confidence: Medium
Status: confirmed defensive-boundary issue
OWASP: A05 Security Misconfiguration; A09 Security Logging and Monitoring Failures

File/region:
- `apps/web/src/app/api/admin/lr/upload/route.ts:284-304`
- `apps/web/src/lib/process-image.ts:844-887`

Problem:
The Lightroom PAT upload route catches non-RAW failures from `saveOriginalAndGetMetadata()` and returns `err.message` directly to the client at `route.ts:303-304`. Current `saveOriginalAndGetMetadata()` mostly throws generic validation messages, but this route boundary will expose any future internal processor, filesystem, or image-library error message that escapes that helper.

Concrete failure scenario:
An attacker with a stolen or over-broad `lr:upload` token submits malformed images repeatedly. If a future Sharp/libvips, storage, or metadata path throws an error containing local paths, codec internals, or operational details, the route returns that string over the API instead of keeping it server-side.

Suggested fix:
Return a fixed client message for unknown non-RAW upload failures, such as `Invalid image file` or `Upload failed`, while logging the detailed exception server-side. Keep the explicit RAW rejection message, because that is intentionally user-actionable and not sensitive.

## Likely Issues

No likely exploitable auth, CSRF, upload traversal, SQL injection, SSRF, XSS, or privacy leak issues were identified beyond the two confirmed low-severity items above.

## Risks Needing Manual Validation

### C9-RISK-01 - TLS and HSTS rely on the external edge topology

Severity if misdeployed: High
Confidence: Medium
Status: deployment risk needing manual validation
OWASP: A02 Cryptographic Failures; A05 Security Misconfiguration

File/region:
- `apps/web/nginx/default.conf:21-31`
- `apps/web/nginx/default.conf:47-53`
- `README.md:145-151`
- `apps/web/src/app/actions/auth.ts:225-238`

Problem:
The checked-in nginx server listens on port 80 and documents that a TLS-terminating edge/load balancer sits in front of it. It also emits HSTS from that server block. This is safe only if production actually blocks or redirects public cleartext access before this listener.

Concrete failure scenario:
If this nginx config becomes the public edge without a 443 server or redirect/block rule, users can reach the gallery over HTTP. Production cookies are set `Secure`, but cleartext transport can still expose login form traffic, origin calculation, and downgrade/confusion behavior.

Suggested fix:
Validate the live production ingress: public 80 should redirect to HTTPS or be blocked, and the TLS edge should overwrite trusted forwarding headers. Consider adding a deploy-time smoke probe that fails when `BASE_URL` is HTTPS but direct HTTP serves the app instead of redirecting.

### C9-RISK-02 - `TRUST_PROXY=true` is safe only if direct app access and forwarded headers are controlled

Severity if misconfigured: Medium
Confidence: High
Status: deployment risk needing manual validation
OWASP: A01 Broken Access Control; A05 Security Misconfiguration

File/region:
- `apps/web/docker-compose.yml:14-21`
- `apps/web/nginx/default.conf:65-69`, `82-86`, `99-103`, `139-143`, `155-160`, `178-182`
- `apps/web/src/lib/request-origin.ts:45-69`
- `apps/web/src/lib/request-origin.ts:79-107`
- `README.md:149-151`

Problem:
The app sets `TRUST_PROXY=true` and same-origin/rate-limit logic trusts forwarded host/proto/client-IP headers when that flag is enabled. The documented compose setup binds the app to `127.0.0.1` and nginx overwrites forwarding headers, which is the intended safe posture. Any topology drift that exposes port 3000 directly, appends untrusted forwarded chains, or fails to normalize incoming edge headers can weaken rate limits and origin checks.

Concrete failure scenario:
If the Node app is reachable directly with `TRUST_PROXY=true`, a requester can spoof `X-Forwarded-For` to evade per-IP public route budgets. In a worse misconfiguration, spoofed `X-Forwarded-Host` / `X-Forwarded-Proto` can alter the expected origin used by same-origin checks.

Suggested fix:
Validate port 3000 is loopback-only from untrusted networks, the edge strips inbound `X-Forwarded-*`, and nginx sets a single trusted value. Keep `TRUSTED_PROXY_HOPS` aligned with the actual hop count, and add an operational ingress test that sends spoofed forwarded headers and verifies rate-limit/origin behavior.

### C9-RISK-03 - Process-local security controls assume one web instance

Severity if scaled out: Medium
Confidence: High
Status: architecture risk needing manual validation before scale-out
OWASP: A04 Insecure Design; A05 Security Misconfiguration

File/region:
- `README.md:149`
- `CLAUDE.md:226-229`
- `apps/web/src/app/api/search/semantic/route.ts:178-189`
- `apps/web/src/app/api/search/similar/[id]/route.ts:85-95`
- `apps/web/src/app/api/admin/lr/upload/route.ts:98-125`

Problem:
The documented deployment is intentionally single web-instance/single-writer. Several protections are process-local: restore maintenance flags, upload quota tracking, image queue state, public OG/share/search/semantic fast-path rate limits, and some buffered analytics.

Concrete failure scenario:
If the web service is horizontally scaled behind a load balancer without moving these states into shared storage, an attacker can distribute requests across instances and multiply public route budgets. Upload/restore coordination can also become inconsistent across workers.

Suggested fix:
Do not scale the web tier horizontally until these states move to shared storage or a durable coordinator. At minimum, use a shared rate-limit store, shared restore-maintenance state, shared upload quota state, and queue coordination that works across processes.

### C9-RISK-04 - Multiple root admins and deferred 2FA are acceptable only for the current personal-gallery threat model

Severity if threat model expands: Medium
Confidence: High
Status: product/security risk needing manual validation
OWASP: A01 Broken Access Control; A07 Identification and Authentication Failures

File/region:
- `CLAUDE.md:228`
- `CLAUDE.md:552-553`
- `apps/web/src/lib/admin-tokens.ts:24-25`
- `apps/web/src/app/[locale]/admin/db-actions.ts:47-52`, `125-130`, `272-277`

Problem:
All admins are root admins. Any admin can upload/edit photos, export/restore the database, manage settings, create/revoke Lightroom PATs, and manage other admins. 2FA/WebAuthn is explicitly deferred as not planned for a personal gallery.

Concrete failure scenario:
If the installation adds semi-trusted assistants, clients, contractors, or a public-facing admin team, compromise or misuse of one admin account grants full destructive and exfiltration capability, including DB backup export/restore and PAT creation.

Suggested fix:
Keep the current model only if all admins are equally trusted operators. If that changes, add role/capability separation for owner-only operations, especially DB restore/export, admin management, settings, and PAT issuance. Reconsider WebAuthn/TOTP for internet-exposed multi-admin deployments.

### C9-RISK-05 - Database backups are plaintext at rest and do not cover filesystem rollback

Severity: Low to Medium, depending on host controls
Confidence: High
Status: operational risk needing manual validation
OWASP: A02 Cryptographic Failures; A04 Insecure Design

File/region:
- `CLAUDE.md:208-209`
- `apps/web/src/app/[locale]/admin/db-actions.ts:140-147`
- `apps/web/src/app/[locale]/admin/db-actions.ts:166`
- `apps/web/src/app/api/admin/db/download/route.ts:78-86`

Problem:
DB dumps are written under non-public `data/backups/` with owner-only directory/file modes and served only through an authenticated no-store route. They are still plaintext SQL at rest. The documented restore is SQL-only and does not snapshot or roll back `data/uploads/original`, `public/uploads`, or `public/resources`.

Concrete failure scenario:
A host filesystem compromise, over-broad host backup, or disk snapshot exposure discloses photo metadata, password hashes, token hashes, audit data, and settings from plaintext SQL dumps. Separately, a DB restore after a bad deploy does not recover deleted or mismatched upload files without host-level filesystem backups.

Suggested fix:
Validate host disk encryption and backup access controls. Consider encrypting DB dumps before storing them, or documenting that `data/backups` must live on encrypted storage. Pair DB restore procedures with filesystem backup/reconciliation procedures for original and derivative assets.

### C9-RISK-06 - Deploy command escape hatch is intentionally powerful

Severity if deploy env is compromised: Medium
Confidence: High
Status: operational risk needing manual validation
OWASP: A05 Security Misconfiguration

File/region:
- `README.md:116`
- `scripts/deploy-remote.sh:61-72`
- `.env.deploy.example`

Problem:
`DEPLOY_CMD` is documented as an escape hatch for a fully custom deploy command, and `scripts/deploy-remote.sh` executes the derived command through `bash -lc`. This is intentional operator-controlled behavior, but it means the gitignored `.env.deploy` file is equivalent to local shell execution authority.

Concrete failure scenario:
If `.env.deploy` is modified by malware or exposed to an untrusted editor, the next `npm run deploy` can run arbitrary local SSH/deploy commands under the operator's account.

Suggested fix:
Treat `.env.deploy` as a trusted secret/config file. Keep it gitignored, owner-readable only, and review it during incident response. Prefer the structured `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_KEY` / `DEPLOY_PATH` variables over `DEPLOY_CMD` unless a custom command is necessary.

## False Positives / Already Fixed

### C9-FP-01 - Admin API routes are wrapped and token scopes are enforced

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `apps/web/src/app/api/admin/db/download/route.ts:22`
- `apps/web/src/app/api/admin/lr/upload/route.ts:60-61`, `527`
- `apps/web/src/lib/api-auth.ts:54-133`
- `apps/web/src/lib/admin-tokens.ts:137-163`
- `npm run lint:api-auth --workspace=apps/web` passed.

The admin API inventory contains only DB backup download and Lightroom upload. Both export handlers through `withAdminAuth(...)`. The token path validates token format/hash/expiry and requires route-specific scope before bypassing same-origin for non-browser PAT integrations.

### C9-FP-02 - Same-origin defenses are centralized and fail closed

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `apps/web/src/lib/request-origin.ts:79-107`
- `apps/web/src/lib/api-auth.ts:103-110`
- `apps/web/src/app/actions/auth.ts:91-95`, `294-298`
- `apps/web/src/app/[locale]/admin/db-actions.ts:50-52`, `128-130`, `275-277`
- `npm run lint:action-origin --workspace=apps/web` passed.

Mutating server actions and cookie-authenticated admin APIs require an explicit matching `Origin` or `Referer`. Missing source headers fail closed by default.

### C9-FP-03 - Public mutating routes are rate-limited before expensive work

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:108-230`
- `apps/web/src/app/api/search/similar/[id]/route.ts:64-95`
- `apps/web/src/app/actions/public.ts`
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Semantic search enforces same-origin, JSON content type, chunked-transfer rejection, body-size caps, mode gating, and rate-limit pre-increment before body materialization/embedding work. Similar search enforces same-origin, mode gate, and rollback semantics before expensive work.

### C9-FP-04 - Upload/download path traversal and symlink defenses are in place

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `apps/web/src/lib/serve-upload.ts:15-17`, `137-190`, `261-265`
- `apps/web/src/lib/upload-filenames.ts:27-34`
- `apps/web/src/app/api/admin/db/download/route.ts:24-41`, `43-75`
- `apps/web/src/app/api/admin/lr/upload/route.ts:145-163`
- Targeted tests `serve-upload`, `backup-download-route`, `upload-filenames`, and `upload-paths` passed.

Public upload serving allowlists top-level directories and extensions, rejects unsafe path segments and symlinks, validates realpath containment, and streams from the resolved path. Backup downloads validate filenames, reject symlinks/non-files, check realpath containment, and stream from the resolved file path.

### C9-FP-05 - OG SSRF/open-redirect hardening is present

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `apps/web/src/app/api/og/photo/[id]/route.tsx:100-125`
- `apps/web/src/lib/og-photo-fetch.ts:65-93`, `102-118`
- `apps/web/scripts/ensure-site-config.mjs:23-42`
- `apps/web/src/lib/seo-og-url.ts:3-43`

The per-photo OG route pins internal derivative fetches to trusted `siteConfig.url`, not request-derived origin. Production builds reject placeholder canonical hosts, and SEO OG image URL validation rejects off-origin absolute URLs and backslash-normalization open-redirect tricks.

### C9-FP-06 - XSS, JSON-LD, CSV, OG, and CSP defenses are present

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `apps/web/src/lib/safe-json-ld.ts:14-19`
- `apps/web/src/lib/csv-escape.ts:1-71`
- `apps/web/src/lib/seo-og-url.ts:3-43`
- `apps/web/src/lib/content-security-policy.ts:68-124`
- `apps/web/src/proxy.ts:21-50`
- Targeted tests `safe-json-ld`, `csv-escape`, `seo-actions`, and `og-sanitize` passed.

JSON-LD escapes script-breaking characters, CSV export strips controls/formatting and prefixes formula-leading cells, admin string validators reject bidi/invisible formatting, OG rendering uses shared sanitization, and production CSP is nonce-aware with `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'`.

### C9-FP-07 - SQL restore scanner and raw SQL surfaces are materially hardened

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `apps/web/src/lib/sql-restore-scan.ts:39-155`
- `apps/web/src/app/[locale]/admin/db-actions.ts:423-585`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/admin-tokens.ts:137-147`, `221-224`, `234-235`
- Targeted tests `sql-restore-scan` and `db-restore` passed.

Restore validates dump headers, scans chunks with a 1 MiB tail for dangerous statements, blocks privilege/user/database/routine/file/plugin/prepared-statement patterns, imports with `--one-database`, and runs post-restore migrations. Application raw SQL surfaces use Drizzle parameter binding or static identifiers.

### C9-FP-08 - Public privacy guardrails cover the reviewed public data paths

Severity: N/A
Confidence: High
Status: already fixed / verified

Evidence:
- `CLAUDE.md:217-223`
- `apps/web/src/lib/search-enrichment-fields.ts:1-45`
- `apps/web/src/lib/data.ts` public select/privacy guard regions
- Targeted tests `privacy-fields` and `search-route-privacy` passed.

Public select shapes omit original filenames, GPS, admin-only color/HDR audit fields, and other sensitive columns. Semantic and similar search share a compile-guarded enrichment select rather than hand-copying public fields.

## Final Missed-Issue Sweep

Final sweep included:
- Full route/action inventory against auth, origin, and rate-limit lint gates.
- Broad `rg` scans for `dangerouslySetInnerHTML`, raw HTML sinks, token/session/password/secrets, `withAdminAuth`, same-origin exemptions, rate-limit pre-increments, file streaming/path joins/realpath/lstat, raw SQL/child process execution, and `fetch`/URL use.
- Tracked-file secret assignment scan excluding lockfile and the current scanner test.
- Re-check of ignored env behavior and tracked env examples.
- Re-check of git status to avoid touching unrelated work.

Stop condition met: comprehensive report written; no source code or plan files changed; targeted security validation passed; remaining items are low-severity confirmed report findings plus deployment/threat-model risks requiring operator validation.
