# Cycle 1 (2026-07-06) — Security Review

Reviewer angle: OWASP Top 10, authn/authz, CSRF/origin, SSRF, path traversal, injection (SQL/command/header/log/XSS), secrets, rate-limit bypass, privacy/PII, upload handling, nginx-vs-app limits, Docker/deploy, PAT/token handling.

HEAD reviewed: `1d29b988` (working tree changes are test/docs only — `git diff` confirmed no source change; the review targets the full tree at HEAD).

## Executive summary

This is an exceptionally hardened codebase after ~90 review cycles. Every classic OWASP surface I inspected has correct, defense-in-depth handling that I validated against the source (not just against CLAUDE.md claims). I found **no confirmed exploitable vulnerability**. The one finding worth a fix is a config/documentation contradiction in the shipped nginx that can silently collapse per-IP rate limiting in the exact topology the nginx file says it targets. The remainder are low-severity/defense-in-depth notes.

CLAUDE.md security claims that I actively verified as TRUE in code (not merely asserted): JSON-LD is escaped via `safeJsonLd` (`<`/`>`/U+2028/U+2029) at every `dangerouslySetInnerHTML` sink; `publicSelectFields` is a compile-time-guarded PII omission (`_SensitiveKeysInPublic extends never`); `withAdminAuth` centrally enforces same-origin + `isAdmin()` (token path bypasses same-origin only, as designed) and every `/api/admin/**` handler is a direct `withAdminAuth(...)` var-export enforced by `check-api-auth.ts`; session tokens are HMAC-SHA256 + `timingSafeEqual` + 24h age; PATs are SHA-256-hashed with `timingSafeEqual`; the OG per-photo route pins its internal fetch origin to `BASE_URL` and fails closed; the DB download route double-validates filename + `realpath` containment; `serve-upload.ts` rejects symlinks, enforces a segment allowlist, and `realpath`-contains under `UPLOAD_ROOT`; smart-collection `query_json` compiles through Drizzle param binding + a column allowlist + scalar-value enforcement; the restore SQL denylist scans both comment→empty and comment→spaces forms so `DROP/**/TABLE` is caught; base56 share keys use `crypto.randomBytes` rejection sampling.

---

## Findings

### SEC-01 | Medium | Confidence Medium | needs-manual-validation
**nginx overwrites `X-Forwarded-For` with `$remote_addr`, contradicting its own "internal hop behind a TLS-terminating load balancer" deployment note — collapses ALL per-IP rate limits to one shared bucket in that topology.**

File: `apps/web/nginx/default.conf:25-30` (comment) vs. `:70`, `:87`, `:103`, `:119`, `:143`, `:160`, `:183`, `:196` (`proxy_set_header X-Forwarded-For $remote_addr;`); interaction with `apps/web/src/lib/rate-limit.ts:166-197` (`getClientIp`) and `TRUSTED_PROXY_HOPS` default `1`.

Why: The nginx server block header comment states it is "INTERNAL HTTP HOP ONLY: this file is intended to run behind a TLS-terminating edge/load balancer that forwards HTTPS requests to this local listener." But every `location` sets `proxy_set_header X-Forwarded-For $remote_addr;` — an OVERWRITE, not `$proxy_add_x_forwarded_for` (append). If nginx really is behind an upstream LB, `$remote_addr` (from nginx's view) is the **LB's** IP, and nginx discards the real client IP the LB placed in the incoming XFF. The app runs with `TRUST_PROXY=true` and default `TRUSTED_PROXY_HOPS=1`; `getClientIp` then computes `clientIndex = validParts.length - hopCount - 1 = 1 - 1 - 1 = -1` (no client slot) and falls back to `X-Real-IP = $remote_addr = LB IP`. Result: every visitor behind the LB resolves to the same client IP.

Attack/failure scenario: In the documented LB topology, all per-IP limits key on the single LB IP — login (5 / 15 min), password-change, search, load-more, view-record, OG, share, and PAT-auth. Consequences: (a) five failed logins from ANY user lock out ALL users for 15 minutes (self-inflicted DoS + the exact "single shared bucket" failure `getClientIp`'s own warning describes); (b) all distributed-abuse throttles degrade to a global counter, both under- and over-limiting depending on aggregate traffic. Conversely, if nginx is actually the public edge (as CLAUDE.md's `TRUSTED_PROXY_HOPS` note assumes — "keep 1 for shipped nginx-only, where nginx overwrites incoming XFF with `$remote_addr`"), the config is correct and there is no issue. The two shipped statements are mutually exclusive, so an operator following the nginx file's own comment would deploy the broken variant.

Needs-manual-validation: confirm the real production topology of `gallery.atik.kr`. If nginx is the TLS-terminating edge, this is documentation-only (fix the nginx comment). If an upstream LB exists, switch the client-facing `location`s to `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and set `TRUSTED_PROXY_HOPS` to the real hop count so `getClientIp` selects the true client.

Suggested fix: Reconcile the contradiction. Either (a) correct the nginx header comment to state nginx IS the edge and `$remote_addr` is the real client (matches current XFF handling + CLAUDE.md), or (b) if an LB fronts nginx, use `$proxy_add_x_forwarded_for` and document the required `TRUSTED_PROXY_HOPS`. Add a deploy-doc note tying the XFF directive to the chosen topology.

---

### SEC-02 | Low | Confidence High | confirmed (defense-in-depth)
**Post-restore migrate child process inherits the full `process.env`, including `SESSION_SECRET`, which it does not use.**

File: `apps/web/src/app/[locale]/admin/db-actions.ts:784-786` — `spawn(process.execPath, [scriptPath], { env: { ...process.env, LANG, LC_ALL } })`.

Why: `dumpDatabase`/`runRestore` deliberately build a **minimal** env for the `mysqldump`/`mysql` children (only `PATH`, `NODE_ENV`, `MYSQL_*`, locale) to avoid leaking secrets into `/proc/<pid>/environ` and to prevent `~/.my.cnf` loading. `runPostRestoreMigrations` breaks that discipline by spreading all of `process.env` into the migrate child, so `SESSION_SECRET` (the session-forgery key) and any other runtime secret are exposed to a child process that only needs DB credentials. Not exploitable on its own (same host, trusted child, stderr is sanitized), but it is an asymmetry with the sibling spawns and widens the blast radius if migrate.js is ever compromised or made to dump its environment.

Suggested fix: Give the migrate child the same minimal env the dump/restore children use (`PATH`, `NODE_ENV`, `MYSQL_*` if migrate.js reads them via `mysql-connection-options.js`, `LANG`/`LC_ALL`, and only the specific vars migrate.js actually consumes), rather than `...process.env`.

---

### SEC-03 | Low | Confidence Medium | needs-manual-validation (hardening)
**Same-origin/CSRF boundary depends on `TRUST_PROXY=true` being set in production; when unset behind a proxy, origin reconstruction and rate-limit IP both degrade.**

File: `apps/web/src/lib/request-origin.ts:45-69` (`getExpectedOrigin`/`getTrustedRequestProtocol`) + `apps/web/src/lib/rate-limit.ts:169-196`.

Why: With `TRUST_PROXY` unset, `getExpectedOrigin` derives the expected host from the raw `Host` header and the protocol from the client's own `Origin`/`Referer`. The same-origin check still fails closed for cross-site CSRF (a victim browser sends `Origin: https://evil.example`, which cannot equal the target `Host`), so this is NOT a CSRF bypass. The residual risk is operational: the shipped deploy relies on `TRUST_PROXY=true` (CLAUDE.md checklist item 6). If an operator forgets it behind nginx, `getClientIp` returns `'unknown'` (single global rate-limit bucket, per the code's own SECURITY warning) and cookie `secure` flagging falls back to the `NODE_ENV==='production'` branch. Everything fails safe, but the security posture silently weakens.

Suggested fix: Consider failing startup (or emitting a startup-time error, not just a first-request `console.error`) in production when proxy headers are present but `TRUST_PROXY!=='true'`, so the misconfiguration is loud at deploy time rather than latent. Documentation-and-hardening only.

---

## Non-findings verified safe (spot list, so a later reviewer need not re-derive)

- **JSON-LD stored-XSS via EXIF-derived `camera_model`/`lens_model`:** all `dangerouslySetInnerHTML` JSON-LD sinks (`p/[id]`, home, `[topic]`, `c/[slug]`, `timeline`, `year/[year]`) route through `safeJsonLd` which escapes `<`/`>` (blocks `</script>` breakout) + U+2028/U+2029, and carry the CSP nonce. EXIF fields are additionally `stripUnicodeFormatting`-scrubbed. No breakout path.
- **OG SSRF:** `api/og/photo/[id]/route.tsx` pins the internal derivative fetch to `new URL(BASE_URL).origin` and fails closed (returns fallback) if `BASE_URL` is unparseable — never uses `new URL(req.url).origin`. Fallback redirects validate same-origin. Topic OG route does no internal fetch.
- **DB backup download path traversal:** `isValidBackupFilename` anchors `^backup-…\.sql$`, then `path.resolve` + `startsWith(backupsDir+sep)` + `realpath` re-containment; symlink/non-file rejected.
- **Static derivative traversal:** `serve-upload.ts` enforces `ALLOWED_UPLOAD_DIRS`, per-segment `SAFE_SEGMENT` + `..`/length checks, extension↔dir map, `lstat` symlink rejection, and `realpath` containment; content-type from a fixed allowlist (no SVG).
- **SQL injection in smart collections:** `compileSmartCollection` uses Drizzle `eq/gt/inArray/BETWEEN` with bound params, a column allowlist (`ALLOWED_COLUMNS`), `isScalarValue` finite-number/string enforcement, depth/size caps; the tag subquery binds `pred.value`. `containsLike` escapes `!%_` with `ESCAPE '!'`.
- **Restore SQL denylist evasion:** conditional-comment inner extraction + dual sanitization (comment→empty AND comment→spaces) defeats `DROP/**/TABLE`; write-target allowlist rejects schema-qualified (`db.table`) and non-app-table writes; `GRANT/REVOKE/CREATE USER/LOAD DATA/INTO OUTFILE/SYSTEM/PREPARE/…` blocked. Admin-only + same-origin + advisory-locked. Denylist is inherently incomplete but the threat model (admin restoring a self-supplied dump) plus `--one-database` bound it.
- **Timing attacks:** login runs Argon2 against a module-init dummy hash for missing users; session + PAT compares use `timingSafeEqual`; session shape regex checks run AFTER HMAC verify to avoid a structural-timing oracle.
- **PII leakage:** `publicSelectFields`/`timeline`/`search` all carry `Extract<…, PrivacySensitiveKeys> extends never` compile guards; `publicMapSelectFields` is the only lat/long exposure and has its own guard; GPS is excluded from public selects and (when `strip_gps_on_upload`) byte-stripped from the on-disk original on both browser and PAT upload paths.
- **Command injection:** `db-actions.ts` uses `spawn(argv[])` (no shell) with credentials in `MYSQL_*` env (not argv/`/proc/cmdline`); minimal env excludes `HOME`; stderr sanitized via `sanitizeStderr`. No `eval`/`new Function`; no shelled `exec` on user input.
- **Auth-guard lint gates:** `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts` are AST-based, reject star/aliased/default re-exports (fail-closed), resolve local aliases, detect shadowing of approved imports, and fail closed on non-literal dynamic imports. I did not find a bypass shape.
- **Secrets:** `.env.local.example` / `.env.deploy.example` carry only placeholders; `SESSION_SECRET` DB-fallback is refused in production (`session.ts:30-36`); Dockerfile runs as non-root `node` via `gosu`, weights not baked, `data/uploads/original` chmod 700.
- **Base56 share keys:** 10 chars over 56-alphabet via crypto rejection sampling (~58 bits); collision-safe DB `INSERT`/conditional-UPDATE with retry.
- **Public smart-collection page:** `/c/[slug]` gates on `collection.is_public` in both `generateMetadata` and render; the unauthenticated `getSmartCollections` getter was removed.

## Files / areas examined

`proxy.ts`; `lib/{api-auth,session,admin-tokens,request-origin,rate-limit,auth-rate-limit,validation,sanitize,csv-escape,og-sanitize,safe-json-ld,serve-upload,og-photo-fetch,smart-collections,sql-like,sql-restore-scan,db-restore,backup-filename,base56,content-security-policy,data (PII guards)}.ts`; `app/actions/{auth,public,sharing,collections,admin-users}.ts`; `app/[locale]/admin/db-actions.ts`; `app/api/admin/lr/upload/route.ts`; `app/api/admin/db/download/route.ts`; `app/api/og/route.tsx`; `app/api/og/photo/[id]/route.tsx`; `app/api/search/{semantic,similar/[id]}/route.ts`; `app/api/{health,live}/route.ts`; `app/[locale]/(public)/{p/[id],c/[slug]}/page.tsx` (JSON-LD sinks); `scripts/{check-api-auth,check-action-origin,check-public-route-rate-limit,entrypoint.sh}`; `nginx/default.conf`; `Dockerfile`; `deploy.sh`; `.env*.example`; `.context` deferred + cycle-85 aggregate.

## Commonly-missed-issues sweep

- `dangerouslySetInnerHTML` — 8 sinks, all JSON-LD via `safeJsonLd` (escaped). No raw HTML.
- `eval` / `new Function` — none.
- `child_process` — only `db-actions.ts` (spawn argv, no shell) and dev/build scripts (`init-db.ts`, `run-e2e-server.mjs`, `check-js-scripts.mjs`).
- Raw `sql\`\`` interpolation — all inspected sites bind columns/values through Drizzle params (`data.ts`, `smart-collections.ts`, `data-timeline.ts`, `auth.ts`); no untrusted string concatenation.
- `redirect(` with variable — `[topic]/page.tsx` builds from validated slug + `URLSearchParams`; proxy redirects use locale-allowlisted internal paths.
- `new URL(req.url)` / request-host trust — OG photo route explicitly avoids request-origin for internal fetch (pins BASE_URL); origin reconstruction gated on `TRUST_PROXY` (see SEC-03).
- Header/log injection — analytics referrer via `sanitizeReferrerHost`; stderr via `sanitizeStderr`; no user input into response header names/values observed.
