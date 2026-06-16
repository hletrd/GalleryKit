# Security Review Report — GalleryKit

**Reviewer:** security-reviewer (cycle 3)
**HEAD:** b1e9e0da
**Scope:** OWASP Top 10, auth/authz, secrets, injection (SQL/path/command/formula), SSRF, XSS, CSRF/same-origin, file-upload safety, rate-limiting, session handling, privacy (PII), unsafe deserialization, header injection, ReDoS, decompression bombs. Complete inventory examined — not sampled.
**Risk Level:** LOW

## Summary

- Critical Issues: 0
- High Issues: 0
- Medium Issues: 1 (historical secret in git history — documented/known; operational)
- Low / Informational: 3 (defense-in-depth observations, no live exploit)

This is one of the most thoroughly hardened codebases I have reviewed. ~58 findings closed across prior cycles have left every primary attack surface with layered, test-locked defenses. I confirmed every candidate against current HEAD and verified the previously-fixed items (OG SSRF pin, Stripe card-only/paid gate, bidi stripping in OG/JSON-LD/CSV/validation) are present and correct. I found NO new injection, auth-bypass, SSRF, XSS, CSRF, or privacy-leak vulnerabilities at HEAD.

Inventory examined in full:
- All 11 API routes (`api/admin/db/download`, `api/admin/lr/upload`, `api/checkout/[imageId]`, `api/download/[imageId]`, `api/health`, `api/live`, `api/og`, `api/og/photo/[id]`, `api/search/semantic`, `api/search/similar/[id]`, `api/stripe/webhook`).
- All 14 server-action files + `[locale]/admin/db-actions.ts`.
- Auth/session/crypto libs: `api-auth.ts`, `session.ts`, `password-hashing.ts`, `admin-tokens.ts`, `download-tokens.ts`, `request-origin.ts`, `action-guards.ts`.
- Input/output safety: `validation.ts`, `sanitize.ts`, `og-sanitize.ts`, `csv-escape.ts`, `safe-json-ld.ts`, `sql-restore-scan.ts`, `db-restore.ts`.
- File handling: `serve-upload.ts`, `gps-exif-strip.ts`, `storage/local.ts`, `upload-paths.ts`.
- Middleware (`proxy.ts`), rate-limit (`rate-limit.ts`), Stripe (`stripe.ts`), migrate (`migrate.js`), data-layer privacy guards (`data.ts`).
- Two parallel fan-out audits (auth-coverage + injection-surface) corroborated 100% lint-gate coverage and zero raw-SQL concatenation.

---

## Medium Issues

### 1. Real SESSION_SECRET + bootstrap passwords remain recoverable in git history
**Severity:** MEDIUM (operational; not a HEAD-source defect) · **Confidence:** Confirmed
**Category:** A02 Cryptographic Failures / A07 Auth Failures (key management)
**Location:** Git history — `apps/web/.env.local.example` at commit `d7c32790` (Initial commit); removed in `d068a7fb`. NOT present at HEAD.

**Evidence:**
```
$ git log --all -S "5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555" -- apps/web/.env.local.example
d068a7fb fix(security): comprehensive security and code quality hardening
d7c32790 Initial commit
```
History contains a fully-formed 64-hex `SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555` (the exact shape of `openssl rand -hex 32` output) plus `DB_PASSWORD=password` and `ADMIN_PASSWORD=password`. Current HEAD `.env.local.example` is clean (`<change-me>`, `<generate-with: openssl rand -hex 32>`) and `.env.deploy.example` uses `example.com`/`example.pem` placeholders.

**Threat model / exploit scenario:**
`SESSION_SECRET` is the HMAC-SHA256 signing key for admin session tokens (`session.ts` `generateSessionToken`/`verifySessionToken`). If any production deployment was ever bootstrapped from that historical example value and never rotated, an attacker who reads the public/forked git history can recover the key and **forge a valid session token for any admin userId** (`createHmac('sha256', secret).update(`${timestamp}:${random}`)`), bypassing login entirely. The 24h age check and DB-session lookup mitigate somewhat — a forged token still needs a matching `sessions` row hash — but the `hashSessionToken` design means a forged token whose hash an attacker can compute and pre-insert (if they have any DB write) would pass; more directly, knowledge of the signing secret defeats the integrity guarantee the design depends on.

**This is already documented** in CLAUDE.md: "If you ever seeded an environment from older checked-in examples, rotate both SESSION_SECRET and any bootstrap/admin credentials immediately. Historical git values must be treated as compromised." So this is a known, accepted residual — recorded here for completeness and re-confirmation against HEAD.

**Remediation (operational, in priority order):**
1. Confirm the production `SESSION_SECRET`, `DB_PASSWORD`, and `ADMIN_PASSWORD` are NOT any of the historical values. If in doubt, rotate now:
   ```bash
   openssl rand -hex 32   # new SESSION_SECRET → set env, restart web container (invalidates all sessions)
   # rotate DB password + admin password independently
   ```
2. Production runtime already refuses the DB-stored secret fallback (`session.ts` lines 30-36 throw in `NODE_ENV=production`), so the env var is authoritative — good.
3. Optional: purge history with `git filter-repo` if the repository is or may become public. Note this rewrites SHAs and is itself a destructive action — coordinate before doing it.

---

## Low / Informational

### 2. SQL-restore dangerous-keyword scanner can be bypassed by inter-token block comments
**Severity:** LOW (defense-in-depth only) · **Confidence:** Confirmed (theoretical, not independently exploitable)
**Category:** A03 Injection (defense-in-depth layer)
**Location:** `apps/web/src/lib/sql-restore-scan.ts:104` (`withoutComments = withoutConditionals.replace(/\/\*.*?\*\//gs, '')`)

**Analysis:** `stripSqlCommentsAndLiterals` removes `/* ... */` comments BEFORE running `DANGEROUS_SQL_PATTERNS`. MySQL also strips inter-token comments at parse time, so `DROP/**/TABLE x` is valid `DROP TABLE` to MySQL — but after this scanner deletes the `/**/`, the text becomes `DROPTABLE x`, which the `\bDROP\s+TABLE\b` pattern no longer matches. An attacker-crafted dump could thus slip a `DROP/**/TABLE`, `CREATE/**/TRIGGER`, etc. past the scanner.

**Why this is LOW, not exploitable in practice:**
- This scanner is explicitly **defense-in-depth** layered on top of `mysql --one-database` (`db-actions.ts:455`), which constrains writes to the target schema, AND the entire restore path is admin-only behind `isAdmin()` + `requireSameOriginAdmin()` + an advisory lock. An attacker who can invoke restore is already an authenticated admin who can drop tables through the normal admin surface anyway.
- DROP TABLE on the app's OWN tables is intentionally ALLOWED (the `ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` masking at line 18-21) because a legitimate mysqldump restore drops-then-recreates. So the bypass mostly re-enables a class of statement that is partly permitted by design.
- No ReDoS: all scan regexes use lazy/bounded quantifiers; I checked for nested repetition and found none. Chunk-boundary handling uses a 1 MB overlap tail (`appendSqlScanChunk`).

**Optional hardening:** collapse inter-token comments to a single space rather than deleting them (`.replace(/\/\*.*?\*\//gs, ' ')`) so `DROP/**/TABLE` → `DROP TABLE` and the `\s+` patterns still fire. Low priority given the admin-only + `--one-database` context.

### 3. `admin_tokens.verifyToken` touches `last_used_at` before scope authorization
**Severity:** LOW (informational) · **Confidence:** Confirmed (no security impact)
**Location:** `apps/web/src/lib/admin-tokens.ts:158`

`verifyToken` issues a best-effort `UPDATE admin_tokens SET last_used_at = NOW()` once the hash matches and the token is unexpired, BEFORE the caller (`api-auth.ts:67`) checks `tokenHasScope`. A holder of a valid-but-wrong-scope token can therefore bump `last_used_at` on a 401 path. This is purely cosmetic (the timestamp is advisory) and the write is parameterized + self-catching. No action required; noted for completeness.

### 4. OG per-photo internal fetch interpolates a DB filename onto the pinned origin
**Severity:** LOW (informational — confirmed safe) · **Confidence:** Confirmed
**Location:** `apps/web/src/lib/og-photo-fetch.ts:49-50`

`tryFetchPhotoBuffer` builds `${origin}/uploads/jpeg/${sizedFilename}` where `sizedFilename` derives from `image.filename_jpeg` (a `crypto.randomUUID()`-based DB value, never user-controlled) and `origin` is now pinned to the trusted `siteConfig.url` (the SSRF fix at `api/og/photo/[id]/route.tsx:111-116`, commit `3f886f10`, verified present). The `.replace(/\.jpg$/i, `_${size}.jpg`)` with a numeric `size` cannot inject path traversal. No issue — recorded to confirm the SSRF pin holds and the filename source is non-attacker-controlled.

---

## Confirmed-Hardened (verified present at HEAD — NOT findings)

**Authentication & sessions (`session.ts`, `auth.ts`, `password-hashing.ts`):**
- Argon2id, memoryCost 65536 / timeCost 3 / parallelism 4 (exceeds OWASP), shared `PASSWORD_HASH_OPTIONS` across login/change/seed/dummy.
- HMAC-SHA256 session tokens verified with `timingSafeEqual`; structural shape checks run AFTER crypto (no timing oracle); 24h age bound; session hash stored (not plaintext) so DB leak ≠ usable cookies.
- Production refuses DB-stored secret fallback (`session.ts:30-36`).
- Login: per-IP + per-account (`acct:<sha256>`) rate-limit buckets, pre-increment before Argon2 (TOCTOU-safe), dummy-hash timing equalization, session-fixation prevention (delete-others in txn), no rollback on infra error (Pattern 1).
- Password change: rotates ALL sessions in a txn, validation before rate-limit consumption, codepoint length checks.

**Same-origin / CSRF (`request-origin.ts`, `action-guards.ts`, `api-auth.ts`):**
- `hasTrustedSameOrigin` fails closed (requires explicit Origin/Referer match); TRUST_PROXY-gated X-Forwarded-* with right-most-hop selection.
- `withAdminAuth` enforces origin + `isAdmin()` centrally (PAT path bypasses origin by design, gated on scope); auto-applies no-store + nosniff.
- `requireSameOriginAdmin()` on every mutating action. **Lint gates (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`) verified to give 100% coverage** — fan-out audit found all 2 admin routes wrapped and all 41 server actions either guarded or explicitly `@action-origin-exempt` (read-only).

**Injection (SQL/command/path/formula):**
- All app queries use Drizzle ORM or parameterized `sql\`\`` / `?` placeholders. Independent fan-out audit found ZERO string-concatenation into SQL in production code.
- `mysqldump`/`mysql` spawned with array args (no `shell:true`), credentials via `MYSQL_PWD` env (not `/proc/cmdline`), minimal env (HOME excluded → no `~/.my.cnf`), `--one-database` on restore.
- Path traversal: `serve-upload.ts` + `db/download` + `download/[imageId]` all use `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `lstat` symlink rejection + `realpath` containment (TOCTOU-safe, streams from resolved path). `storage/local.ts` `normalizeStorageKey` rejects `..`/leading-slash/empty segments.
- CSV formula injection: `csv-escape.ts` strips C0/C1, bidi+zero-width (shared `UNICODE_FORMAT_CHARS`), collapses CR/LF, prefixes `=+-@` with leading-whitespace tolerance, quotes+doubles.
- No `eval`/`Function`/`vm`/dynamic `require` with user input.

**XSS / output encoding:**
- All 8 `dangerouslySetInnerHTML` sinks feed JSON-LD via `safeJsonLd` (`<` → `<`, U+2028/2029 escaped) — verified each call site.
- OG (Satori) text run through `sanitizeForOg` (bidi/zero-width strip + C0 strip) on BOTH routes.
- Admin string surfaces reject `UNICODE_FORMAT_CHARS` at validation (`sanitizeAdminString`, `containsUnicodeFormatting`); EXIF-derived strings get `stripUnicodeFormatting` source defense.
- Global headers: nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, HSTS preload, locked-down Permissions-Policy, nonce CSP in prod.

**SSRF:** OG per-photo internal fetch pinned to `siteConfig.url` (not request Host) — the recently-fixed item, confirmed present. 10s timeout + 1 MB cap per fetch.

**Stripe / paid downloads:** webhook signature mandatory (`constructStripeEvent` throws without `STRIPE_WEBHOOK_SECRET`); `payment_status === 'paid'` gate; `payment_method_types: ['card']` (async-payment gap closed operationally); idempotency via `sessionId` UNIQUE + SELECT + dup-key disambiguation; tier allowlist; deleted-image → 200+manual-refund (no Stripe retry storm). Download tokens: `dl_<43 base64url>`, SHA-256 hashed, single-use atomic claim, constant-time verify, interstitial GET (claim moved to POST so mail scanners don't burn tokens).

**File-upload safety:** UUID filenames (no user-controlled names on disk), Sharp `limitInputPixels` (decompression bomb), RAW rejection, HDR-ingest gate honored on both browser + LR-PAT paths, per-file 200 MB + cumulative byte/count window caps, disk-space pre-check, restore-maintenance guards, upload-processing contract advisory lock.

**Privacy:** `publicSelectFields` derived from `adminSelectFields` by omission with compile-time `_SensitiveKeysInPublic`/`_PrivacySensitiveKeys` + `_mapPrivacyGuard` + large-payload guard. GPS scrubbed from on-disk original (the paid-download streams) via bounds-checked byte-level `gps-exif-strip.ts` (every walker returns null on anomaly → re-encode fallback; never `withMetadata()`).

**Rate limiting:** every public mutating/expensive surface covered (login, search, load-more, OG×2, checkout, semantic×2, share-key, analytics views); `getClientIp` TRUST_PROXY-gated with hop-count + `normalizeIp` validation; bounded Maps with eviction; documented rollback patterns.

**Migration drift:** `migrate.js` reads full journal, SHA-256 per-entry hashes, post-condition assertion throws on silent skips (`migrate.js:713`), idempotent `reconcileLegacySchema` + `baselineAllJournalMigrations`.

**ReDoS / deserialization:** SQL scanner regexes use lazy/bounded quantifiers (no nested repetition); semantic route caps body 8 KB + rejects chunked + validates Content-Type prefix + JSON shape; restore validates 256-byte header + 250 MB cap + dangerous-SQL scan.

---

## Security Checklist

- [x] No hardcoded secrets at HEAD (current `.env.local.example` / `.env.deploy.example` use placeholders; no live `sk_`/`whsec_`/`AKIA`/PEM keys in source)
- [~] Secrets in git history — historical SESSION_SECRET/passwords recoverable (Medium #1, documented/operational)
- [x] All inputs validated (codepoint-aware length, Unicode-format rejection, slug/filename regex, JSON shape + size)
- [x] Injection prevention verified (parameterized SQL, array-arg spawn, path containment + symlink rejection, CSV formula escaping)
- [x] Authentication/authorization verified (Argon2id, HMAC + timingSafeEqual, middleware guard, withAdminAuth + requireSameOriginAdmin, lint gates 100% coverage, last-admin guard, advisory locks)
- [x] SSRF prevented (OG fetch pinned to trusted origin)
- [x] XSS prevented (JSON-LD escaped, OG sanitized, security headers + CSP)
- [x] CSRF prevented (fail-closed same-origin on every mutating action + admin API route)
- [x] Privacy enforced (compile-time public/admin field guards, GPS byte-strip on originals)
- [x] Dependencies — Stripe SDK justified; (dependency CVE audit not run in this read-only pass — recommend `npm audit` in CI)
- [x] CLIP semantic search remains dark-by-default (disabled → no-op); hard guard respected — NOT proposing activation
