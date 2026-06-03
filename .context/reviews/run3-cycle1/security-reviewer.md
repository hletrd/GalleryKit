# Security-Reviewer Review — Run-3 Cycle 1 (HEAD 2508f132)

Date: 2026-06-04
Method: direct orchestrator review (Task fan-out unavailable; see
test-engineer.md preamble).

## Findings

No net-new CRIT/HIGH security findings. One MEDIUM with a security flavor
(shared with code-reviewer F2):

### F2 (security angle) — `allow_hdr_ingest=false` not enforced on the PAT upload path — MEDIUM

`/api/admin/lr/upload/route.ts` honors the admin-set `stripGpsOnUpload` but not
`allowHdrIngest`. Treat this as a defense-in-depth / admin-intent gap rather
than an exploitable vuln: the route is authenticated (PAT with `lr:upload`
scope, constant-time hash verify) and the accepted HDR source is still encoded
SDR with admin-only HDR columns, so no public exposure. See code-reviewer.md F2
for the full writeup and fix. Logged here for cross-angle agreement (2 angles).

## OWASP-style sweep (re-verified clean)

- **A01 Broken Access Control:** `withAdminAuth` enforces token-scope OR
  (same-origin + `isAdmin()`); token path correctly bypasses same-origin only.
  `lint:api-auth` + `lint:action-origin` gates pass. Privacy field separation
  triple-enforced (`_PrivacySensitiveKeys` compile guard + symmetric runtime
  test + `_omit` blocks).
- **A02 Crypto:** Argon2 password hashing; HMAC-SHA256 sessions w/
  `timingSafeEqual`; download + admin tokens hashed (SHA-256) with constant-time
  hex compare and shape pre-validation. `admin-tokens.ts` `tokenHashesEqual`
  rejects non-hex / length-mismatch before `timingSafeEqual`.
- **A03 Injection:** Drizzle parameterization throughout; `smart-collections.ts`
  uses a column allowlist + bound params + depth limit; CSV/admin-string
  Unicode-bidi + zero-width stripping in place.
- **A05 Misconfig:** `runtime = 'nodejs'` pinned on webhook/checkout/download/LR
  routes; `no-store` + `nosniff` headers on all sensitive routes.
- **A07 AuthN failures:** Per-IP + per-account login rate limiting (bounded
  Maps, oldest-entry eviction); webhook signature mandatory + constant-time 400.
- **A08 Data integrity:** Stripe webhook gates on `payment_status==='paid'` +
  zero-amount reject + tier allowlist + sessionId idempotency; entitlement
  download is single-use via atomic `UPDATE … WHERE downloadedAt IS NULL`.
- **A09 Logging:** PII (customer email) kept out of error-level logs; structured
  log shapes with correlation keys; LR audit-log failure at `console.warn`.
- **Path traversal:** `serve-upload.ts` + `download/[imageId]` both use
  `SAFE_SEGMENT` / `startsWith(root + sep)` / `lstat` symlink reject + realpath
  TOCTOU close. Clean.

No secrets committed; `.env.deploy` / `.env.local` gitignored.
