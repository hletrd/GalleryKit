# Security Review — Deep Multi-Agent Sweep

**Date:** 2026-06-13
**HEAD:** `ce0029aa` (working tree CLEAN — no tracked source modifications; only `.context/reviews/*.md` differ)
**Reviewer angle:** OWASP Top 10, secrets/credential handling, unsafe patterns, auth/authz, injection (SQL/command/path), SSRF, XSS, CSRF, insecure deserialization, access control, sensitive-data exposure.
**Scope:** `apps/web/src/app/api/**` (all routes incl. admin), `apps/web/src/app/actions/**`, `apps/web/src/lib/` (auth, session, api-auth, request-origin, admin-tokens, validation, og-sanitize, og-photo-fetch, smart-collections, download-tokens, csv-escape, db-actions), `apps/web/src/proxy.ts`, Stripe webhook + checkout, DB download/restore, paid-download route, semantic search, sharing.

## Summary

- **Critical Issues: 0**
- **High Issues: 0**
- **Medium Issues: 0**
- **Low / defense-in-depth notes: 0 new** (the two prior LOW/INFO notes — `style-src 'unsafe-inline'`, `LOG_PLAINTEXT_DOWNLOAD_TOKENS` opt-in — remain documented-intentional, no change required)

**Risk Level: LOW.**

**No live-exploitable vulnerability exists across the full OWASP Top 10.** This is an independent re-verification at HEAD `ce0029aa` (validated from code, not commit messages or comments). The run-8 cycle-3 security fixes — og-sanitize unification into the JSON-LD page (`0028ede4`) and the NCLX code-2 `isHdr` pin (`22387f32`) — are correct and opened no new holes. The prior sweep's "no live-exploitable vuln" verdict still holds; this cycle is honest convergence.

All three security lint gates pass on HEAD:
- `lint:api-auth` → OK (every admin API route wraps `withAdminAuth`)
- `lint:action-origin` → OK (every mutating server action returns early on `requireSameOriginAdmin()`)
- `lint:public-route-rate-limit` → OK (every public mutating route rate-limited or carries an audited exempt tag)

## Critical / High / Medium Issues

None.

## Re-verification of the two freshly-landed run-8-c3 security fixes

### 1. og-sanitize unification into the JSON-LD page (`0028ede4`) — CORRECT
**Location:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:14`, `apps/web/src/lib/og-sanitize.ts:28`
**Verified:** The JSON-LD page now imports the shared `sanitizeForOg` (`stripUnicodeFormatting` + `OG_C0_CONTROL_CHARS` strip) instead of the prior weaker local copy that stripped only Unicode-format chars and carried a docstring lie. All three consumers (both OG image routes + the JSON-LD page) now share one `@/lib/og-sanitize` module. The C0-strip is defense-in-depth here (the JSON-LD sink is additionally protected by `safeJsonLd`, which escapes `<` → `<`, U+2028, U+2029, and `JSON.stringify` escapes C0 in string values), but the symmetry and the doc honesty are now correct. Not exploitable before or after.

### 2. NCLX code-2 `isHdr` pin (`22387f32`) — CORRECT, no security impact
**Location:** `apps/web/src/lib/color-detection.ts:398`
**Verified:** The change is purely additive (a documentation comment + the unchanged `const isHdr = transferFunction === 'pq' || transferFunction === 'hlg'` derivation). The behavioral effect (a rare NCLX-code-2 + PQ/HLG-named-ICC source is now rejected at upload when `allow_hdr_ingest=false`) is an upload-rejection, which fails CLOSED — it cannot create a delivery-honesty or exposure issue. No new attack surface.

## VERIFIED-CLEAN (stress-tested this cycle, code-level confirmation)

### A01 — Broken Access Control: CLEAN
- **Middleware guard** (`proxy.ts:54-116`): `isProtectedAdminRoute` correctly protects `/[locale]/admin/*` and default-locale `/admin/*` sub-routes; the login page (`/admin` exactly) is intentionally excluded. Cookie presence + format pre-check (≥100 chars, 3 non-empty colon-segments) is defense-in-depth; full crypto validation is in server actions. `/api/*` is excluded from the matcher (documented) — every `/api/admin/*` route uses `withAdminAuth`.
- **`withAdminAuth`** (`api-auth.ts:49`): central CSRF (`hasTrustedSameOrigin`) + `isAdmin()` on every admin API route; token path (`allowTokenScope`) runs first and is scope-gated, bypassing same-origin by design for cross-origin PAT integrations. Adds `no-store` + `nosniff` defaults to handler responses.
- **Server actions**: every mutating action enforces `isAdmin()` + `requireSameOriginAdmin()` (lint-gate-enforced). Public actions (`public.ts`) are intentionally anonymous, carry `@action-origin-exempt` tags, and are bounded by per-IP rate limits.
- **IDOR**: share keys (`getImageByShareKey`, `data.ts:1117`) gated on `isBase56(key, 10)` (~2^58 keyspace, random, unguessable) + `processed = true` + `publicSelectFields` (PII-stripped). PAT revoke (`admin-tokens.ts:227`) is user-scoped (`WHERE id = ? AND user_id = ?`). No sequential-id object access on any public surface.

### A02 — Cryptographic Failures: CLEAN
- Argon2id (memoryCost 65536 / timeCost 3 / parallelism 4) for passwords; HMAC-SHA256 session tokens verified with `timingSafeEqual` (`session.ts:117`); session token shape asserted AFTER crypto verify (no timing oracle, `session.ts:124`).
- `SESSION_SECRET` env-only in production — `getSessionSecret` THROWS in prod if absent rather than falling back to a DB-stored secret (`session.ts:30`), keeping the signing key out of the user-data trust domain.
- Session tokens stored as SHA-256 hash (`hashSessionToken`) so DB compromise yields no usable cookie. PAT tokens stored as SHA-256 only; plaintext shown once.
- Cookie attributes: `httpOnly`, `secure` (TLS or prod via trusted-proxy protocol normalization), `sameSite: lax`, `path: /`, 24h maxAge.

### A03 — Injection (SQL / Command / Path / XSS): CLEAN
- **SQL**: all queries use Drizzle ORM parameterization. Audited raw `sql\`\`` surfaces (`data.ts`, `admin-tokens.ts`, `smart-collections.ts`, `rate-limit.ts`, `data-timeline.ts`, `db-actions.ts`) interpolate only column references and `${value}` placeholders (bound as `?`), never string-concatenated untrusted input. `smart-collections.ts` additionally enforces `isScalarValue` (rejects objects/arrays/NaN that mysql2 would expand into SQL fragments), column allowlist via `Object.prototype.hasOwnProperty.call` (proto-pollution-safe), operator allowlist, per-column operator narrowing, depth cap, and LIKE-wildcard escaping (`/[%_\\]/g`).
- **Command**: only `child_process` use is `spawn('mysqldump', [argv-array], {env})` in `db-actions.ts:157` — argv form (no shell), credentials via `MYSQL_PWD`/`MYSQL_*` env (not CLI flags, not in `/proc/cmdline`), minimal env (no HOME → no `~/.my.cnf`). No shell-string interpolation anywhere.
- **Path traversal**: download route (`api/download/[imageId]:306`) and DB-download route (`api/admin/db/download:33`) both: validate filename shape (`isValidBackupFilename` / DB-stored UUID filename), `path.resolve` + `startsWith(dir + sep)` containment, `lstat` + `isSymbolicLink()` rejection, and realpath-resolved-path streaming (TOCTOU close). Upload paths use `SAFE_SEGMENT` + `ALLOWED_UPLOAD_DIRS` whitelist + UUID filenames.
- **XSS**: all 8 `dangerouslySetInnerHTML` sites are JSON-LD via `safeJsonLd` (escapes `<`, U+2028, U+2029) — confirmed at page.tsx (home ×2), [topic], c/[slug], p/[id] (×2), timeline, year. OG routes render text into Satori images (no script sink) and additionally `sanitizeForOg` all rendered strings. No user HTML reaches a DOM sink.

### A04 — Insecure Design: CLEAN
- Single-use download CAS (`api/download/[imageId]`): open-file-handle BEFORE the atomic `UPDATE … SET downloadedAt=NOW() WHERE downloadedAt IS NULL`, `affectedRows===0 → 410`, handle closed on every failure path. A missing file never burns the token (validated before claim). GET interstitial is claim-free (mail-scanner safe, RFC-9110 §9.2.1 compliant).
- Login: pre-increment rate limit BEFORE Argon2 (TOCTOU), dummy-hash timing equalization, per-IP + per-account buckets, session-fixation prevention (delete other sessions in a transaction), no rate-limit rollback on infra error (attacker can't farm extra attempts via DB overload).

### A05 — Security Misconfiguration: CLEAN
- `nosniff` global + per-route; `no-store` on all admin/sensitive responses; restrictive CSP on the download interstitial (`default-src 'none'; form-action 'self'`); production CSP nonce per request in `proxy.ts`. Debug not exposed; errors return generic messages (PII never in error bodies — Stripe webhook logs presence flags, not email values, at error level).

### A06 — Vulnerable Components: UNCHANGED
- `npm audit`: build/dev-time advisories only (esbuild via drizzle-kit/tsx, postcss via next) — absent from the prod runtime container. INFO only. The `isSemVerMajor` "fixes" are downgrades — do NOT take them.

### A07 — Auth Failures: CLEAN
- See A02. Password change rotates ALL sessions in a transaction, re-issues one fresh cookie, control-char-strips credentials, code-point length bounds (12–1024), separate rate-limit bucket. `unstable_rethrow` guards Next.js control-flow signals on both login and password-change.

### A08 — Integrity Failures: CLEAN
- Stripe webhook (`api/stripe/webhook:74`): `constructStripeEvent` signature verification is MANDATORY and runs before any DB work; forged/unsigned → 400 in constant time. Idempotency via `sessionId` SELECT + `ON DUPLICATE KEY UPDATE` + `insertId>0` disambiguation (the dup-key loser never logs a dead plaintext token). Gates on `payment_status==='paid'`, zero-amount reject, tier allowlist, deleted-image FK handling (200, no retry storm).

### A09 — Logging Failures: CLEAN
- `logAuditEvent` on login (success/failure), logout, password change, CSV export, DB backup, DB-backup download (with requester IP), PAT use. Customer PII (email) is NOT logged at error level; the `LOG_PLAINTEXT_DOWNLOAD_TOKENS` token-surfacing is opt-in (default OFF), documented-intentional.

### A10 — SSRF: CLEAN
- OG photo fetch (`og-photo-fetch.ts` + `api/og/photo/[id]:103`): `origin = new URL(req.url).origin` (the server's OWN host), path `${origin}/uploads/jpeg/${baseFilename}` where `baseFilename = image.filename_jpeg` (DB-stored UUID-derived, not user input). 10s AbortSignal timeout + 1 MB byte cap (Content-Length pre-check + post-buffer) per attempt. No user-controlled URL, host, or scheme reaches `fetch`. The home/site OG route fetches nothing external.

### Commonly-missed classes — all CLEAN
- **Open redirect**: the only `redirect()` with a variable target (`[topic]/page.tsx:160`) builds `localizePath(validatedLocale, /${topicData.slug})` from the DB canonical slug + length-capped, URLSearchParams-encoded `tags` — always same-origin relative. Login/logout/checkout redirects use validated locale + hardcoded/numeric paths.
- **ReDoS**: every validation regex is linear (character classes, anchored `/^…$/`, no nested quantifiers) — `isValidSlug`, `isValidTagName`, `isWellFormedToken`, `UNICODE_FORMAT_CHARS`, `EMAIL_SHAPE`, etc.
- **Prototype pollution**: smart-collections column lookup uses `Object.prototype.hasOwnProperty.call`; JSON ASTs are structurally re-validated (`validateNode`) with scalar-value enforcement; no merge of user JSON into existing objects.
- **Insecure deserialization**: `JSON.parse` results (semantic-search body, smart-collection query) are shape-validated before use; size-capped (8 KB semantic body); no `eval`/`Function`/dynamic require of untrusted input (the only `child_process` import is the argv-array mysqldump/restore).
- **Timing attacks**: session HMAC and PAT hash both use `timingSafeEqual`; login uses dummy-hash equalization; token-shape regex checks run AFTER crypto verify.
- **Secrets in code**: high-signal sweep found NO hardcoded secrets/keys/tokens; all secrets via `process.env`.
- **Upload content-type / decompression bomb**: per-file 200 MB cap + cumulative window cap + file-count cap; Sharp `limitInputPixels`; RAW rejected; HDR gated on admin setting; GPS stripped on both DB and on-disk original (both browser and LR PAT paths).

## Security Checklist
- [x] No hardcoded secrets
- [x] All inputs validated (code-point-aware length, Unicode-format strip, slug/tag/filename regex, body-size caps)
- [x] Injection prevention verified (parameterized SQL, argv-array spawn, path containment + symlink rejection)
- [x] Authentication / authorization verified (`withAdminAuth` + `requireSameOriginAdmin` lint-gated; Argon2id; timing-safe sessions; PAT scope gate)
- [x] Dependencies audited (build/dev-only advisories; absent from prod runtime; downgrades rejected)
- [x] XSS prevention verified (all JSON-LD via `safeJsonLd`; OG text via `sanitizeForOg`; no user HTML to DOM)
- [x] CSRF verified (same-origin on every mutating action + admin API route, fail-closed)
- [x] SSRF verified (OG fetch own-origin only, DB-filename path, no user URL)
- [x] Sensitive-data exposure verified (`publicSelectFields` PII-strip + `_PrivacySensitiveKeys`/`_SensitiveKeysInPublic` compile-time guards; GPS strip; PII out of error logs)
- [x] Single-use download token CAS verified (open-before-claim, atomic UPDATE, affectedRows gate)
- [x] Stripe signature verification + idempotency verified
