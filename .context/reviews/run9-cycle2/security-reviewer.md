# Security Review Report — RUN-9 Cycle-2

**Reviewer:** security-reviewer
**Repo:** /Users/hletrd/flash-shared/gallery
**HEAD:** 1ef54aaa (production source byte-identical to converged f63af3b9)
**Scope:** Whole repo — auth/session, all server actions, all API routes (esp. api/admin/**), file upload/serving, DB/raw-SQL surfaces, smart-collections, CSV/OG/validation sanitizers, privacy field guards, rate limiting, SSRF/command/secret surfaces
**Risk Level:** LOW

## Summary

- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- **NEW findings: 0 — convergence confirmed**

A fresh, deep, skeptical OWASP-Top-10 / secrets / authz / injection / SSRF / path-traversal / privacy / timing /
ReDoS / rate-limit sweep, validated from CODE (not docs/comments), found ZERO new actionable security findings.
This is an honest zero. Since the run-8 convergence (f63af3b9) the ONLY changes are two new test files
(`upload-processing-contract-lock.test.ts`, `upload-tracker-state.test.ts`) + review docs + an SW version stamp;
`git diff --stat f63af3b9 HEAD -- apps/web/src ':(exclude)apps/web/src/__tests__'` is EMPTY. No production logic
changed, so no new attack surface was introduced. Every high-risk surface re-examined this cycle remains
multi-layer-defended and mechanically enforced by lint gates + fixture tests.

## Verification evidence (all PASS this cycle)

- `lint:api-auth` — both `api/admin/**` routes (`db/download`, `lr/upload`) wrap `withAdminAuth`. OK.
- `lint:action-origin` — all mutating server actions store + early-return on `requireSameOriginAdmin()`; read-only
  getters carry explicit `@action-origin-exempt`. "All mutating server actions enforce same-origin provenance." OK.
- `lint:public-route-rate-limit` — every public mutating route uses a rate-limit helper or is exempt. OK.
- Fixture tests: 8 files / 109 tests PASS — privacy-fields, touch-target-audit, csv-escape, og-sanitize,
  sanitize-for-og-global, check-api-auth, check-action-origin, check-public-route-rate-limit.

## What was validated from code (per OWASP category)

### A01 Broken Access Control — SOLID
- `lib/api-auth.ts` (read in full): `withAdminAuth` enforces, in order, the token path (valid `X-GalleryKit-Token`
  + `tokenHasScope`) OR `hasTrustedSameOrigin()` → 403 + `isAdmin()` → 401. Token path intentionally bypasses
  same-origin (PAT/CORS design) but is gated on `verifyToken` + scope. No-store/nosniff defaults applied to all paths.
- `lib/request-origin.ts` (read in full): `hasTrustedSameOrigin` FAILS CLOSED — requires an explicit Origin/Referer
  match to the expected origin; trusts `X-Forwarded-*` only when `TRUST_PROXY=true`; strips default ports for correct
  comparison. No `allowMissingSource` default-open.
- LR upload route: `allowTokenScope: 'lr:upload'` gates entry; `revokeToken`/`listTokensForUser` scoped to `user_id`
  (no cross-admin token access).
- proxy.ts guards `/[locale]/admin/*` at the edge; API routes excluded from the matcher (each self-auths).

### A02 Cryptographic Failures — SOLID
- `lib/admin-tokens.ts` (read in full): PATs = `gk_` + base64url(32 random bytes); only SHA-256 hash stored;
  lookup BY HASH (plaintext never in a query param/slow-log); `tokenHashesEqual` uses `timingSafeEqual` with a
  hex-length + charset pre-check; `expires_at` enforced; fail-closed if table missing.
- Session tokens HMAC-SHA256 + `timingSafeEqual` (per prior cycles, unchanged). `SESSION_SECRET` required in prod.
- Login dummy-hash: `auth.ts:177` `user?.password_hash ?? await getDummyHash()` runs full Argon2 verify even for a
  missing user — no user-enumeration timing oracle (~100ms either way).
- Secret scan across `src/**`: ZERO hardcoded secrets/keys/passwords. `.gitignore` covers `.env`, `.env.local`,
  `.env.deploy`; only `*.example` env files are committed.

### A03 Injection — SOLID
- SQL: all raw `db.execute(sql\`…\`)` / `conn.query(…, [args])` use parameterized binding (admin-tokens, admin-users
  DELETE/UPDATE with `?` placeholders, data, topics, rate-limit). No untrusted concatenation.
- `lib/smart-collections.ts` (read in full): column allowlist (`isAllowedDirectColumn`), operator allowlist
  (`VALID_OPERATORS`), per-column op narrowing (`TAG_OPERATORS` = eq/contains only), depth cap (4), IN cap (100),
  `isScalarValue` rejects objects/arrays/NaN (closes mysql2 object→SQL expansion), LIKE wildcard escaping
  (`/[%_\\]/g`), all values via Drizzle binding. `between` uses an allowlisted Drizzle column ref + bound lo/hi.
- Command: `db-actions.ts` `spawn('mysqldump'|'mysql', [argArray])` — no shell, args are env-config (`DB_NAME` etc.),
  credentials passed via `MYSQL_PWD`/`MYSQL_USER` env (not `/proc/cmdline` flags). No command injection.
- XSS/Unicode: `lib/validation.ts` `UNICODE_FORMAT_CHARS` rejects bidi overrides (U+202A-202E, U+2066-2069) +
  zero-width/invisible chars at the admin-string validation layer; `og-sanitize` strips the same + C0 for OG cards.

### A05 Security Misconfiguration — SOLID
- All admin + public API responses set `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`.
- Public search routes reject wrong Content-Type, chunked encoding, oversized bodies (8 KiB cap), min-3-codepoint query.

### A07 Identification & Auth Failures — SOLID
- Login: rate-limit pre-increment BEFORE Argon2 (TOCTOU fix), dual-bucket IP + `acct:<sha256-prefix>` (DB-backed +
  in-memory fallback with rollback), audit logging, 24h session. `normalizeIp` regexes are linear (negated class
  `[^\]]+`, bounded `\d{1,3}` repeats) and input length-capped (≤512) — no ReDoS.

### A09/A10 SSRF + Logging — SOLID
- `lib/og-photo-fetch.ts` (read in full): the only outbound `fetch`. Target origin = TRUSTED `siteConfig.url`
  (server config), path hardcoded `/uploads/jpeg/`, filename from a DB `filename_jpeg` row. 10 s timeout, 1 MB cap.
  No user-controlled URL → no SSRF.

### Privacy / PII — SOLID
- `lib/data.ts` (read): `publicSelectFields` derived by destructure-OMISSION from `adminSelectFields`; compile-time
  guard `_SensitiveKeysInPublic extends never` blocks any of the 20 `PrivacySensitiveKeys` (lat/long, filename_original,
  user_filename, color/HDR audit cols, uploaded_by, etc.) from leaking into public selects. `publicMapSelectFields`
  (the ONLY lat/long-exposing select) is gated by `topics.map_visible = true` at the JOIN. `privacy-fields.test.ts` PASS.
- Public search/similar enrichment SELECTs enumerate only public columns (no GPS, no filename_original).

### File upload/serving path traversal — SOLID
- `lib/serve-upload.ts` (read in full): top-level dir allowlist (jpeg/webp/avif; `original/` excluded), per-segment
  `SAFE_SEGMENT` + length cap + `.`/`..` rejection, ext↔dir map, `lstat` symlink rejection, `realpath` containment
  (`startsWith(resolvedRoot + sep)`), TOCTOU closed (streams from resolved path).

## Process note (out of scope, not a code finding)
`npm audit` / dependency-CVE scanning was not run — offline environment, and dependency-CVE belongs in CI, not a
per-cycle code review. Recommend a scheduled `npm audit --omit=dev` (or equivalent) gate in CI; this is a process
recommendation, not a vulnerability in the current tree.

## Adjudicated items NOT re-filed (per task list, re-confirmed still closed/refuted)
- RES-R7C6-01 HEIC GPS-strip residual (CLOSED — no route streams original/; nginx 404 + ALLOWED_UPLOAD_DIRS)
- ARCH-R7C2-01 Stripe webhook (CLOSED-OBSOLETE — route deleted run-8)
- buildDownloadFilename path traversal (REFUTED — slugifyTitle strips bidi/ZW/C0-C1 + NFKD)
- color_pipeline_decision public leak (REFUTED — admin field merely undefined for public; also in PrivacySensitiveKeys)
- parseCicpFromHeif depth×1MB DoS (REFUTED — buffer pre-capped at 1 MB)
- CSP nonce reuse (REFUTED — per-request nonce)
- OBS-R7C2-03 non-transactional restore (deferred, runbook-mitigated)

## Security Checklist
- [x] No hardcoded secrets (zero hits; only *.example env committed)
- [x] All inputs validated (search body/query, upload filename/title/desc, smart-collection AST, admin strings)
- [x] Injection prevention verified (SQL param-binding, allowlists, no-shell spawn, Unicode/CSV/OG sanitizers)
- [x] Authentication/authorization verified (withAdminAuth + requireSameOriginAdmin + isAdmin; lint gates pass)
- [x] Path traversal / SSRF / ReDoS / timing surfaces verified safe
- [x] Privacy guards verified (compile-time + fixture test, map-visible gate)
- [ ] Dependencies audited — NOT run (offline; CI process recommendation, not a code finding)
