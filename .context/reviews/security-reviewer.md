# Run-10 Cycle 34 Security Review - Security Reviewer Lane

Date: 2026-07-08
Workspace: `/Users/hletrd/flash-shared/gallery`
Scope: whole-repo security/privacy review. No implementation changes.

## Security Inventory

I first inventoried the security-relevant surface, then inspected the relevant files and interactions:

- Authority/docs: provided `AGENTS.md`, repository `CLAUDE.md`, prior `.context/reviews/security-reviewer.md`.
- Admin routes/actions: every file in `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, protected admin layouts/pages.
- API routes: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `api/search/*`, `api/og*`, `api/health`, `api/live`.
- Public routes: share/group/photo/map/feed/upload route handlers and dynamic public pages under `apps/web/src/app/[locale]/(public)`.
- Auth/authz/origin/rate limits: `auth.ts`, `session.ts`, `api-auth.ts`, `admin-tokens.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `proxy.ts`.
- Uploads/files/privacy: `images.ts`, LR upload route, `upload-paths.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `pending-file-deletions.ts`, `storage/*`, `data.ts`, `search-enrichment-fields.ts`.
- Restore/backups/migrations: `db-actions.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `migrate.js`, drizzle migrations/journal, backup download route.
- CSP/XSS/XML/SEO/SW: `content-security-policy.ts`, `safe-json-ld.ts`, `seo-og-url.ts`, `og-sanitize.ts`, `atom-feed.ts`, `next.config.ts`, `public/sw.js`, `sw-cache.ts`, `build-sw.ts`.
- Ops/supply chain: `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, deploy scripts, env examples, GitHub workflows, CLIP model download/backfill scripts, seed scripts.
- Tests/gates: security lint scripts plus auth/origin/rate-limit/privacy/upload/restore/CSP/SW/nginx tests.

## Verification Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed; all mutating server actions enforce same-origin provenance.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm run audit:prod`: passed, 0 production dependency vulnerabilities at `moderate`.
- Targeted tests passed: `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/request-origin.test.ts src/__tests__/rate-limit.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/serve-upload.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/sw-template-contract.test.ts src/__tests__/nginx-config.test.ts` - 11 files, 158 tests.
- Secret sweep: `.env.deploy` and `apps/web/.env.local` exist locally, are ignored, and are mode `600`; tracked secret-like scan found placeholders/redacted historical-review text only, no live committed key material.

## Confirmed Issues

### SEC-C34-01 - `seed-e2e` deletes DB-sourced filenames without containment validation

Severity: Low
Confidence: High
Status: Confirmed local destructive operational risk
OWASP: A05 Security Misconfiguration, A08 Software and Data Integrity Failures

Evidence:

- `apps/web/scripts/seed-e2e.ts:169-183` refuses `NODE_ENV=production` and requires either `E2E_ALLOW_DESTRUCTIVE_SEED=true` or a disposable-looking DB name.
- `apps/web/scripts/seed-e2e.ts:213-233` selects existing image rows for topic `e2e-smoke`, then calls `fs.rm(path.join(dirs.*, row.filename_*), { force: true })` using filenames read from the database.
- Unlike application deletion paths, this script does not call `isValidFilename`, `path.basename`, or realpath containment before unlinking DB-sourced names.

Failure scenario / exploit path:

If a non-production/disposable database contains a malicious or corrupted `e2e-smoke` row with `filename_jpeg='../../some-file'`, running `seed-e2e.ts` can delete files outside the intended upload directories under the account running the script. The production guard limits blast radius, but the script is still a destructive tool and should not trust DB filenames.

Concrete fix:

Before every `fs.rm`, validate each DB-sourced filename with the same filename/path containment contract used by `upload-paths.ts` and `serve-upload.ts`: require basename-only safe filenames, resolve against the intended root, realpath/lstat where possible, and reject paths escaping the root. Reuse an existing helper or add a script-local `resolveContainedSeedFile(root, filename)`.

## Likely Issues

No likely remotely exploitable source-level security issue was found in the reviewed state. The main residual risks are operational/configuration risks below.

## Manual-Validation Risks

### SEC-C34-MV01 - Reverse-proxy topology is security-critical and must match the documented nginx/app assumptions

Severity: Medium
Confidence: Medium
Status: Manual-validation risk
OWASP: A05 Security Misconfiguration

Evidence:

- `apps/web/docker-compose.yml:15-23` uses host networking and sets `TRUST_PROXY=true`.
- `apps/web/nginx/default.conf:20-29` warns nginx rate-limit keys use `$binary_remote_addr` unless real-IP/PROXY-protocol is configured.
- `apps/web/nginx/default.conf:52-71` says overwriting `X-Forwarded-For` with `$remote_addr` is correct only when nginx sees the real client.
- `apps/web/nginx/default.conf:274-295` applies the public SSR page flood limiter and notes the config is manually applied/reloaded.
- `apps/web/src/lib/rate-limit.ts:175-217` uses proxy headers only when `TRUST_PROXY=true`; otherwise all requests key as `unknown` and a production warning is logged.

Failure scenario / exploit path:

If production is CDN/LB -> nginx -> app but nginx is still in overwrite mode without `real_ip`, every visitor can share one LB/nginx bucket. One abusive client can consume app or nginx per-IP budgets for everyone, or legitimate traffic can globally 429. If the committed nginx template was never applied, dynamic public SSR pages lose the documented edge limiter.

Concrete fix:

Validate live `nginx -T` against the repo template. Configure `set_real_ip_from`/`real_ip_header` or PROXY protocol for upstream LBs, use append-mode forwarding where appropriate, set `TRUSTED_PROXY_HOPS` to the actual right-anchored hop count, and add a deploy/topology smoke check that proves distinct client IP attribution.

### SEC-C34-MV02 - Restore SQL screening is strong but remains denylist/parser-light

Severity: Medium
Confidence: Medium
Status: Manual-validation risk; no bypass found
OWASP: A08 Software and Data Integrity Failures

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:789-869` writes restore uploads to a private temp file, caps size, validates plausible dump shape, and scans chunks before import.
- `apps/web/src/app/[locale]/admin/db-actions.ts:871-900` imports through `mysql --one-database` with minimal env and TLS arguments.
- `apps/web/src/lib/sql-restore-scan.ts:88-156` blocks dangerous statements including grants/users, database/table destruction, routines/triggers/views, `LOAD DATA`, outfile/dumpfile, prepared statements, and global settings.
- `apps/web/src/lib/sql-restore-scan.ts:262-304` rejects disallowed/schema-qualified write targets.
- `sql-restore-scan.test.ts` passed in the targeted test run.

Failure scenario / exploit path:

An authenticated admin or compromised admin browser uploads a crafted SQL file that abuses an unmodeled MySQL grammar edge case. I did not find a bypass, but regex/denylist scanning is not equivalent to a full SQL parser or signed-backup trust model.

Concrete fix:

Prefer restoring only app-generated signed backups. For untrusted SQL, restore into a temporary isolated database with a least-privileged restore user, parse/validate schema/table writes there, then swap/import only verified app tables.

### SEC-C34-MV03 - Runtime secrets and historical rotation cannot be proven from source

Severity: Low-Medium
Confidence: High
Status: Manual-validation risk
OWASP: A02 Cryptographic Failures, A05 Security Misconfiguration

Evidence:

- `apps/web/.env.local.example:21-33` requires strong `ADMIN_PASSWORD`/`SESSION_SECRET` and warns historical example values must be rotated.
- `.env.deploy.example:1-16` documents gitignored deploy credentials and `chmod 600`.
- `scripts/deploy-remote.sh:55-80` refuses missing or group/world-readable deploy env files.
- `apps/web/deploy.sh:15-43` refuses unsafe runtime env file permissions.
- `apps/web/src/lib/session.ts:16-35` fails closed in production without a sufficiently long `SESSION_SECRET`.
- Local `.env.deploy` and `apps/web/.env.local` are ignored and mode `600`; I did not read their values.

Failure scenario / exploit path:

If production reused a historical example secret, weak bootstrap password, old PAT, or leaked deploy key, source-level gates still pass while sessions/admin access remain compromised.

Concrete fix:

Manually verify production secrets were generated uniquely and rotated after any exposure: `SESSION_SECRET`, `ADMIN_PASSWORD`, DB credentials, deploy SSH key, PATs, and CLIP/ops secrets. Keep env files owner-only and exclude them from backups/logs unless encrypted.

### SEC-C34-MV04 - Backups are plaintext at rest

Severity: Low-Medium
Confidence: High
Status: Manual-validation / accepted-risk candidate
OWASP: A02 Cryptographic Failures

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:189-195` creates `data/backups` with mode `0700`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:229-244` runs `mysqldump` with minimal env and writes temp output mode `0600`.
- `apps/web/src/app/api/admin/db/download/route.ts:21-67` requires admin auth, validates backup filenames, and uses realpath containment before streaming.

Failure scenario / exploit path:

A host-level compromise, bad filesystem ACL, or leaked backup directory exposes SQL dumps containing private metadata, token/session hashes, analytics, and settings. This is not a web path traversal issue; it is an at-rest protection decision.

Concrete fix:

Encrypt backups before final rename with age/GPG/KMS, keep keys outside the app container, and document/test decrypt-then-restore through the existing scanner/import pipeline.

### SEC-C34-MV05 - Service-worker offline HTML cache can intentionally serve stale public pages for up to 24 hours

Severity: Low
Confidence: Medium
Status: Manual-validation / product-privacy tradeoff
OWASP: A01 Broken Access Control (revocation semantics), A05 Security Misconfiguration

Evidence:

- `apps/web/public/sw.js:7-17` documents HTML routes as network-first with a 24-hour offline-only fallback.
- `apps/web/public/sw.js:31-34` sets `HTML_MAX_AGE_MS` to 24 hours and caps entries.
- `apps/web/public/sw.js:59-64` excludes direct photo pages, share/group/smart-collection pages, and map from this cache.
- `apps/web/public/sw.js:446-500` caches successful non-admin HTML and serves it only on network failure until expiry.
- `apps/web/public/sw.js:555-563` bypasses revocable public object pages, then caches other HTML routes.

Failure scenario / exploit path:

After a public photo is deleted or metadata is changed, a returning visitor who previously cached a public listing page and then goes offline can still see stale listing HTML for up to 24 hours. Direct photo/share/group/map pages are bypassed, so this is not a direct revoked-link bypass, but it can preserve stale public listing context.

Concrete fix:

If deletion/privacy revocation must remove all offline traces immediately, narrow HTML caching to explicitly non-sensitive static pages or reduce `HTML_MAX_AGE_MS`. Otherwise document this as an accepted PWA offline tradeoff.

## Confirmed Controls

- Auth/session: `session.ts:16-150` enforces production session secrets, HMAC token signatures, max age, hashed DB tokens, and expired-session deletion. `auth.ts:79-273` enforces same-origin login/logout, Argon2 with dummy-hash timing equalization, pre-incremented IP/account rate limits, session rotation, and secure cookie attributes.
- API/admin auth: `api-auth.ts:66-152` wraps admin APIs, enforces same-origin for cookie auth, supports scoped PATs only where configured, and adds no-store/nosniff. `admin-tokens.ts` hashes PATs, verifies expiry/scope, and never stores plaintext.
- CSRF/origin: `request-origin.ts:47-146` anchors expected origin to configured base/site URL in production and fails closed without matching Origin/Referer. The action-origin lint passed.
- Public rate limits: search/load-more/share/OG/feed/semantic/similar/view-record routes/actions pre-increment rate budgets or carry documented exemptions. The public route lint passed.
- Uploads/path traversal: `upload-paths.ts:49-170` keeps originals private and enforces safe basename/realpath containment. `serve-upload.ts:162-369` whitelists derivative dirs/extensions, rejects symlinks, checks realpath containment, emits ETag/cache/nosniff, and cleans up streams on abort. LR/browser upload paths enforce byte/file caps, safe filenames, topic validation, disk checks, processing locks, and GPS stripping.
- Restore/backups: restore drains mutations/queues, uses maintenance markers/locks, scans SQL, imports with minimal env/TLS, runs post-restore migration, and flushes pending session revocations before reopening.
- SQL/injection: reviewed raw SQL uses parameterized `?` or Drizzle `sql`` bindings; observed `sql.raw` usage is for constant separators. Smart collections compile allowlisted AST predicates into Drizzle SQL.
- XSS/CSP/XML/CSV: production CSP uses nonce-based script policy (`content-security-policy.ts:139-199`), API CSP is locked down in `next.config.ts:87-92`, JSON-LD uses `safeJsonLd.ts:14-19`, feeds XML-escape in `atom-feed.ts`, and CSV export escapes spreadsheet formulas.
- Privacy: `data.ts:374-488` and `search-enrichment-fields.ts:29-46` omit/guard admin/privacy-sensitive fields from public reads; map GPS exposure is limited to `map_visible` topics. Privacy tests passed.
- SSRF/open redirect: per-photo OG fetches use canonical `BASE_URL` rather than request host (`api/og/photo/[id]/route.tsx:176-196`); fallback redirects are same-origin checked (`api/og/photo/[id]/route.tsx:347-365`); SEO OG image URLs reject cross-origin/backslash tricks (`seo-og-url.ts:3-43`).
- Ops/supply chain: Docker base is digest-pinned; CLIP weights use pinned revision plus SHA-256 manifest verification; CI runs lint/typecheck/security gates/audit/tests/build.

## Final Sweep

Final sweep covered route/action inventories, auth wrappers, public route exemptions, server action exemptions, raw SQL, file deletion/write sinks, `fetch`/URL construction, secret-like strings, Docker/nginx/deploy scripts, service worker behavior, backups/restores, migrations, and security-focused tests. No skipped security-relevant category from the prompt remains unreviewed; remaining gaps are live-production configuration and secret-rotation facts that cannot be proven from source without inspecting operational state.
