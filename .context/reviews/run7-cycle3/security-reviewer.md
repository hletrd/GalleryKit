# Security Review Report — Run-7 Cycle-3

**Agent:** security-reviewer
**HEAD:** `c6eff919` (master)
**Date:** 2026-06-19
**Scope:** OWASP Top 10, secrets, unsafe patterns, auth/authz, injection, SSRF, path traversal, PII leakage, rate-limit bypass, CSRF/same-origin, session security, Stripe webhook signature, file-upload security.
**Risk Level:** LOW

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- **New actionable findings: NONE.** Third consecutive zero-finding security pass (cycle-1, cycle-2, cycle-3). A truthful zero.

This is a mature, security-hardened codebase whose entire attack surface has been re-read at HEAD `c6eff919`. Every gate, guard, and trust boundary was verified against the actual code (not just the lint scripts). The delta from cycle-2 HEAD (`1cdbb883`) is two scheduled fixes (an admin-only color-audit-label correction + a GPS-toggle source-contract test) plus review docs — **no new API route, no new server action, no new attack surface.**

---

## Methodology — full inventory examined (not a sample)

**All 11 API routes read in full:**
- `api/stripe/webhook/route.ts` — money/entitlement webhook
- `api/checkout/[imageId]/route.ts` — Stripe session creation
- `api/download/[imageId]/route.ts` — paid-download byte streaming
- `api/admin/db/download/route.ts` — authenticated backup download
- `api/admin/lr/upload/route.ts` — Lightroom PAT cross-origin upload
- `api/search/semantic/route.ts` — public semantic search
- `api/search/similar/[id]/route.ts` — public image-to-image search
- `api/og/route.tsx`, `api/og/photo/[id]/route.tsx` — Satori OG cards (rate-limit Pattern 4 verified via lint)
- `api/health/route.ts`, `api/live/route.ts` — probes (no mutating handlers)

**Auth / session / crypto libs read in full:** `lib/api-auth.ts`, `app/actions/auth.ts`, `lib/session.ts`, `lib/request-origin.ts`, `lib/admin-tokens.ts`, `lib/download-tokens.ts`, `proxy.ts`.

**Input / privacy libs read in full:** `lib/validation.ts`, `lib/sanitize.ts`, `lib/og-sanitize.ts`, `lib/safe-json-ld.ts`, `lib/smart-collections.ts`, `lib/data.ts` (PII guard block), `lib/rate-limit.ts` (`getClientIp` + budgets), `app/[locale]/admin/db-actions.ts` (restore path), `lib/gps-exif-strip.ts` (ISOBMFF iloc walker).

**Static scans run:** secrets (source + whole-repo tracked), raw-SQL/`sql.raw`/concatenation, `dangerouslySetInnerHTML` sinks, tracked env files, git delta cycle-2→HEAD.

---

## OWASP Top 10 — per-category disposition

| # | Category | Disposition |
|---|---|---|
| A01 | Broken Access Control | **PASS.** `proxy.ts` is an intentional format-gate; the real trust boundary is `verifySessionToken()` + per-action `isAdmin()` + `withAdminAuth`. Both admin routes wrap `withAdminAuth`. Every mutating server action returns early on `requireSameOriginAdmin()` (lint:action-origin green). `getMapImages` enforces `map_visible=true` at query level AND a runtime row-level GPS-leak assertion (throws on any leaked row, data.ts). Last-admin-deletion lockout prevented. |
| A02 | Cryptographic Failures | **PASS.** Argon2id (64 MiB / t=3 / p=4, exceeds OWASP). HMAC-SHA256 sessions with `timingSafeEqual`. Download/PAT tokens: 256-bit random, SHA-256 hash-at-rest, constant-time verify on both sides. `SESSION_SECRET` mandatory in prod (refuses DB fallback to keep signing key out of the user-data trust domain). |
| A03 | Injection | **PASS.** No `sql.raw`, no string concatenation into SQL. All raw `db.execute(sql\`…\`)` use Drizzle parameter binding (`${}`). smart-collections resolves columns via `ALLOWED_COLUMNS[]` allowlist and binds all values; LIKE wildcards escaped; depth/IN caps. CSV formula-injection + bidi/zero-width stripping intact. JSON-LD via `safeJsonLd` (`<`→`<`). XSS: every `dangerouslySetInnerHTML` is escaped JSON-LD with CSP nonce. |
| A04 | Insecure Design | **PASS.** Single-writer topology documented; advisory locks serialize restore/backfill/upload-contract/image-claim. Money flow has open-before-claim ordering, idempotency, FK-race handling. |
| A05 | Security Misconfiguration | **PASS.** Production CSP with per-request nonce (proxy.ts). `X-Content-Type-Options: nosniff` global + per-route. `no-store` on all admin/money responses. Download interstitial ships its own `default-src 'none'` CSP. |
| A06 | Vulnerable Components | **PASS (documented).** `npm audit --omit=dev`: 0 critical / 0 high / **2 moderate** (postcss `<8.5.10` GHSA-qx2v-qp2m-jg93, reachable only as a transitive of `next`). Documented false-positive per directive — NOT raised. |
| A07 | Identification & Auth Failures | **PASS.** Dual-bucket rate limiting (per-IP + per-account `acct:` hash) with DB backup + TOCTOU-safe pre-increment. Timing-equalized user enumeration (dummy Argon2 hash). Session fixation prevented (transactional insert-then-delete). Full session rotation on password change. Code-point-aware password length (12–1024). `unstable_rethrow` for Next control-flow signals. |
| A08 | Software & Data Integrity | **PASS.** Stripe webhook signature MANDATORY (`constructStripeEvent`), 400 in constant time before DB work. DB restore validates SQL-dump header + full-file dangerous-SQL scan + `--one-database`. `safeInsertId` guards BigInt overflow. |
| A09 | Logging & Monitoring Failures | **PASS.** `sanitizeStderr` redacts password/host/user/db before logging mysqldump/restore stderr. Webhook/checkout/download drop PII (email, token-hash) from structured logs; presence-flags only. Audit events on login/logout/password-change/restore/backup-download/lr-upload. |
| A10 | SSRF | **PASS.** No user-controlled outbound fetch. Stripe SDK targets Stripe only. CLIP weights load OFFLINE (`allowRemoteModels=false`). og-photo SSRF disproved in cycle-2 — confirmed unchanged (on-disk buffer fallback, no fetch). |

---

## Lint-gate invariants — verified against ACTUAL CODE (not just script exit)

1. **lint:api-auth** — exit 0. Only 2 admin routes exist (`api/admin/db/download`, `api/admin/lr/upload`); BOTH use the direct variable-export `export const GET/POST = withAdminAuth(...)` form. Manually confirmed by reading both files.
2. **lint:action-origin** — exit 0. Every mutating export across `actions/` + `db-actions.ts` stores and early-returns on `requireSameOriginAdmin()` (or carries `@action-origin-exempt`). `auth.ts`/`public.ts` excluded by name (own same-origin handling — verified `login`/`updatePassword`/`logout` each call `hasTrustedSameOrigin` and fail closed).
3. **lint:public-route-rate-limit** — exit 0. checkout + semantic use `preIncrement*` helpers; download + webhook carry `@public-no-rate-limit-required` with cryptographic-gate justification (token shape / Stripe signature). similar-search shares the semantic budget. OG routes verified (Pattern 4). Manually confirmed rate-limit calls present in each route body.
4. **_PrivacySensitiveKeys / _SensitiveKeysInPublic** (data.ts:416-420) — INTACT. `publicSelectFields` derived from `adminSelectFields` by explicit omission; THREE compile-time guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`) + the symmetric `privacy-fields.test.ts` SENSITIVE_KEYS fixture. `publicMapSelectFields` is the only lat/long-exposing shape and is query-gated on `map_visible` + runtime-asserted.

---

## High-confidence non-findings (adversarially probed, confirmed clean at HEAD)

- **IP-spoof rate-limit bypass** — `getClientIp` (rate-limit.ts) trusts XFF ONLY when `TRUST_PROXY=true`, selects the client slot before the trusted-hop suffix (NOT attacker-controlled left-most), caps XFF at 512 chars, validates each hop via `normalizeIp`, and fails to a shared `'unknown'` bucket (fail-CLOSED — all share one budget; loud `[SECURITY]` warning) when proxy headers present but TRUST_PROXY unset. Correct posture.
- **CSRF / same-origin** — `hasTrustedSameOrigin` fails closed by default (requires Origin or Referer match); TRUST_PROXY-gated forwarded headers use right-most trusted hop; default ports stripped to match browser Origin. PAT path intentionally bypasses same-origin (cross-origin is the point of PATs) but requires a valid scoped token.
- **Stripe webhook** — signature mandatory; idempotency via SELECT-then-INSERT + ON DUPLICATE KEY with insertId-disambiguated fresh-vs-loser detection; tier allowlist (`isPaidLicenseTier`); zero-amount rejection; email shape + oversize (255) rejection; deleted-image FK race → 200 + manual-refund log (no Stripe retry storm).
- **Download single-use** — token shape gate → hash → entitlement lookup → constant-time verify → expiry/refunded/single-use → path containment (`startsWith` + `realpath`) → symlink rejection (`lstat`) → open-BEFORE-atomic-claim ordering (missing file never burns token). Content-Disposition extension sanitized + RFC 6266/5987 encoded.
- **LR PAT upload** — token re-verified for audit attribution; filename sanitized (`getSafeUserFilename`); slug validated; title/desc via `sanitizeAdminString` (bidi/zero-width reject); code-point length caps; HDR gate; GPS strip; restore-maintenance entry+late guards; upload-tracker TOCTOU-safe pre-claim with idempotent settle; contract lock; FK-race cleanup.
- **DB backup download** — `isValidBackupFilename` + path containment + `realpath` symlink rejection + stream-from-resolved-path (closes TOCTOU). Backups dir is deployment-fixed (`process.cwd()/data/backups`), not user-influenced.
- **smart-collections query compiler** — `ALLOWED_COLUMNS` allowlist (no dynamic column to SQL), Drizzle-bound values, per-column operator narrowing (tag→eq/contains only), MAX_DEPTH=4, MAX_IN_VALUES cap, LIKE-wildcard escaping, JSON.parse wrapped. (Re-confirms cycle-2 REJ-CR-C.)
- **Secrets** — zero hardcoded secrets in source or tracked repo; only `.example` env files tracked; no real `.env.local`/`.env.deploy` committed.

---

## Explicitly NOT re-filed (per directive — no new evidence)

- **RES-R7C2-01 (HEIC anomaly GPS-strip fall-through)** — RE-CONFIRMED AS UNCHANGED RESIDUAL, NOT escalated. `gps-exif-strip.ts` returns `null` on `constructionMethod !== 0` / `ilocVersion > 2`; `process-image.ts` then logs + returns without stripping (prebuilt Sharp can't re-encode HEVC). I could NOT empirically prove the anomalous branch fires on real iPhone HEIC (no HEVC-capable Sharp + no iPhone fixtures on the review host), so per the explicit directive I do NOT escalate. Reachability remains the open unknown; the zero-cost confirming probes in `deferred.md` (real iPhone .heic fixtures through `stripGpsFromIsobmffBuffer`; production-log grep for the error string) are the correct next step before any fix.
- **MED-R7C2-01 (histogram clip math)** — REFUTED 3-way in cycle-2; not re-litigated.
- **og-photo SSRF / middleware non-crypto cookie / smart-collections injection** — all disproved in prior cycles; re-confirmed clean at HEAD with no new evidence to re-open.

---

## Security Checklist
- [x] No hardcoded secrets (source + whole-repo tracked scan clean)
- [x] All inputs validated (slug/filename/Unicode-format/code-point length/token shape)
- [x] Injection prevention verified (no sql.raw, no concatenation, Drizzle binding, allowlist columns)
- [x] Authentication/authorization verified (Argon2id, HMAC sessions, withAdminAuth, isAdmin defense-in-depth, same-origin)
- [x] Dependencies audited (npm audit --omit=dev: 0 crit / 0 high / 2 moderate documented postcss FP)
- [x] CSRF / same-origin (fail-closed hasTrustedSameOrigin; centralized in withAdminAuth + per-action)
- [x] PII leakage guarded (3 compile-time guards + runtime GPS assertion + privacy-fields test)
- [x] Rate-limit bypass (TRUST_PROXY-gated getClientIp, fail-closed, dual-bucket login)
- [x] Stripe webhook signature mandatory; idempotent; FK-race safe
- [x] File-upload security (path containment, symlink rejection, UUID names, decompression-bomb cap, dir allowlist)
- [x] Session security (fixation prevented, rotation on pw change, hashed-at-rest, prod secret mandatory)
- [x] XSS sinks (all dangerouslySetInnerHTML = escaped JSON-LD + CSP nonce; safeJsonLd escapes script breakout)

---

## Verdict

**No new actionable security findings.** The full attack surface was examined at HEAD `c6eff919` and is clean. All 4 blocking lint-gate invariants hold against the actual code. `npm audit --omit=dev`: 0 critical / 0 high / 2 moderate (documented postcss false-positive). The HEIC GPS residual (RES-R7C2-01) remains an unverified-reachability residual, correctly NOT escalated absent empirical proof.

**Overall risk: LOW.**
