# Security Review Report — GalleryKit (cycle 3, run-8)

**Reviewer:** security-reviewer
**HEAD:** `ada92ba5f28e9ecb743c9a375b14b1c8c7aec774`
**Date:** 2026-06-13
**Scope:** Full OWASP Top 10 + secrets + unsafe-patterns + authn/authz + injection + file-upload + privacy + payment + PAT + DB backup/restore + SSRF/ReDoS, verified against current HEAD.
**Risk Level:** LOW

## Summary

- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low / Defense-in-depth Issues: 2 (SEC-1, SEC-2)
- Informational (audit/dependency): 3 (SEC-3, SEC-4, SEC-5)

GalleryKit is an exceptionally hardened, heavily-reviewed security surface. Every high-value sink I examined already carries layered defenses with explicit test locks and lineage comments. The prior-cycle OG-sanitize symmetry fix (AGG-R8-13, commits `d5399742` / `ada92ba5`) is confirmed landed and NOT regressed. I found **no live-exploitable vulnerability**. The two LOW findings are genuine defense-in-depth observations (one CSP hardening opportunity, one documented operational footgun); the three INFO items are dependency/audit notes. None block.

---

## Verified-Clean Surfaces (high-value sinks, no findings)

These were examined in depth and are correctly implemented — recorded so the next cycle does not re-litigate them:

- **Auth / session (`lib/session.ts`, `lib/password-hashing.ts`, `actions/auth.ts`):** Argon2id (64 MiB / t=3 / p=4, exceeds OWASP); `SESSION_SECRET` env-only in production (throws rather than DB-fallback — correct trust-domain separation); HMAC-SHA256 verified with `timingSafeEqual`; token shape regexes run AFTER crypto verify so they can't be a timing oracle; session token SHA-256-hashed for DB storage (DB leak ≠ usable cookie); timing-safe dummy-hash on login (anti-enumeration); rate-limit pre-increment BEFORE Argon2 verify (TOCTOU-closed); session-fixation prevented via transactional insert+delete-others; cookie `httpOnly`/`secure`(prod or TLS)/`sameSite:lax`.
- **Dual-bucket rate limit (`lib/auth-rate-limit.ts`, `lib/rate-limit.ts`):** per-IP + per-account (`acct:<sha256-prefix>` — no username PII in keys); rollback via decrement (not delete) to survive concurrent rollbacks; bounded maps with eviction; DB-backed source of truth + in-memory fast path.
- **Server-action authz:** all 3 lint gates pass clean at HEAD (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`). Every mutating action verifies `isAdmin()` + `requireSameOriginAdmin()`; `withAdminAuth` now centralizes origin verification (AGG9R-02) so a future admin route can't forget CSRF defense. `request-origin.ts` fails closed by default.
- **Injection:** Drizzle parameterization throughout; raw `sql\`\`` surfaces (admin-tokens, topics, admin-backfill-runner, health) all use parameterized `${}` interpolation, no string concat of untrusted input. CSV escaping (`lib/csv-escape.ts`) strips C0/C1 + Unicode bidi/zero-width + CRLF-collapse + formula-prefix quote with leading-whitespace tolerance. Unicode-format rejection (`lib/validation.ts UNICODE_FORMAT_CHARS`) applied at every admin string write. All 6 JSON-LD `dangerouslySetInnerHTML` sites use `safeJsonLd` (`</script>` + U+2028/2029 escaped). `og-sanitize.ts` uses the GLOBAL-flag strip (replace-all) shared by both OG routes.
- **File upload / path traversal (`lib/serve-upload.ts`, download route, admin db download route):** `SAFE_SEGMENT` + `ALLOWED_UPLOAD_DIRS` + `resolve`/`startsWith` containment + `lstat` symlink rejection + `realpath` re-check + stream-from-realpath (TOCTOU-closed); dir↔extension map prevents cross-serving. Decompression-bomb mitigation via Sharp `limitInputPixels` (in process-image).
- **Privacy (`lib/data.ts`, `lib/gps-exif-strip.ts`):** `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` compile-time guards enforce admin-only fields; `publicSelectFields` is a separate object derived by omission. GPS strip is byte-level container surgery — `withMetadata()` appears ONLY in warning comments, never called (the documented privacy contract holds).
- **Stripe webhook (`api/stripe/webhook/route.ts`):** mandatory `constructEvent` signature verify before any DB work; `payment_status==='paid'` gate; tier allowlist; zero-amount reject; idempotency by SELECT + `sessionId` UNIQUE + `affectedRows && insertId>0` dup-key-loser disambiguation; deleted-image → 200 (no retry storm); no PII at error level.
- **Download route (`api/download/[imageId]/route.ts`):** single-use CAS done right — token-shape regex short-circuit → constant-time hash verify → open-file-BEFORE-claim → atomic `UPDATE … WHERE downloadedAt IS NULL` → 410 on 0-rows; FileHandle leak prevented on every post-open path; GET interstitial is claim-free (mail-scanner safe); ships its own restrictive CSP. Content-Disposition extension sanitized + RFC 5987 encoded.
- **Lightroom PAT (`lib/admin-tokens.ts`, `api/admin/lr/upload/route.ts`):** `gk_<base64url-32B>` tokens, SHA-256-hashed at rest, constant-time `tokenHashesEqual`, scope-gated, fail-closed on missing table, plaintext never in query params. Upload route mirrors browser path incl. GPS strip, HDR gate, upload-tracker quota, contract lock.
- **DB backup/restore (`admin/db-actions.ts`):** `MYSQL_PWD`/`MYSQL_USER` env (no `/proc/cmdline` leak), `HOME` excluded (no `~/.my.cnf`), `sanitizeStderr` redacts password+host+user+db, dangerous-SQL chunk scan + header validation + `--one-database`, advisory lock on dedicated connection, `0o600`/`0o700` modes.
- **Checkout (`api/checkout/[imageId]/route.ts`):** rate-limit pre-increment Pattern-2, tier allowlist, strict `/^\d+$/` price parse, code-point-safe title truncation, only validated `imageId`/`tier` to Stripe metadata, idempotency key.
- **Semantic search (`api/search/semantic/route.ts`):** same-origin + body-size + content-type-prefix + chunked-reject + rate-limit-before-work + fail-closed config gate; stub mode disclaimed.
- **Last-admin lockout (`actions/admin-users.ts`):** advisory lock + transaction + `COUNT(*)<=1` guard; parameterized raw SQL.
- **Refund (`actions/sales.ts`):** `isAdmin()`+`requireSameOriginAdmin()`, `Number.isFinite && >0` id validation, Stripe idempotency key. No IDOR (admin is fully trusted; no role model by design).
- **SSRF / ReDoS:** the only dynamic `fetch()` (`lib/og-photo-fetch.ts`) targets `new URL(req.url).origin` (own origin, not attacker-controlled host) + server-generated UUID filename + fixed `/uploads/jpeg/` path + 10 s timeout + 1 MB cap → not SSRF. No catastrophic-backtracking regex patterns found; `XMP_GPS_TOKEN`, `isValidTopicAlias`, `EMAIL_SHAPE`, session-token shape regexes are all linear.
- **Weak randomness:** none. Share keys/UUIDs/tokens use `crypto.randomBytes`/`randomUUID`; zero `Math.random` in security-relevant code.

---

## Findings

### SEC-1. Production CSP uses `style-src 'unsafe-inline'` (and `img-src` includes `data:`/`blob:`)
**Severity:** LOW (defense-in-depth)
**Category:** A05 Security Misconfiguration
**Location:** `apps/web/src/lib/content-security-policy.ts:108` (`"style-src 'self' 'unsafe-inline'"`), `:29` (`img-src ... 'data:' 'blob:'`)
**Exploitability:** Not independently exploitable. `script-src` is correctly nonce-gated (`'nonce-…' 'self'`, no `unsafe-inline`/`unsafe-eval` in prod), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, `form-action 'self'` are all present. The residual `style-src 'unsafe-inline'` only widens the CSS-injection surface (e.g. a stored-CSS gadget could exfil via background-image requests to an `img-src`-allowed origin), but the app already blocks Unicode-format/control injection at every admin string sink and there is no untrusted-HTML render path, so there is no known vector to plant inline styles. This is purely a "tighten the net" item.
**Blast radius:** If a future feature ever introduced an untrusted HTML/style sink, `'unsafe-inline'` styles + `data:`/`blob:` images would soften the CSP's ability to contain it. No current exposure.
**Why it persists:** Tailwind/Radix/shadcn and `next/og` previews lean on inline styles; nonce-based `style-src` requires threading the nonce through every styled-jsx/inline-style site, which is a non-trivial refactor. This is a common, accepted tradeoff.
**Fix (optional, low priority):** Track migrating to nonce/hash-based `style-src` if/when a styling refactor makes it cheap. Document the `'unsafe-inline'` style decision explicitly alongside the existing CSP comments so it is a conscious, reviewed choice rather than an unaudited default. No code change required this cycle.
```ts
// Aspirational target (only when inline-style sites are eliminated):
// "style-src 'self' 'nonce-<nonce>'",
```

### SEC-2. `LOG_PLAINTEXT_DOWNLOAD_TOKENS` emits a live single-use credential to stdout
**Severity:** LOW (operational footgun; already documented + opt-in)
**Category:** A09 Security Logging Failures / A02 Cryptographic Failures (secret-at-rest-in-logs)
**Location:** `apps/web/src/app/api/stripe/webhook/route.ts:437-449`
**Exploitability:** Opt-in only (`process.env.LOG_PLAINTEXT_DOWNLOAD_TOKENS === 'true'`, off by default), and the token is single-use + 24 h-expiring. The hazard is operational: when enabled, the plaintext `dl_…` download token lands in stdout → any log shipper / `docker logs` reader with log access can claim the paid asset before the customer. The README documents this as the manual-distribution scaffold until the email pipeline ships, and the code already strips the token hash from the structured audit line — so this is a known, bounded scaffold, not a defect.
**Blast radius:** Anyone with log-read access in a deployment that flipped the flag can download the purchased original once (consuming the customer's single use). Confined to log-access holders; default deployments are unaffected.
**Fix:** No change required — flagging for completeness so the next cycle keeps it on the radar. When the email pipeline (US-P54-phase2) ships, delete this stdout branch entirely rather than leaving it as a permanent opt-in. Until then, the existing README warning + default-off posture is adequate.

### SEC-3. Stripe `async_payment_succeeded` gap — ALREADY-OWNED (confirmed, not new)
**Severity:** INFO (owned by plan-316 CRT-R5C1-04)
**Category:** A04 Insecure Design (coverage gap, not a vuln)
**Location:** `apps/web/src/app/api/stripe/webhook/route.ts:91-118`
**Status:** Confirmed present and correctly handled in the safe direction: delayed-payment methods (ACH/bank transfer) land `payment_status==='unpaid'` on `checkout.session.completed` and are REJECTED (no entitlement minted, `console.warn` not `console.error`). The only impact is that a customer who pays via a delayed method never receives an entitlement until the missing `async_payment_succeeded` handler ships. This is documented in CLAUDE.md and owned by plan-316. **Not re-reported as new.** No fail-open exposure (the gap denies access, never grants it).

### SEC-4. Dependency audit — all advisories build/dev-only, NOT prod-runtime-reachable
**Severity:** INFO
**Category:** A06 Vulnerable Components
**Command:** `npm audit --workspace=apps/web` → 5 vulns (3 high, 2 moderate, 0 critical)
**Detail:**
- `esbuild` GHSA-gv7w-rqvm-qjhr (high, CVSS 8.1) — reachable only via `drizzle-kit` and `tsx`, both **devDependencies** used for migrations/scripts at build/CI time. The advisory is a dev-server request-forwarding issue; esbuild's dev server is never run in production. NOT in the prod-deps runtime tree (Dockerfile `prod-deps` stage excludes them).
- `drizzle-kit` (high) / `tsx` (high) — same esbuild transitive; dev/CI only.
- `postcss` GHSA-qx2v-qp2m-jg93 (moderate, XSS via `</style>` in stringify) → via `next` — PostCSS runs at **build time** (Tailwind compilation), not on runtime request paths; the CSS it emits is the app's own authored CSS, no untrusted input. NOT runtime-reachable.
- `next` (moderate) — transitive of the postcss build-time issue; the fix is a major downgrade (`next@9.3.3`), inappropriate. The repo is intentionally on latest Next 16.
**Action:** None required for production security. Optionally bump `tsx` (a non-major fix is available per the audit) to clear the dev-tree noise. Do NOT take the `isSemVerMajor` "fixes" (drizzle-kit 0.19.1 / next 9.3.3) — they are downgrades.

### SEC-5. `style-src`/`img-src` breadth is the only CSP residue; everything else is tight — recorded as INFO baseline
**Severity:** INFO
**Category:** A05
**Note:** Documented here so the CSP posture is captured as a baseline: script execution is nonce-gated with no `unsafe-eval`/`unsafe-inline` in production, GA hosts are wildcard-LHS-allowlisted per Google's documented contract (not advertising hosts), and `IMAGE_BASE_URL` is validated (https-in-prod, no credentials/query/hash). The interstitial and OG routes ship their own restrictive per-response CSPs since `/api` is excluded from the middleware matcher. This is a strong CSP; SEC-1 is the only tightening lever.

---

## Security Checklist

- [x] No hardcoded secrets (grep clean; secrets via env; opt-in token logging documented — SEC-2)
- [x] All inputs validated (Unicode-format reject, code-point length caps, strict integer parses, body-size guards)
- [x] Injection prevention verified (Drizzle params, parameterized raw SQL, CSV escape, JSON-LD escape, no eval/Function/dynamic exec of untrusted input)
- [x] Authentication/authorization verified (Argon2id, timing-safe, dual-bucket rate limit, 3 lint gates pass, withAdminAuth central origin check, last-admin lockout)
- [x] CSRF/same-origin enforced on all mutating actions + admin API routes (fail-closed)
- [x] File-upload path traversal + symlink + TOCTOU + decompression-bomb defenses verified
- [x] Privacy guards (GPS byte-strip never via withMetadata; compile-time public-field guards) verified
- [x] Payment flow (webhook signature, single-use CAS, idempotency, refund authz) verified
- [x] SSRF (own-origin-only fetch) and ReDoS (no catastrophic regex) cleared
- [x] Dependencies audited (SEC-4 — all advisories dev/build-only, none prod-runtime-reachable)

## Prior-cycle regression check
- AGG-R8-13 (shared `sanitizeForOg` across both OG routes): **CONFIRMED LANDED, NOT REGRESSED.** `lib/og-sanitize.ts` exports the shared sanitizer using the GLOBAL-flag `stripUnicodeFormatting` + C0-control strip; both `api/og/route.tsx` and `api/og/photo/[id]/route.tsx` import it. Contract test `ada92ba5` pins the global-strip behavior.
