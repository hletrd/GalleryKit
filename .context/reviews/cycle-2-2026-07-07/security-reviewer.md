# GalleryKit — Comprehensive Security Review

Scope: apps/web (Next.js 16 self-hosted photo gallery). Surfaces examined in full:
server actions (`src/app/actions/**`), admin + public API routes (`src/app/api/**`),
security libs (`session`, `auth`, `api-auth`, `admin-tokens`, `request-origin`,
`action-guards`, `rate-limit`, `auth-rate-limit`, `validation`, `sanitize`, `csv-escape`,
`og-sanitize`, `safe-json-ld`, `serve-upload`, `og-photo-fetch`, `upload-paths`,
`upload-filenames`, `sql-restore-scan`, `db-restore`, `backup-filename`, `base56`,
`content-security-policy`, `audit`), `proxy.ts` (middleware), `db-actions.ts`
(backup/restore), `nginx/default.conf`, `Dockerfile`, `entrypoint.sh`, and the
process-image extension/ingest gate. Method: read the code and verified it against the
CLAUDE.md security claims and the four lint-gate invariants.

## Executive summary

This is an exceptionally hardened codebase — the comment lineage shows ~90+ prior
review cycles, and the OWASP Top-10 surfaces are covered with defense-in-depth that
actually holds up under inspection. **No CRITICAL or HIGH confirmed vulnerabilities were
found.** Every mutating admin server action pairs `requireSameOriginAdmin()` +
`isAdmin()` (verified across all 12 action files); both admin API routes wrap
`withAdminAuth`; public expensive routes and server actions all carry wired rate
limiters (share/feed/og/semantic/search/load-more/view-record limiters were confirmed
present AND invoked at their call sites, not merely defined); path traversal, SSRF,
open-redirect, session, CSRF/origin, upload, and JSON-LD-XSS defenses are all present
and correct. The findings below are LOW / informational — accepted trade-offs and
defense-in-depth limitations, not exploitable gaps.

## Findings table

| ID | Severity | Confidence | Location | Title |
|----|----------|-----------|----------|-------|
| SEC-01 | LOW | Medium | src/lib/sql-restore-scan.ts:61-265 | DB-restore SQL guard is a regex denylist (admin-gated defense-in-depth, inherently bypassable) |
| SEC-02 | LOW | High | src/lib/content-security-policy.ts:114 | Production CSP uses `style-src 'unsafe-inline'` |
| SEC-03 | INFO | High | src/lib/audit.ts:50-94 | audit_log persists full client IPs (by-design forensic log; PII/retention note) |
| SEC-04 | INFO | Medium | src/lib/request-origin.ts:45-69 | Same-origin CSRF defense trusts X-Forwarded-Host under TRUST_PROXY (topology-dependent) |
| SEC-05 | LOW | Medium | src/lib/content-security-policy.ts:1-26 + src/proxy.ts:44 | Malformed runtime `IMAGE_BASE_URL` throws inside middleware → fail-closed outage (availability) |
| SEC-06 | INFO | Low | src/app/api/search/semantic/route.ts + similar | Per-process (non-DB) rate-limit buckets on public embedding routes weaken only under scale-out (single-instance topology assumed) |

---

## Detailed findings

### SEC-01 — DB-restore SQL guard is a regex denylist (LOW, Medium confidence)
`src/lib/sql-restore-scan.ts` — `containsDangerousSql()` strips comments/literals then
runs a denylist of ~40 regexes (GRANT, DROP TABLE, LOAD DATA, INTO OUTFILE, CREATE
TRIGGER/PROC/FUNC, DELIMITER, PREPARE, etc.) plus a write-target allowlist restricting
INSERT/UPDATE/REPLACE targets to `APP_BACKUP_TABLES`, combined with `mysql --one-database`.

Why it's only LOW: (1) `restoreDatabase()` requires `requireSameOriginAdmin()` +
`isAdmin()` (`db-actions.ts:403-410`), so the actor already has full DB authority through
the app — a denylist bypass grants nothing an authenticated admin lacks. (2) Denylist SQL
filtering is fundamentally best-effort; the residual purpose is guarding against a
*poisoned/tampered backup file* or a *shared MySQL server* (the advisory-lock scope note),
not against the admin. (3) One theoretical edge: the chunked scanner (`db-actions.ts:704-733`,
1 MiB `CHUNK_SIZE`, 1 MiB compacted tail) strips string literals per-chunk; a value literal
larger than the tail that straddles a chunk boundary could leave the scanner unable to see a
following statement in the same chunk — but the carried-forward tail and the four
sanitize-form variants make this hard to weaponize, and it is extensively test-locked
(`__tests__/sql-restore-scan.test.ts`). Suggested action: none required; keep the guard as
documented defense-in-depth and continue treating restore as an admin-trust operation.

### SEC-02 — Production CSP `style-src 'unsafe-inline'` (LOW, High confidence)
`content-security-policy.ts:114` emits `style-src 'self' 'unsafe-inline'` in production.
This permits attacker-injected inline styles (CSS-based data-exfil / clickjacking-adjacent
tricks) if an HTML-injection sink ever appeared. Impact is bounded: `script-src` is
nonce-based with NO `'unsafe-inline'`, so injected `<script>` is still blocked, and the app
has no confirmed HTML-injection sink (JSON-LD is escaped — see below). This is the standard
Next.js/Tailwind trade-off. Suggested fix (optional): move to nonce/hash-based styles if a
strict CSP is desired; otherwise accept and document.

### SEC-03 — audit_log stores full client IPs (INFO, High confidence)
`audit.ts:50-94` writes `ip` verbatim for login success/failure, backup download/restore,
etc. CLAUDE.md's "full IPs are never stored" applies to the *public analytics* tables
(`image_views` — country_code only), not the admin forensic `audit_log`. Storing source IP
in a security audit trail is correct and expected; it is admin-only and bounded by
`AUDIT_LOG_RETENTION_DAYS` (default 90). Flagged only as a PII/GDPR operator awareness item,
not a vulnerability.

### SEC-04 — Same-origin CSRF defense is topology-dependent (INFO, Medium confidence)
`request-origin.ts:getExpectedOrigin` derives the expected origin from `X-Forwarded-Host`
(rightmost value) when `TRUST_PROXY=true`, else `Host`. The same-origin check then compares
the browser-set `Origin`/`Referer` to that expected origin. This is NOT browser-CSRF
exploitable: a cross-site attacker cannot forge the victim's `Origin` header, and cookies are
`SameSite=lax` + Next's built-in server-action origin check applies — triple defense. The only
way the check weakens is an operator deploying behind a proxy that forwards an
attacker-influenced `X-Forwarded-Host` while `TRUST_PROXY=true` AND without the shipped
nginx's `$host` overwrite; this is extensively documented in CLAUDE.md and the nginx XFF
topology contract. No code change needed; correct as shipped.

### SEC-05 — Malformed runtime IMAGE_BASE_URL throws in middleware (LOW, Medium confidence)
`proxy.ts:44` calls `buildContentSecurityPolicy(...)` on every non-dev request, which
defaults `imageBaseUrl = parseCspImageBaseUrl(process.env.IMAGE_BASE_URL?.trim())`.
`parseCspImageBaseUrl` THROWS on a malformed/credential-bearing URL
(`content-security-policy.ts:8-24`). If `IMAGE_BASE_URL` is set to an invalid value at
runtime (independently of the build-time `ensure-site-config.mjs` validation, which checks
`BASE_URL`/`siteConfig.url`, not IMAGE_BASE_URL), every request 500s in middleware → full
outage. This is availability-only and fail-closed, requires operator misconfiguration, and is
partially mitigated by the Dockerfile build ARG. Suggested hardening: wrap the middleware CSP
build in try/catch and fall back to a CSP without the CDN source (log loudly) so a bad env var
degrades images rather than the whole site.

### SEC-06 — Per-process rate-limit buckets on public embedding routes (INFO, Low confidence)
`/api/search/semantic` and `/api/search/similar/[id]` (and OG/share fast paths) use
in-memory, non-DB-backed limiters. Under the shipped single-web-instance topology this is
correct and CPU is additionally bounded by `CLIP_INFERENCE_CONCURRENCY`/`MAX_PENDING`/queue
timeout. Called out only because CLAUDE.md itself notes these buckets do not coordinate under
horizontal scale-out; do not scale the web tier without moving these to a shared store.

---

## Verified-correct (spot-check evidence, no finding)

- **Auth/session** (`session.ts`, `auth.ts`): HMAC-SHA256 tokens, `timingSafeEqual`, shape
  checks AFTER crypto to avoid a timing oracle, 24h expiry, session hashed at rest, prod
  refuses DB-stored secret fallback, session-fixation delete-others-in-txn, constant-time
  login via module-init dummy Argon2 hash, TOCTOU-safe pre-increment rate limiting
  (per-IP + per-account), no rollback on infra error (anti-attempt-farming). Argon2id params
  exceed OWASP.
- **PAT tokens** (`admin-tokens.ts`, `api-auth.ts`): 256-bit CSPRNG token, SHA-256 stored,
  `timingSafeEqual`, expiry + scope enforced, pre-verify IP rate limit bounds spray, fail-closed
  on missing table, token path correctly bypasses same-origin (by design) but still scope-gated.
- **CSRF/origin**: `withAdminAuth` centrally enforces origin (AGG9R-02); every mutating action
  uses `requireSameOriginAdmin()`; auth actions use the stricter `hasTrustedSameOrigin`.
  Lint gates `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit` verified to
  match reality.
- **Path traversal / SSRF**: `serve-upload.ts` + `upload-paths.ts` use SAFE_SEGMENT allowlist,
  `lstat` symlink rejection, `realpath` containment; `/api/admin/db/download` validates a strict
  backup-filename regex + realpath containment; per-photo OG internal fetch is pinned to
  `BASE_URL` origin (never `req.url`), fails closed if unparseable; OG fallback redirect validated
  same-origin (no open redirect). `/uploads/original/` blocked at nginx + 0700 dir.
- **Upload security**: UUID on-disk names, image-only extension allowlist (no SVG/HTML), RAW
  rejected, decompression-bomb pixel caps, GPS strip on disk + DB, size/count/byte caps, TOCTOU-safe
  quota claim, restore-maintenance fencing.
- **Injection**: Drizzle parameterization throughout; raw SQL confined to admin/schema helpers with
  bound params; CSV formula-injection + bidi/zero-width stripping; JSON-LD via `safeJsonLd`
  (escapes `<`,`>`,U+2028/9) + CSP nonce; admin string surfaces reject Unicode bidi/invisible chars.
- **Secrets**: no `.env*`/keys/secrets tracked (`git ls-files` clean); `.gitignore` covers
  `.env`, `.env.local`, `.env.deploy`; `site-config.json` untracked (only `.example`); mysqldump/
  mysql/migrate children get minimal env (no SESSION_SECRET leak), credentials via MYSQL_PWD env
  (not argv), stderr redacted via `sanitizeStderr`.
- **Rate-limit IP trust** (`rate-limit.ts:getClientIp`): only trusts XFF/X-Real-IP when
  `TRUST_PROXY=true`, hop-count aware, `normalizeIp` validates, warns loudly on proxy-headers-
  without-TRUST_PROXY. nginx overwrites XFF with `$remote_addr` (documented topology contract).
- **Admin-user delete**: advisory-locked last-admin protection, self-delete blocked, audit
  detach before FK delete, all params bound.
- **Container**: non-root `node` via gosu, private originals chmod 700, liveness-only healthcheck,
  reproducible lockfile install, manual SIGTERM ownership for clean shutdown.

No requested file was skipped.
