# Security Review — GalleryKit (Cycle 22)

**Date:** 2026-06-29 · **HEAD:** 6ef2495d · **Reviewer:** security-reviewer
**Risk Level: LOW.** Critical 0 · High 0 · Medium 0 · Low 0 (new) · Info 1 (new, non-exploitable).

`npm audit --omit=dev` → **0 vulnerabilities**. `npm run typecheck` (typecheck:app + typecheck:scripts) exit 0 — every privacy / search-enrichment / smart-collection / map compile-guard HOLDS at HEAD. `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit` all exit 0. No hardcoded secrets; no real `.env*` tracked in git.

## Summary
- Critical: 0 · High: 0 · Medium: 0 · Low (new this cycle): 0
- One INFO (new, verified non-exploitable): semantic scan-limit env parse has no upper clamp — operator-env only, no attacker lever.
- Three prior-cycle defense-in-depth items (SEC-19-01, SEC-19-02, SEC-20-INFO) re-confirmed UNCHANGED / not materially worse — not re-raised per loop rules. SEC-19-02 is in fact better-fenced than the cycle-21 note implied (see below).

**Verdict:** This is the 22nd consecutive security-focused cycle on an exceptionally hardened codebase. The only security-relevant code delta since cycle-21 is the `SEMANTIC_SCAN_LIMIT` / `SEMANTIC_TOP_K_MAX` env-wiring (commit `fbd94da2`); it is CORRECT and opens no new hole. No confirmed-exploitable NEW vulnerability was found across the full OWASP Top 10 sweep. Method: examined EVERY api route (8) and EVERY server action (13) — not sampled — plus all shared auth/rate-limit/validation/SQL-compiler/privacy libs.

---

## New finding (Informational — verified non-exploitable)

### SEC-22-INFO — `envPositiveInt` for `SEMANTIC_SCAN_LIMIT` has a lower bound but no upper clamp
**Category:** A04 Insecure Design (defense-in-depth). **Severity:** INFO. **Confidence:** High (non-exploitable).
**Location:** `apps/web/src/lib/clip-embeddings.ts:24-31` (added `fbd94da2`).
```ts
function envPositiveInt(raw: string | undefined, fallback: number): number {
    const n = Number(raw ?? '');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;  // no MAX clamp
}
export const SEMANTIC_TOP_K_MAX = envPositiveInt(process.env.SEMANTIC_TOP_K_MAX, 50);
export const SEMANTIC_SCAN_LIMIT = envPositiveInt(process.env.SEMANTIC_SCAN_LIMIT, 2000);
```
`SEMANTIC_SCAN_LIMIT` is the DoS cap on the brute-force embedding scan in both search routes (`api/search/semantic`, `api/search/similar/[id]`). The parse guards NaN / Infinity / ≤0 → default, but a finite positive value of any magnitude (e.g. `SEMANTIC_SCAN_LIMIT=100000000`) is accepted verbatim, which would make the per-request scan unbounded.
**Why non-exploitable:** the value comes exclusively from `process.env` set at deploy time. It is NOT a `NEXT_PUBLIC_*` var (undefined in the client bundle → fallback applies), and there is no request-path, header, body, or admin-settings surface that can influence it. An attacker has **zero** lever to set or raise it; an operator setting a pathological value is self-inflicted misconfiguration, not a vulnerability. The per-IP semantic rate limit (30/min) + the nginx edge throttle remain the request-rate controls regardless.
**Optional hardening (not required):** clamp to a sane ceiling, e.g. `Math.min(Math.floor(n), 100_000)`, so a fat-fingered env can't silently turn the scan into an O(N·512) CPU sink. Pure operational belt-and-braces.

---

## Carried-over (prior-cycle defense-in-depth — status re-confirmed, NOT re-raised)

- **SEC-19-01** — per-IP rate-limit buckets key the full IP; an IPv6 /64 rotation gets a fresh budget per address. `lib/rate-limit.ts:112-130,152-183`. **Unchanged this cycle.** Mitigations in place: the account-scoped login bucket (`acct:<sha256>` — distributed brute-force against one username is throttled regardless of source IP), per-request hard caps (`SEMANTIC_SCAN_LIMIT`/`SEMANTIC_TOP_K_MAX`), and the nginx `limit_req zone=admin/login` edge throttle. Defense-in-depth LOW; not worse.

- **SEC-19-02** — token-auth `verifyToken` performs a DB lookup that is not application-rate-limited before the query. `lib/api-auth.ts:63-89` → `lib/admin-tokens.ts:136-166`. **Unchanged this cycle, and better-fenced than the cycle-21 note implied:** `isWellFormedToken` rejects malformed input at **zero DB cost** (length + prefix + base64url charset), a well-formed guess needs 256 bits of entropy, the hash lookup is an O(1) indexed point read, AND — re-verified this cycle — the deployed nginx config applies `limit_req zone=admin burst=10` (30 r/m/IP) to the dedicated `^~ /api/admin/lr/upload` location (`apps/web/nginx/default.conf:131-134`), so the token-verify path is edge-throttled, not bypassed by the longest-prefix body-size location. Marginal LOW; not worse.

- **SEC-20-INFO** — ISOBMFF GPS-strip `walkAborted` re-encode fallback fires only on the zero-items branch. `lib/gps-exif-strip.ts:461-465`. **Byte-unchanged this cycle** (no `gps-exif-strip.ts` commit since cycle-20's `c9746ea3`, which was itself the items-found-path honor fix). Verified non-exploitable last cycle; status holds.

---

## Confirmed-clean (verified this cycle, full re-walk)

**A01 Broken Access Control / CSRF — centralized & lint-enforced.** `withAdminAuth` (`lib/api-auth.ts`) enforces `hasTrustedSameOrigin` → `isAdmin()` for the cookie path; the token path runs first and bypasses same-origin BY DESIGN (PAT integration) but requires a valid `tokenHasScope` match. Both `api/admin/**` routes (`db/download`, `lr/upload`) use the direct `export const = withAdminAuth(...)` form (lint:api-auth green; no function-decl / aliased-export evasion). All 13 server actions store and return-early on `requireSameOriginAdmin()` (lint:action-origin green; `auth.ts`/`public.ts` excluded by name; `lr-tokens.ts` spot-verified). `proxy.ts` middleware redirects unauth admin sub-routes (presence + 3-segment format, ≥100 chars) with cryptographic validation deferred to actions (defense in depth). Last-admin deletion guarded by the table-wide `gallerykit_admin_delete` advisory lock + `COUNT(*) <= 1` → `cannotDeleteLastAdmin` (`actions/admin-users.ts:216-279`). Token revoke is scoped `WHERE id = ? AND user_id = ?`.

**A01 Privacy split — HOLDS (tsc exit 0).** `lib/data.ts`: `adminSelectFields` (full, incl. lat/long/filename_original/user_filename/HDR internals) → `publicSelectFields` (separate object, PII omitted by destructure) → `publicMapSelectFields` (adds ONLY lat/long for `getMapImages` map markers). Compile guards `_privacyGuard` (no sensitive key in public), `_mapPrivacyGuard` (public-map = public ∪ {lat,long}), `_largePayloadGuard`, search `_searchPrivacyGuard`, and `lib/search-enrichment-fields.ts` `_searchEnrichmentPrivacyGuard` all compile clean. `PrivacySensitiveKeys` is a 21-key union; both search routes use the shared compile-guarded `searchEnrichmentSelectFields` filtered to `processed = true` (no PII column; no per-image ACL bypass — gallery has no private-image concept).

**A02 Cryptographic Failures — sound.** Argon2id (64 MiB / t=3 / p=4) password hashing; HMAC-SHA256 session tokens verified via `timingSafeEqual`. PAT model (`lib/admin-tokens.ts`): 256-bit `randomBytes`, stored as SHA-256 hex ONLY, `tokenHashesEqual` is length-checked + hex-validated + `timingSafeEqual`, `expires_at` and scope enforced, fail-closed when the table is missing, plaintext never reaches a query parameter (lookup by hash). `createLrToken` rejects `Invalid Date` / past expiry (closes the never-expiring-token risk).

**A03 Injection — parameterized throughout.** No `sql.raw` / `sql.identifier` / dynamic-identifier interpolation anywhere in `src`. Every `db.execute(sql\`...\`)` site (admin-tokens, admin-backfill-runner, topics, health) binds VALUES (`${normalizedSegment}`, `${row.id}`, `${IMAGE_PIPELINE_VERSION}`, `${cursor}`) and Drizzle table/column refs — never user strings as identifiers. Smart-collection compiler (`lib/smart-collections.ts`): column allowlist (throws on unknown), `MAX_DEPTH=4`, `MAX_IN_VALUES=100`, `isScalarValue` runtime enforcement (rejects object/array/null/NaN before mysql2 escaping), LIKE `%_\` escaping on `contains` + tag-contains, all values param-bound incl. `BETWEEN`, tag predicate compiled as a param-bound subquery. JSON-LD (`lib/safe-json-ld.ts`) escapes `<` `>` U+2028 U+2029 — no `</script>` breakout (all 8 `dangerouslySetInnerHTML` sites are JSON-LD via `safeJsonLd`/`sanitizeForOg`, nonce-gated). No `eval` / `new Function`. `spawn('mysqldump'|'mysql', [array])` — no shell, credentials via `MYSQL_PWD`/`MYSQL_USER` env (not /proc/cmdline), `DB_NAME` is operator-env. CSV formula-injection + Unicode bidi/zero-width hardening intact (`csv-escape.ts`, `validation.ts` `UNICODE_FORMAT_CHARS`, `stripUnicodeFormatting`).

**A04/A07 Rate-limit & Auth Failures — fail-safe.** `getClientIp` trusts XFF only when `TRUST_PROXY=true`, right-anchored by `TRUSTED_PROXY_HOPS` (parsed with `Number()` + integer guard), else `'unknown'` with one-time [SECURITY] warn. Login: per-IP (5/15min) + per-account (`acct:<sha256>`) buckets, DB-backed + in-memory fast path, Pattern-1 no-rollback on infra error (no attacker free-retries). Public surfaces pre-increment their limiter: semantic + similar (`preIncrementSemanticAttempt`, Pattern 2), OG + OG-photo (`preIncrementOgAttempt`, Pattern 4 charged-post-validation), share-key `s/[key]` + `g/[key]` pages (`preIncrementShareAttempt`). `lint:public-route-rate-limit` green.

**A05 Security Misconfiguration — clean.** Nonce-based CSP (no unsafe-inline/eval in script-src; style-src 'unsafe-inline' is the standard Next/Tailwind requirement, info-not-vuln), global `X-Content-Type-Options: nosniff`, no-store on admin API responses (cookie + token paths), nginx edge `limit_req` zones (login 10r/m, admin 30r/m) on every admin location incl. the dedicated lr/upload location, Permissions-Policy lockdown.

**A06 Vulnerable Components — `npm audit --omit=dev` → 0 vulnerabilities.**

**A10 SSRF — fail-closed.** Only one server-side outbound `fetch` exists: `lib/og-photo-fetch.ts:72`, called by `api/og/photo/[id]/route.tsx`. The fetch origin is pinned to `new URL(siteConfig.url).origin` and FAILS CLOSED (returns the fallback OG card) when `siteConfig.url` is unset/unparseable — never falls back to the attacker-controllable request origin. The path is a DB-derived UUID `filename_jpeg` + admin-config integer size — no attacker lever. Per-attempt 3.5s timeout + 10s total budget + 1 MB byte cap. `IMAGE_BASE_URL` is operator-env (validated absolute-https-no-creds at startup), used only in `next.config.ts` remotePatterns — never in a server fetch.

**A09 Logging — present.** Audit events on `lr_token_used` / `lr_token_created` / `lr_token_revoked` / `db_backup_download` / `db_restore`; failures logged at warn so shippers retain them.

## Findings
- SEC-22-INFO | INFO | `clip-embeddings.ts:24-31` — semantic scan-limit env parse has no upper clamp (operator-env only; non-exploitable; optional ceiling clamp suggested)
- SEC-19-01 | LOW (carried, unchanged) | `rate-limit.ts:112-130` — IPv6 /64 rate-limit aggregation
- SEC-19-02 | LOW (carried, unchanged; better-fenced) | `api-auth.ts` / `admin-tokens.ts` — token verify DB lookup un-throttled pre-DB (nginx edge zone=admin DOES cover lr/upload)
- SEC-20-INFO | INFO (carried, byte-unchanged) | `gps-exif-strip.ts:461-465` — walkAborted re-encode only on zero-items branch (verified non-exploitable)

## Security Checklist
- [x] No hardcoded secrets (no key/token literals in src; no real `.env*` tracked)
- [x] All inputs validated (code-point limits, slug/filename allowlists, Unicode-format reject/strip, scalar enforcement, token format + expiry)
- [x] Injection prevention verified (Drizzle params, no sql.raw/identifier, smart-collection allowlist compiler, LIKE + JSON-LD escaping, array-arg spawn)
- [x] Authn/authz verified (withAdminAuth wrap + lint, requireSameOriginAdmin early-return + lint, token scope/expiry, last-admin advisory-lock guard)
- [x] Privacy/PII guards verified (public/searchEnrichment/map compile-guards hold; tsc exit 0; GPS map-gated)
- [x] SSRF verified (OG fetch host-pinned fail-closed; no other server-side fetch; IMAGE_BASE_URL operator-env only)
- [x] Dependencies audited (`npm audit --omit=dev` → 0 vulnerabilities)
- [x] Rate-limiting verified (admin lint gate green; public mutating routes pre-increment; nginx edge throttle on token path)
