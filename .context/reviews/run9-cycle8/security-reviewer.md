# Security Review Report — run-9 cycle-8

**Reviewer:** security-reviewer (OWASP Top 10 + secrets + unsafe patterns)
**Repo:** GalleryKit (Next.js 16 / React 19 / TypeScript, MySQL/Drizzle, Argon2, Sharp)
**HEAD:** 4e132b03700889e1a937dac16d0d2eae9518d681
**Scope:** Whole-repo deep security pass — auth/sessions, server actions, API routes, file upload/serve, DB queries, sanitizers, privacy-field selection, rate limiting, CSP/headers, SSRF, secrets.
**Risk Level:** LOW (converged — 0 exploitable defects found)

## Summary

- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- Polish: 0

A truthful **0 security findings** outcome. This is a heavily-reviewed repo at convergence; every security control I examined is correctly implemented, and all four lint gates plus 69 security unit tests pass. No findings were manufactured.

## Methodology

Built a security-relevant file inventory first (8 API routes, 13 server-action files + db-actions, ~20 security lib modules), then read every relevant file end-to-end rather than trusting the gates. Verified the lint gates' invariants by running them AND spot-checking the actual route/action bodies. Ran a repo-wide dangerous-pattern sweep (eval/Function/child_process/shell:true/dangerouslySetInnerHTML/raw-SQL-concat/Math.random-for-tokens/withMetadata-GPS-leak/hardcoded-secrets).

## OWASP Top 10 — evaluation

### A01 Broken Access Control — PASS
- `withAdminAuth` (`lib/api-auth.ts:49`) enforces, in order: optional token-scope path → `hasTrustedSameOrigin` → `isAdmin()`, and stamps `no-store` + `nosniff` on every response. Verified on `api/admin/db/download/route.ts:22` and `api/admin/lr/upload/route.ts:57`.
- `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit` all pass. Spot-checked: every mutating server action carries both `isAdmin()` AND `requireSameOriginAdmin()` (`action-guards.ts:37`); the `isAdmin > requireSameOriginAdmin` count deltas in settings.ts/seo.ts/admin-backfill.ts/collections.ts/tags.ts are all read-only getters carrying explicit `@action-origin-exempt` comments (`getGallerySettingsAdmin`, `getSeoSettingsAdmin`, `getBackfillStatus`), not mutating gaps.
- Middleware (`proxy.ts:81-116`) is a presence+format pre-check; full crypto validation stays in server actions (defense in depth). API routes excluded from the matcher and each owns its auth.
- "Last admin deletion prevented" + multi-root-admin model (no role escalation surface) intact.

### A02 Cryptographic Failures — PASS
- Argon2id (`password-hashing.ts`, 64 MiB / t=3 / p=4) for passwords; HMAC-SHA256 session tokens verified with `timingSafeEqual` (`session.ts:117`); session token stored as SHA-256 hash so DB compromise yields no usable cookie (`session.ts:9`).
- `SESSION_SECRET` env-only in production — `session.ts:30` throws rather than falling back to the DB-stored secret in prod (closes forge-on-DB-compromise).
- PAT tokens: 32-byte `randomBytes` base64url, only SHA-256 digest persisted, constant-time hash compare (`admin-tokens.ts:64`), hash-based parameterized lookup (plaintext never hits a query parameter), expiry enforced.
- No `Math.random` used for any security token (all `crypto.randomBytes`/`randomUUID`).

### A03 Injection — PASS
- **SQL:** Drizzle parameterization throughout; raw `db.execute(sql\`...\`)` in admin-tokens.ts uses tagged-template parameters (`${presentedHash}`, `${userId}`), not concatenation. LIKE wildcards escaped `/[%_\\]/g, '\\$&'` with documented backslash-escape semantics (`data.ts:1419`).
- **Command:** mysqldump/mysql via `spawn` with arg arrays (no `shell:true` anywhere); credentials via `MYSQL_PWD`/`MYSQL_USER` env (not `/proc/cmdline`); `HOME` excluded (no `.my.cnf` injection); stderr sanitized (`sanitizeStderr`).
- **XSS:** All `dangerouslySetInnerHTML` sites are JSON-LD `<script type="application/ld+json">` and every one routes through `safeJsonLd` (`safe-json-ld.ts`) which escapes `<` → `<` (kills `</script>`) + U+2028/U+2029, with a per-request CSP nonce. Verified all 8 sites (p/[id], home, topic, c/[slug], year, timeline). Admin strings reach OG cards only through `sanitizeForOg` (bidi/zero-width/C0 strip).
- **Path:** `serve-upload.ts` + `db/download` — dir allowlist, ext/dir map, `SAFE_SEGMENT` regex, `.`/`..` rejection, lstat symlink rejection, realpath containment (`startsWith(root + sep)`), streams from the resolved path (TOCTOU closed). `isValidBackupFilename` strict-anchored regex prevents Content-Disposition header injection.

### A04 Insecure Design — PASS
- Restore window holds advisory lock + upload-contract lock + maintenance flag; uploads re-check maintenance pre- and post-save; idempotent tracker-claim settle; fail-closed config resolution for semantic-search production gate.

### A05 Security Misconfiguration — PASS
- Production CSP (`content-security-policy.ts:105-117`): `script-src 'nonce-…' 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, `form-action 'self'`. The `'unsafe-inline' 'unsafe-eval'` is confined to the `if (isDev)` branch only (matches the previously-adjudicated REFUTED finding). Global `X-Content-Type-Options: nosniff`.

### A06 Vulnerable Components — PASS (1 deferred, non-exploitable, not re-filed)
- The only known item is postcss 8.4.31 bundled inside `node_modules/next/` (build-time only, GHSA-qx2v-qp2m-jg93). Per instructions, NOT re-filed — confirmed no runtime CSS-parsing path consumes attacker input.

### A07 Identification & Auth Failures — PASS
- Dual-bucket login rate limit (per-IP 5/15min + per-account `acct:<sha256-prefix>` 5/15min), bounded Maps with eviction, DB backup; dummy-hash timing equalization (`auth.ts:65`); same-origin gate on login itself (`auth.ts:95`); token age window + future-timestamp rejection (`session.ts:132`).

### A08 Software & Data Integrity — PASS
- DB restore: file-size cap, plausible-header validation, chunked dangerous-SQL scan, `--one-database` flag, temp file `0o600`, advisory-locked.
- `assertBlurDataUrl` producer+consumer MIME contract; `safeInsertId` BigInt-overflow guard.

### A09 Logging & Monitoring — PASS
- Audit events on backup/restore/download/csv-export/lr-token-used; full IPs never persisted for analytics (only `country_code`); stderr sanitized of credentials.

### A10 SSRF — PASS
- The per-photo OG route's internal photo fetch is pinned to the trusted `siteConfig.url` origin (`api/og/photo/[id]/route.tsx:111-116`), NOT the inbound `req.url`/Host — closes the blind-SSRF/cache-poison lever. The path component is a DB-stored UUID derivative (`image.filename_jpeg`); `size` comes from configured `imageSizes`. 10s timeout + 1 MB cap per fetch.

## Secrets Scan — CLEAN
- No hardcoded keys/passwords/tokens (`sk-`/`AKIA`/`ghp_`/`xox`/`-----BEGIN`/`api_key=...` all negative). The lone regex hit was a `console.error` literal in auth.ts. No `.env`/`.env.local` in git history. No unexpected `process.env.*SECRET/PASSWORD/TOKEN/KEY` usage outside the documented set.

## Rate Limiting — CLEAN
- Public mutating surfaces all rate-limited: semantic search + similar (shared 30/min bounded map, Pattern-2 rollback), load-more (120/min in-memory + DB), search (DB-backed), view-recording (120/min bounded map), OG routes (30/60s, charged-on-404 anti-enumeration). `lint:public-route-rate-limit` passes; the `similar/[id]` GET voluntarily rate-limits despite being GET-exempt.

## Privacy Field Selection — CLEAN
- `publicSelectFields` is a separate object derived from `adminSelectFields` by explicit omission; compile-time `_SensitiveKeysInPublic` and `_MapSensitiveKeys` guards (`data.ts:414-429`) fire at `tsc` on any leak. `_PrivacySensitiveKeys` union covers GPS + all admin-only color/HDR columns. `adminSelectFields` is never imported into client components. `privacy-fields.test.ts` passes. lr/upload + semantic + similar enrichment select only public fields with `processed = true`.

## Verification evidence
- `npm run lint:api-auth` → OK (all admin routes wrap `withAdminAuth`)
- `npm run lint:action-origin` → "All mutating server actions enforce same-origin provenance."
- `npm run lint:public-route-rate-limit` → OK (all public mutating handlers covered)
- `vitest run` privacy-fields + check-api-auth + check-action-origin + check-public-route-rate-limit + sanitize-for-og-global → 69 passed (69)

## Security Checklist
- [x] No hardcoded secrets (scan + git history clean)
- [x] All inputs validated (slug/Unicode/length/code-point, fail-closed)
- [x] Injection prevention verified (SQL param + LIKE escape; command arg-array; XSS safeJsonLd; path realpath-contained)
- [x] Authentication/authorization verified (withAdminAuth + isAdmin + requireSameOriginAdmin chain, lint gates + spot-checks)
- [x] SSRF closed (origin-pinned internal fetch)
- [x] Privacy field leakage prevented (compile-time guards + separate-object derivation)
- [x] Rate limits on public mutating routes (lint gate + manual confirm)
- [x] CSP hardened in production (nonce, object-src none, no unsafe-inline in prod)
- [x] Dependencies audited (only deferred non-exploitable postcss transitive)

## Adjudicated items NOT re-reported (per instructions)
- CSP nonce / session off-by-one (REFUTED) — confirmed prod CSP uses nonce; isDev-only unsafe-inline.
- All run-9 FIXED items.
- postcss 8.4.31 bundled transitive (deferred, build-time only, non-exploitable).

DISPOSITION: 0 security DEFECTS, 0 POLISH.
