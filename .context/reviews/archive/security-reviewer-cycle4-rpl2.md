# Security Reviewer — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: OWASP Top 10, secrets, unsafe patterns, authN/authZ. Full-repo deep pass.

## Scope

Evaluated auth stack (`auth.ts`, `session.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`), mutation surface (all actions), file-serving routes (`serve-upload.ts`, backup download route), DB restore (`db-actions.ts`, `sql-restore-scan.ts`), privacy boundary (`data.ts`), and the middleware proxy.

## Findings

### C4R-RPL2-SEC-01 — JSON-LD payload does not escape U+2028/U+2029 line terminators [LOW] [MEDIUM]
**File:** `apps/web/src/lib/safe-json-ld.ts:2-4` (also flagged by code-reviewer)

Only `<` is escaped to `<`. Modern browsers treat `<script type="application/ld+json">` content as opaque data rather than JS, so U+2028/U+2029 do not typically enable XSS. However, there exist historical parser bugs and proxies/CDNs that may normalize or transcode UTF-8, producing an unexpected interpretation. The fix is a 2-line change and defence-in-depth; recommend accepting.

**Also:** the `image.description` field in `p/[id]/page.tsx:166` (`description: image.description`) flows into JSON-LD. Descriptions are admin-controlled (sanitized via `stripControlChars`), so direct XSS via attacker-controlled input is not possible in normal operation. The risk is limited to malicious admin or a future path that accepts public description input.

### C4R-RPL2-SEC-02 — `poolConnection.on('connection')` query failure is silent [LOW] [MEDIUM]
**File:** `apps/web/src/db/index.ts:28-30` (also flagged by code-reviewer)

A failed `SET group_concat_max_len` leaves the connection with the MySQL default (1024 bytes). The CSV export path joins GROUP_CONCAT'd tag names — truncation silently produces incorrect exports. This is a data-integrity / audit concern, not classical security, but still worth logging.

### C4R-RPL2-SEC-03 — Session-secret dev fallback reads DB value without origin check [LOW] [LOW]
**File:** `apps/web/src/lib/session.ts:41-77`

In development mode with no `SESSION_SECRET` env var, the secret is stored in the `admin_settings` table. If a developer accidentally imports a production DB snapshot into dev, the persisted `session_secret` will cross environments. CLAUDE.md explicitly warns about this ("rotate both `SESSION_SECRET` and any bootstrap/admin credentials immediately"). No change required; the warning is already there.

### C4R-RPL2-SEC-04 — `TRUST_PROXY` governs both `getClientIp` and same-origin expected-origin computation; a misconfiguration would fail closed in different ways on the two paths [LOW] [LOW]
**File:** `apps/web/src/lib/request-origin.ts:33-45`, `apps/web/src/lib/rate-limit.ts:64-87`

In `request-origin.ts`, `trustsProxyHeaders()` checks `process.env.TRUST_PROXY === 'true'`. In `rate-limit.ts:64`, the same check gates reading `x-forwarded-for`. If an admin sets `TRUST_PROXY=1` instead of `TRUST_PROXY=true`, `trustsProxyHeaders()` returns false (fail-closed → rate-limit uses "unknown" IP, same-origin uses naked Host header). This is correct behaviour but the dual use of the single env var means a typo now affects two different defence mechanisms. Consider also accepting `TRUST_PROXY=1` as truthy in both places, but fail-closed is safer; leave as-is.

### C4R-RPL2-SEC-05 — `hasTrustedSameOriginWithOptions` allows missing `Origin`/`Referer` when caller opts in [LOW] [LOW]
**File:** `apps/web/src/lib/request-origin.ts:66-90`

Today, the only caller that sets `{ allowMissingSource: false }` (explicit strict) is `/api/admin/db/download` — that is the strict intent. `hasTrustedSameOrigin` (no options) also fails closed because `allowMissingSource` defaults to `false`. Confirmed no caller opts into the loose mode. No change needed; keep the opt-in strict.

### C4R-RPL2-SEC-06 — No `Content-Security-Policy` hardening for inline JSON-LD scripts [DEFERRED carry-forward]

Existing deferred item D1-01/D2-08/D6-09 — CSP `'unsafe-inline'` hardening. Confirmed still unchanged. Carry forward.

### C4R-RPL2-SEC-07 — `restoreDatabase` relies on `--one-database` to scope writes, but the scanner already allows benign `CREATE DATABASE` statements [LOW] [MEDIUM]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:383-388`, `apps/web/src/lib/sql-restore-scan.ts`

`DANGEROUS_SQL_PATTERNS` blocks `DROP DATABASE` but does not block `CREATE DATABASE`. `--one-database` prevents statements targeting other databases, but a malformed dump containing `CREATE DATABASE x; USE x;` followed by data may be silently accepted. This is risk-acceptable because:
- The SQL is executed under the app's DB user which typically lacks `CREATE DATABASE` privilege,
- `--one-database` filters out non-targeted DB writes,
- The maintenance window is admin-only.

Defence-in-depth: add `CREATE DATABASE` to the dangerous-patterns list. Not a blocker.

## Positives

- Argon2id password hashing with dummy-hash timing equalization (prevents user enumeration).
- HMAC-SHA256 session tokens verified with `timingSafeEqual` (constant-time).
- Privacy fields (lat/lon, filename_original, user_filename) excluded from public queries with **compile-time** TypeScript guard (`_SensitiveKeysInPublic`).
- Every mutating server action calls `isAdmin()` and `requireSameOriginAdmin()` (defense in depth beyond framework CSRF).
- File-serving routes reject symlinks with `lstat()` + `isSymbolicLink()`.
- Upload directory is whitelisted (`jpeg/webp/avif` only); `original/` excluded.
- Path containment enforced via `resolvedPath.startsWith(resolvedRoot + path.sep)`.
- mysqldump/mysql restore use `MYSQL_PWD`/`MYSQL_USER` env vars, not CLI flags (credentials not in /proc/<pid>/cmdline).
- SQL restore scanner covers conditional comments, hex/binary literals, and streamed chunks with overlap tail.
- Rate limit storage survives process restart (DB buckets) with in-memory fast-path cache.

## Confidence Summary

- 0 CRITICAL, 0 HIGH, 0 MEDIUM new findings.
- 5 LOW findings this cycle (RPL2-SEC-01 through -07 omitting -06).
- Existing deferred CSP hardening unchanged.
