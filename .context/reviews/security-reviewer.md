# Security Review — GalleryKit (deep fan-out, run-8 cycle-2)

**Reviewer:** security-reviewer (read-only agent — Write disabled in-session; this file persisted by the orchestrator for provenance, content verbatim from the agent's returned report)
**Date:** 2026-06-13 · **HEAD:** `77867144` · **Risk level: LOW**
**Scope:** OWASP Top 10 across 10 API routes, 14 server actions, auth/session/rate-limit libs, validation/sanitize, data-privacy guards, db-actions. Full inventory (NOT sampled) — every untrusted-input path traced entry→sink. All 3 security lint gates re-run live (all exit 0).

## Summary
- Critical: 0 · High: 0 · Medium: 0 · Low (informational): 1 (SEC-1)

## Prior findings VERIFIED CLOSED / CLEAN at HEAD (hand-traced, NOT re-reported)
EXIF Unicode strip both halves (`validation.ts:82-95`, `/g`-flag); `sanitizeForOg` global strip both sites (`og/photo/[id]/route.tsx:36`, commit `170297ed`); session crypto (`session.ts:110-124`, length pre-check + `timingSafeEqual` + shape-assert-after-crypto, no oracle); smart-collections allowlist (`smart-collections.ts:18-47`); JSON-LD `</script>` escaping (all 8 sites via `safeJsonLd`); path-traversal/symlink containment on all 3 fs routes (download/backup/serve-upload — startsWith + lstat + realpath, streams from opened handle); byte-level GPS strip (`lr/upload:311-327`, no Sharp `withMetadata()`); all 3 lint-gate invariants. **Stripe `async_payment_succeeded` (AGG-R7-13): ALREADY-OWNED by plan-316; webhook correctly gates `payment_status==='paid'` and mints no false entitlement — no NEW Stripe issue.**

## Surfaces additionally hand-verified clean this cycle
- **Auth/authz:** `login` dual-bucket pre-increment TOCTOU + constant-time dummy hash + session-fixation transaction; `withAdminAuth` token-first/origin/isAdmin layering; PAT verify (well-formed→hash-lookup→constant-time→expiry, fails closed); `proxy.ts` cookie format gate, `/api/*` correctly excluded.
- **Injection:** Drizzle params throughout; LIKE escapes `%`/`_`/`\` (`data.ts:1388`); raw SQL only via tagged-template binding (`admin-tokens.ts`); `spawn` array-form + `MYSQL_PWD` via env (not argv) + `HOME` excluded + `--one-database`.
- **SSRF/open-redirect:** `validateSeoOgImageUrl` same-origin + non-http(s) reject + `\`-backslash-bypass closed (SEC-R4C20-01); OG internal fetch own-origin + 10s timeout + byte caps + charged-404 (no enumeration oracle).
- **Rate-limiting:** `getClientIp` TRUST_PROXY-gated + hop-count parse (XFF spoof closed); semantic body-size/chunked/content-type guards + pre-increment-before-config-read; all maps bounded.
- **File-upload:** basename + traversal + symlink + per-file/cumulative size + pixel + HDR-gate + GPS byte-strip + advisory locks + idempotent settle; DB restore header-validate + dangerous-SQL scan + stderr credential redaction.
- **Crypto/secrets:** Argon2id > OWASP; SESSION_SECRET prod-required (DB fallback refused); no hardcoded secrets; plaintext token only behind opt-in flag.
- **PII:** compile-time `_privacyGuard`/`_mapPrivacyGuard` (`data.ts:416-432`); public selects omit lat/long/filename_original/user_filename + admin-only color/HDR cols; lat/long only via map-visible-gated select; `listEntitlements` customerEmail is `isAdmin()`-gated.
- **ReDoS / TOCTOU / header-injection / timing:** all fixed-count quantifiers (no catastrophic backtracking); download claims file before atomic single-use UPDATE; Content-Disposition sanitized + RFC 5987 encoded. None open.

## OPEN/NEW findings

### SEC-1 — `/api/og` home route omits `sanitizeForOg` on `siteTitle` — LOW / Confidence Low / OWASP A03 (defense-in-depth only)
- **Location:** `apps/web/src/app/api/og/route.tsx:77` — `const siteTitle = seo.title || siteConfig.title;` (raw). The sibling per-photo route `apps/web/src/app/api/og/photo/[id]/route.tsx:98` wraps the equivalent value in `sanitizeForOg(...)`.
- **Not exploitable today (3 reasons):** (1) `seo.title` is admin-controlled and `containsUnicodeFormatting`-rejected at write time; (2) `topicLabel`/tags pass `isValidTopicAlias`/`isValidTagName` which reject `<>"'&\x00` + formatting chars; (3) output is a JPEG/PNG rendered by Satori, which treats children as auto-escaped text nodes — no script/`</script>` sink in an image response.
- **Exploit scenario:** none with current validation. Only a future regression (loosened SEO validator, or a non-admin string routed here) would let bidi/C0 chars render in the home card while the per-photo route still strips them — the exact symmetric-defense gap AGG-4 closed for the per-photo + JSON-LD path.
- **Fix:** mirror the per-photo route — wrap `siteTitle`/`topicLabel`/tag entries in `sanitizeForOg`; ideally extract a shared `lib/og-sanitize.ts` so both routes share one source of truth (matches the repo's "derive, don't copy" discipline for `UNICODE_FORMAT_CHARS`). If scheduled, pin with a fixture asserting both OG routes strip a bidi-laden `seo.title`.
- **Disposition:** optional LOW hardening; legitimately deferrable as it is non-exploitable hygiene, not a live vulnerability. Scheduled as plan-333 Item 10 (optional) / recorded in plan-334 Deferred 5.

## Security Checklist
- [x] No hardcoded secrets · [x] All inputs validated (code-point-aware, formatting-char-rejecting) · [x] Injection prevention (params/LIKE-escape/spawn-array+env) · [x] Auth/authz verified (lint gates green) · [x] Dependencies audited (3 HIGH esbuild + 2 MOD postcss — build/dev-time only, absent from prod runtime; INFO, unchanged) · [x] PII disclosure (compile-time guards) · [x] SSRF/open-redirect closed · [x] Crypto (Argon2id, HMAC, SESSION_SECRET prod-required) · [x] CSRF/same-origin (fail-closed, enforced centrally) · [x] Rate-limiting (bounded + TOCTOU-safe) · [x] File-upload security

**Verdict:** 0 Critical / 0 High / 0 Medium at HEAD. Only OPEN item is SEC-1 (LOW / Low confidence) — non-exploitable defense-in-depth consistency gap. All prior run-7 security findings re-verified CLEAN; Stripe ACH gap remains correctly ALREADY-OWNED by plan-316.
