# Cycle 13 Security Review

Reviewer: security-reviewer subagent  
Repo: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-06-29  

## Result

I reviewed the repository security surface for OWASP Top 10 coverage, admin auth/authz, CSRF/origin checks, rate limiting, SSRF, upload/path traversal, SQL injection, secret handling, backup/restore, XSS, public/private data separation, and deployment scripts.

No confirmed Critical or High vulnerabilities were found in the application request paths. One confirmed Low issue remains around plaintext database backups at rest. I also found deployment and operations risks that need environment validation.

The prior Cycle 12 MySQL CLI TLS finding was rechecked and is fixed: non-local DB backup/restore CLI calls now require `DB_SSL_CA` and pass `--ssl-verify-server-cert` (`apps/web/src/lib/mysql-cli-ssl.ts:11-23`, `apps/web/src/app/[locale]/admin/db-actions.ts:149-155`, `apps/web/src/app/[locale]/admin/db-actions.ts:517-523`).

## Security-Relevant Inventory

Inventory method: read AGENTS.md and CLAUDE.md first, then enumerated repo files while excluding `node_modules`, `.git`, build output, runtime uploads/resources/data, and other generated outputs. The security-relevant candidate set was 638 files across source, config, scripts, migrations, tests, and deployment assets.

Reviewed areas:

- Auth/session: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/password-hashing.ts`.
- CSRF/origin/proxy: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, all server actions, admin API routes.
- Rate limiting: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, public API/search/OG/actions.
- Uploads and file serving: browser upload action, Lightroom upload API, `process-image.ts`, `process-topic-image.ts`, `upload-paths.ts`, `serve-upload.ts`, storage local backend, nginx upload rules.
- DB/query/restore: `src/db/schema.ts`, `src/db/index.ts`, `data.ts`, smart collections, SQL-like escaping, restore scanner, migration scripts.
- Backup/restore: admin DB actions, backup download API, MySQL CLI TLS helper, restore maintenance/locks.
- XSS/CSP/metadata: CSP builder, JSON-LD escaping, SEO OG URL validation, OG route/image generation, `dangerouslySetInnerHTML` call sites.
- Public/private data: public select field derivation, map-select exception, share/photo/smart-collection queries, semantic-search enrichment fields.
- Deployment/secrets: Dockerfile, compose, nginx, deploy scripts, entrypoint, `.env` examples, tracked-secrets tests, CLIP model download/manifest.

## Confirmed Issues

### C13-LOW-01: Database backups are plaintext at rest

Severity: Low  
Confidence: High  
Category: Secret/data handling, backup/restore  

Evidence:

- `dumpDatabase()` writes SQL dumps under `data/backups` and only constrains directory/file mode with `0700` and `0600` (`apps/web/src/app/[locale]/admin/db-actions.ts:140-147`, `apps/web/src/app/[locale]/admin/db-actions.ts:172`).
- The download path streams the raw SQL file as `application/sql` after admin auth and path containment checks (`apps/web/src/app/api/admin/db/download/route.ts:78-86`).
- The dump includes database rows; schema includes sensitive tables such as `admin_users`, `sessions`, `admin_tokens`, and `admin_settings` (`apps/web/src/db/schema.ts:160-211`).

Failure scenario:

If the host account, filesystem backup, NAS share, or copied backup artifact is exposed, the SQL dump can disclose admin password hashes, active session hashes, token hashes, audit history, private metadata, and settings. File permissions reduce same-host casual access but do not protect copied/off-host backups or a compromised deploy user.

Suggested fix:

Encrypt backups before writing or immediately after creation, ideally with an operator-controlled key outside the app database trust domain. If plaintext remains an accepted personal-gallery boundary, keep it explicitly documented in the runbook and ensure host-level backups for `data/backups` are encrypted.

## Likely Issues

None found.

## Risks Needing Manual Validation

### C13-HIGH-RISK-01: Checked-in nginx listens on cleartext HTTP and depends on an external TLS edge

Severity: High if this nginx is internet-facing; otherwise informational  
Confidence: High for the config state, Medium for deployed exposure  
Category: Deployment, transport security  

Evidence:

- The nginx server listens on port 80 only (`apps/web/nginx/default.conf:21-23`).
- The comments state it must sit behind a TLS-terminating edge and must not be exposed as the public cleartext edge (`apps/web/nginx/default.conf:25-29`).
- The same server emits HSTS (`apps/web/nginx/default.conf:48-54`), but HSTS does not protect the first cleartext request when nginx itself is the edge.
- Compose uses host networking and sets `TRUST_PROXY=true`, relying on the host reverse proxy to provide trusted forwarded host/proto values (`apps/web/docker-compose.yml:14-21`).
- Admin cookies are marked Secure in production (`apps/web/src/app/actions/auth.ts:225-238`), so direct HTTP exposure could also break admin login behavior while still exposing public requests and form submissions over cleartext.

Failure scenario:

If `apps/web/nginx/default.conf` is deployed directly to the public internet without a separate HTTPS edge, visitors and admins can hit the gallery over cleartext HTTP. Public traffic, form submissions, login attempts, uploaded metadata, restore/download requests before Secure-cookie enforcement, and CSRF source headers can be observed or modified on path.

Suggested fix:

Validate the live topology. If this nginx can be reached by external clients, add a 443 server block with certificates and a strict port-80 redirect before serving the app. Consider a production startup check or deploy-time assertion that refuses a public HTTP-only edge unless an explicit internal-only/TLS-edge flag is set.

### C13-LOW-RISK-01: Public analytics actions can still be intentionally forged within rate limits

Severity: Low  
Confidence: Medium  
Category: Public endpoint integrity, abuse resistance  

Evidence:

- View-recording actions are intentionally public and origin-exempt (`apps/web/src/app/actions/public.ts:314-321`, `apps/web/src/app/actions/public.ts:363-365`, `apps/web/src/app/actions/public.ts:387-415`).
- They validate target existence/visibility before writes and use an in-memory per-IP limit of 120 requests/minute (`apps/web/src/app/actions/public.ts:324-343`, `apps/web/src/app/actions/public.ts:371-383`, `apps/web/src/app/actions/public.ts:399-411`, `apps/web/src/app/actions/public.ts:423-442`).
- Full IPs are not stored; only country/referrer/bot metadata are recorded (`apps/web/src/app/actions/public.ts:345-354`).

Failure scenario:

An attacker can call these server actions cross-site or directly to inflate non-bot analytics for visible photos/topics/shared groups up to the per-IP limit. This does not expose private data or mutate gallery content, but it can reduce metric integrity if view counts are used for product decisions, abuse triage, or public ranking.

Suggested fix:

If analytics integrity matters, move view recording to a route with stronger bot signals, durable DB/edge rate limits, and CSRF/origin or signed page-view tokens. If best-effort analytics are acceptable, document that counts are not audit-grade.

### C13-LOW-RISK-02: GPS stripping of retained originals is best-effort and can fail closed only for public metadata/derivatives

Severity: Low  
Confidence: Medium  
Category: Privacy, upload metadata  

Evidence:

- Browser and Lightroom upload paths null DB latitude/longitude and call `stripGpsFromOriginal()` when `stripGpsOnUpload` is enabled (`apps/web/src/app/actions/images.ts:385-387`, `apps/web/src/app/api/admin/lr/upload/route.ts:364-378`).
- `stripGpsFromOriginal()` handles multiple formats but intentionally logs and returns for structurally anomalous HEIC or unsupported formats, leaving the original file's GPS data in place (`apps/web/src/lib/process-image.ts:1738-1820`).
- The code comment states public DB columns and derivatives are already stripped, and only an original-download path would leak (`apps/web/src/lib/process-image.ts:1816-1819`). I did not find a public or admin original-download route; original access appears limited to server-side processing/backfill paths.

Failure scenario:

If operators later add an original-download feature, sync originals to a less trusted location, or include originals in host-level backup restores, malformed/unsupported originals may retain GPS despite the setting. The current public gallery paths do not appear to expose originals, so this is a future/operational privacy risk rather than a current unauthenticated leak.

Suggested fix:

Make any future original-download feature surface a per-file GPS-strip status or refuse download when stripping failed and the admin privacy setting requires stripping. Consider persisting a `gps_strip_status` field for retained originals if host-level backup/privacy attestations need stronger evidence.

## Positive Security Evidence

- Admin API routes are wrapped by `withAdminAuth`; token-authenticated integrations require scoped PATs and get no-store/nosniff defaults (`apps/web/src/lib/api-auth.ts:55-140`).
- Cookie admin API paths require same-origin provenance before session auth (`apps/web/src/lib/api-auth.ts:111-126`), and mutating server actions use `requireSameOriginAdmin()` via lint-enforced coverage.
- Same-origin checks fail closed when `Origin`/`Referer` are absent and normalize trusted proxy host/proto only when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:45-68`, `apps/web/src/lib/request-origin.ts:79-107`).
- Login rate limiting is pre-incremented before Argon2 verification and is both IP- and account-scoped, reducing concurrent brute-force bypasses (`apps/web/src/app/actions/auth.ts:91-162`).
- Production requires `SESSION_SECRET` of at least 32 chars and refuses DB fallback (`apps/web/src/lib/session.ts:16-36`); session tokens are HMAC-signed, shape-checked after HMAC, bounded to 24h, and stored hashed in DB (`apps/web/src/lib/session.ts:82-150`).
- Public derivative serving allows only `jpeg`, `webp`, and `avif`, validates path segments/extensions, rejects symlinks/non-files, realpath-confines reads, and sends nosniff (`apps/web/src/lib/serve-upload.ts:15-18`, `apps/web/src/lib/serve-upload.ts:137-188`, `apps/web/src/lib/serve-upload.ts:242-265`).
- Nginx blocks `/uploads/original/` and proxies only derivative upload paths to the app (`apps/web/nginx/default.conf:164-184`).
- Original upload storage is private by default; local storage refuses public URLs for `original/*` keys (`apps/web/src/lib/upload-paths.ts:24-40`, `apps/web/src/lib/storage/local.ts:130-137`).
- Restore uploads are size-capped, streamed to `0600` temp files, plausibility-checked, scanned for dangerous SQL across chunk boundaries, restored with `--one-database`, and cleaned up (`apps/web/src/app/[locale]/admin/db-actions.ts:429-615`, `apps/web/src/lib/sql-restore-scan.ts:39-168`).
- Public select fields are derived with explicit privacy omissions and compile-time guards; map coordinates are limited to the map-visible path (`apps/web/src/lib/data.ts:368-489`, `apps/web/src/lib/data.ts:1640-1688`).
- Smart collection SQL is allowlist-compiled rather than raw user SQL; public smart collection pages require `is_public` before rendering (`apps/web/src/lib/smart-collections.ts:1-360`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:78-101`).
- Semantic search requires same-origin, strict JSON content-type, non-chunked requests, content-length and byte caps, pre-read rate limiting, and no-store/nosniff responses (`apps/web/src/app/api/search/semantic/route.ts:106-220`).
- CSP blocks object/embed execution, restricts scripts to self plus nonce and optional GA sources, and validates production image CDN URLs as HTTPS without credentials/query/hash (`apps/web/src/lib/content-security-policy.ts:1-25`, `apps/web/src/lib/content-security-policy.ts:98-123`).
- CLIP production model loading is offline at runtime with pinned revision and checksum-verified downloader artifacts (`apps/web/src/lib/clip-model.ts:101-118`, `apps/web/scripts/download-clip-models.ts:19-23`, `apps/web/scripts/download-clip-models.ts:127-139`, `apps/web/scripts/clip-model-manifest.ts:29-59`).

## Verification

Commands run:

- `npm run lint:api-auth --workspace=apps/web` — passed; both admin API routes reported OK.
- `npm run lint:action-origin --workspace=apps/web` — passed; all mutating server actions either enforce same-origin/admin or carry explicit public/read-only exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed; public mutating API routes are covered or absent.
- `npm audit --omit=dev --workspace=apps/web --audit-level=moderate` — passed, `found 0 vulnerabilities`.
- `npm test --workspace=apps/web -- --run src/__tests__/api-auth-response-headers.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/smart-collections.test.ts src/__tests__/mysql-cli-ssl.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/safe-json-ld.test.ts src/__tests__/seo-actions.test.ts src/__tests__/password-hashing-policy.test.ts` — passed, 16 files / 204 tests.

## Final Sweep Coverage

I performed a repo-wide sweep for common missed security issues including unsafe `dangerouslySetInnerHTML`, origin-exempt actions, admin API exports, public mutating routes, raw `fetch()`/SSRF candidates, shell `spawn`/`exec`, path resolution, file deletion/write paths, MySQL restore primitives, secret names, public/private upload paths, and original-file references. The only material findings from that sweep are captured above.

Residual risk is primarily operational: live TLS topology, host backup encryption, and whether best-effort analytics/privacy semantics match operator expectations.
