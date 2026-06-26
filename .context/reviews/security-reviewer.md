# Security Review Report — GalleryKit (Cycle 12)

**Scope:** GalleryKit repository at HEAD `2a9976a1` (full app `apps/web/`)
**Reviewer:** Security Reviewer — OWASP Top 10, authn/authz, secrets, SSRF, path traversal, injection (SQL/XSS/CSV/command), session/cookie security, rate-limit bypass, file-upload security, CSRF/same-origin, privacy/PII, deserialization, ReDoS, DoS
**Date:** 2026-06-27
**Prior baseline:** Cycle 10 converged at 0 CRITICAL / 0 HIGH (HEAD `bcd67b12`). This cycle reviews HEAD `2a9976a1` (21 commits later, mostly cycle-10/11 hardening fixes).
**Risk Level:** LOW — no confirmed exploitable vulnerabilities. Two LOW / informational defense-in-depth observations.

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No remotely exploitable vulnerabilities |
| HIGH | 0 | None |
| MEDIUM | 0 | None new; prior MEDIUMs are quality/structural, tracked in `_aggregate.md` |
| LOW | 2 | Incomplete unexport (R12-SEC-01) + lint-gate GET coverage gap (R12-SEC-02) |

**Evidence collected this cycle:**
- All three security lint gates **PASS** (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`).
- `npm audit` (full tree) and `npm audit --omit=dev`: **0 vulnerabilities**.
- Full diff `bcd67b12..2a9976a1` of every changed source file reviewed line-by-line.
- High-risk surfaces re-audited from source (not sampled): LR token upload, semantic + similar search, OG routes, upload serving (path traversal), DB backup download, middleware admin guard, session/cookie security, request-origin/CSRF, validation/sanitize regexes (ReDoS), DB backup/restore `spawn` (command injection), data.ts privacy guards, analytics geoip (PII).

**Verdict:** The codebase remains mature and well-hardened. Every commit since the prior review is a positive security/safety/observability improvement. No new vulnerability class was introduced.

---

## Delta Review — Changes Since Prior Review (bcd67b12 → 2a9976a1)

All 21 commits reviewed. Security-relevant ones, all confirmed **clean / positive**:

| Commit | Change | Security assessment |
|--------|--------|---------------------|
| `5ba4025c` | request-origin: return `null` on protocol fallback (was `'http'`); "unexport" `allowMissingSource` | Protocol-null does NOT downgrade cookie `secure` (production is always `secure: true`; the `?? 'http'` in `getExpectedOrigin` is dead on the same-origin path because a present Origin/Referer already yields a real protocol). Unexport is **incomplete** — see R12-SEC-01. |
| `450d2a53` | request-origin: handle null protocol in `getExpectedOrigin` | Fail-closed preserved; `hasTrustedSameOrigin` still requires an explicit Origin/Referer match. Clean. |
| `9d88e217`, `2b166245`, `74bd776a` | rate-limit / public.ts: timer-based prune for og/share; fix shallow-copy mutation bugs (`entry.count++` → `.set(...)`) | Correct fix for the `BoundedMap.get()`-returns-copy contract. Counters now mutate the Map via `.set()`. No bypass. Clean. |
| `038b3154` | semantic rate-limit `.set()` instead of direct mutation | Same class. Clean. |
| `6cfcc75d` | audit: prioritize security fields (ip/userAgent/action/userId/...) before metadata truncation | Defense-in-depth; raises survival odds of forensic fields. No regression. |
| `5f4a5e95`, bounded-map | `BoundedMap.get()` returns shallow copy of object values | Prevents external mutation of internal rate-limit/queue state. Documented as shallow (nested refs shared) — acceptable for the flat `{count,resetAt}` / `{count,lastAttempt}` entries used. Clean. |
| `b3c55036` | instrumentation: SIGTERM/SIGINT graceful shutdown, geoip-lite pre-warm, queue-state runtime shape validation | SIGTERM/SIGINT guarded against re-entry (`shutdownInProgress`); geoip pre-warm is a try/catch dynamic import (optional dep); queue-state validation re-inits on malformed global (defensive). No external-input reachability. Clean. |
| `3111cc7e` | process-image: `safeUnlink`/`safeCloseDirHandle` distinguish ENOENT | Observability only; no security semantics change. Clean. |
| `c7289870` | process-image: `Buffer.indexOf` for `colr` box search (bounded) | Still bounded by buffer length; the `searchStart` advance terminates. No infinite loop / DoS. Clean. |
| `d6107f89` | image-queue bootstrap empty-batch handling | Correctness fix; no auth/data-exposure surface. Clean. |
| `14730ee2` | backfill: `console.log` → `console.info` | Log hygiene. Clean. |
| `bbfd747f` | public.ts: extract `checkLoadMoreRateLimit` DRY helper | Behavior-preserving; rate-limit posture identical to prior inline logic. Clean. |
| `f1f6202d`, badge/sheet/skeleton/tooltip/progress | UI touch-target/ARIA/motion | Client-only, no security surface. |
| `92ce7a9e` | photo-viewer: local `ConnInfo` interface for `navigator.connection` | Client-only type change. No security surface. |
| `gallery-config.ts` | fallback path now applies `SEMANTIC_SEARCH_ALLOW_PRODUCTION` operator-gate (AGG-M6 fix); `getSetting` uses `??` | Closes the prior gap where the DB-unavailable fallback could surface `production` mode without the env gate. **Positive security fix.** |

---

## LOW Findings (this cycle)

### R12-SEC-01 — `hasTrustedSameOriginWithOptions` still exported; `allowMissingSource:true` CSRF-bypass option remains reachable
- **File:** `apps/web/src/lib/request-origin.ts:83,109`
- **Class:** A01 Broken Access Control / CSRF (latent, defense-in-depth)
- **Severity:** LOW · **Confidence:** High (confirmed) · **Status:** carry-over of AGG-M9; the "fix" commit `5ba4025c` did **not** close it
- **Detail:** Commit `5ba4025c` removed `export` from the function declaration but re-added `export { hasTrustedSameOriginWithOptions };` at line 109. The function is now exported **solely** so `src/__tests__/request-origin.test.ts:3` can assert the loose `allowMissingSource:true` opt-in. Any future in-repo caller can still call it with `{ allowMissingSource: true }`, which makes `hasTrustedSameOrigin*` return `true` for a request bearing **no** Origin and **no** Referer header — defeating the same-origin/CSRF boundary for that caller.
- **Exploitability:** None today — `grep` confirms zero production callers pass `allowMissingSource:true` (only the public `hasTrustedSameOrigin()` wrapper, which always uses the strict default, and the test). The risk is purely a future-misuse footgun whose presence the commit message ("unexport allowMissingSource") misleadingly implies is closed.
- **Blast radius (if a future caller opted in):** A mutating admin route/action that called this with `true` would accept a header-stripped cross-site request, enabling CSRF on that one surface.
- **Suggested fix:** Make the options variant a non-exported internal and have the test exercise the behavior through a thin test-only shim, or annotate with `@internal` + an `eslint no-restricted-imports`/`no-restricted-syntax` rule forbidding `allowMissingSource: true` outside the test. Update the commit's stated intent or finish it.

```typescript
// request-origin.ts — current (still exported for the test only)
function hasTrustedSameOriginWithOptions(requestHeaders, options = {}) { ... }
export { hasTrustedSameOriginWithOptions };   // <-- reachable by any future caller

// suggested: keep internal; expose ONLY the strict wrapper publicly
// export function hasTrustedSameOrigin(h) { return hasTrustedSameOriginWithOptions(h); }
// (test imports hasTrustedSameOrigin + a dedicated __test_allowMissingSource helper)
```

### R12-SEC-02 — Expensive public GET routes are rate-limited at runtime but NOT covered by any CI gate
- **Files:** `apps/web/src/app/api/search/similar/[id]/route.ts` (O(n) embedding scan), `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx` (Satori/Sharp CPU + internal fetch)
- **Class:** A05 Security Misconfiguration / DoS-defense regression risk (process, not a live vuln)
- **Severity:** LOW (informational) · **Confidence:** High · **Status:** new framing
- **Detail:** The `lint:public-route-rate-limit` gate **only scans mutating handlers** (POST/PUT/PATCH/DELETE) and explicitly excludes GET ("GET handlers are NOT scanned … must be audited separately"). The lint output this cycle confirms it reports `similar/[id]` and both OG routes as "no mutating handlers." All four ARE rate-limited at runtime today (`preIncrementSemanticAttempt` / `preIncrementOgAttempt`), so there is no live exposure. The gap is that a future refactor deleting the rate-limit pre-increment from any of these expensive GET routes would pass CI silently, re-opening an unmetered-CPU/internal-fetch-amplifier DoS surface.
- **Suggested fix:** Extend the gate to also scan GET handlers in a curated allowlist of "expensive" public routes (image generation, embedding scan, file generation), requiring either a `preIncrement*`/`checkAndIncrement*` helper call OR an explicit `@public-no-rate-limit-required:` exempt comment — exactly the contract already enforced for mutating routes.

---

## Carry-Over Items (tracked in _aggregate.md; NOT re-reported as new)

These remain open from cycle 10 and are quality/structural, not exploitable vulnerabilities:
- AGG-M8 og/share stale-entry accumulation — **mitigated** this cycle by `9d88e217` (timer-based prune added). Effectively closed.
- AGG-M9 `allowMissingSource` — see R12-SEC-01 (still open, incomplete fix).
- AGG-M11 audit metadata truncation — **mitigated** this cycle by `6cfcc75d` (security fields prioritized).
- AGG-M6 gallery-config fallback operator-gate — **fixed** this cycle (semantic mode env-gate applied in fallback).
- AGG-M19 semantic search brute-force O(n) — structural/documented; bounded by `SEMANTIC_SCAN_LIMIT` + rate limit. Deferred.
- AGG-M10 protocol fallback — **addressed** (`5ba4025c` returns null; cookie `secure` confirmed not downgraded).

---

## Surface-by-Surface Verification (confirmed clean)

| Surface | File(s) | Result |
|---|---|---|
| LR PAT upload (token auth + file upload) | `api/admin/lr/upload/route.ts`, `lib/admin-tokens.ts`, `lib/api-auth.ts` | Token = `gk_`+base64url(32B), SHA-256 stored, `timingSafeEqual` compare, well-formed-format pre-check, scope gate, parameterized SQL lookup by hash. Upload mirrors browser path: `getSafeUserFilename`, slug/title/desc validation (code-point length + `sanitizeAdminString`), restore-maintenance gate, contract advisory lock, 1 GB disk pre-check, cumulative TOCTOU-safe tracker keyed on token user, HDR-ingest gate, GPS strip, idempotent quota settle, audit log. **Solid.** |
| Semantic / similar search | `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts` | Both: same-origin gate → restore-maintenance → id/query validation → rate-limit pre-increment (Pattern-2 rollback) → production/stub mode gate. Semantic: Content-Type strict parse, chunked-encoding reject, Content-Length + body-byte caps, query min-3-codepoints, `topK` clamped to `SEMANTIC_TOP_K_MAX`. Query never reaches SQL (CLIP encoder). Returned metadata is public-grade (no PII). **Solid.** |
| OG image routes (SSRF) | `api/og/route.tsx`, `api/og/photo/[id]/route.tsx` | Home OG: no external fetch (inline gradient). Photo OG: internal fetch base **pinned to trusted `siteConfig.url`**, fail-closed on unparseable URL; derivative path is a validated UUID; fallback redirect validates same-origin (no open redirect); rate-limited; charged-on-failure. **Solid.** |
| Upload serving (path traversal) | `lib/serve-upload.ts`, both `uploads/[...path]/route.ts` | `ALLOWED_UPLOAD_DIRS` whitelist (jpeg/webp/avif only; `original/` excluded), `SAFE_SEGMENT` regex, `.`/`..`/length rejection, ext↔dir match, `lstat` symlink rejection, `realpath` containment (`startsWith(root+sep)`), stream from resolved path (TOCTOU closed). **Solid.** |
| DB backup download | `api/admin/db/download/route.ts`, `lib/backup-filename.ts` | `withAdminAuth`, anchored filename regex (no quotes/CRLF → no Content-Disposition header injection), containment + symlink + realpath checks, audit log. **Solid.** |
| Middleware admin guard | `proxy.ts` | Presence + 3-segment/≥100-char token-format check (full crypto verify in server actions); CSP nonce per request; `x-gk-admin-render` reflects only requester's own cookie. API routes correctly excluded (each `api/admin/**` uses `withAdminAuth`, lint-enforced). **Solid.** |
| Session / cookie | `app/actions/auth.ts` | Argon2id (64 MiB/3/4), HMAC-SHA256 + `timingSafeEqual`, `httpOnly`+`sameSite:lax`+`secure` (always true in production), session rotation on login + password change, dual-bucket rate limiting. Protocol-null change does not downgrade `secure`. **Solid.** |
| CSRF / same-origin | `lib/request-origin.ts`, `lib/api-auth.ts` | Fail-closed (requires Origin or Referer match); `withAdminAuth` enforces origin centrally; all mutating actions use `requireSameOriginAdmin()` (lint-enforced). One latent footgun → R12-SEC-01. |
| Injection (SQL/cmd/CSV/XSS) | drizzle params throughout; `db-actions.ts` `spawn` (array form, no shell, env-based creds, `HOME` excluded); `csv-escape.ts`; all JSON-LD via `safeJsonLd`; no `eval`/`new Function`; no attacker-controlled `new RegExp` | **No injection found.** |
| ReDoS | `validation.ts`, `backup-filename.ts`, `base56.ts`, `sanitize.ts` redaction | All anchored, single-char-class quantifiers, no nested/overlapping quantifiers. Password redaction escapes all regex metacharacters before `new RegExp`. **No ReDoS.** |
| Privacy / PII | `lib/data.ts`, `lib/analytics.ts`, GPS strip | `publicSelectFields` derived-by-omission from `adminSelectFields` (separate object ref) excluding `latitude/longitude/filename_original/user_filename/original_*`; compile-time guards (`_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`, `_MapPrivacyGuard`, `_LargePayloadGuard`). Analytics stores only 2-char country code, never full IPs. **Solid.** |
| Secrets | repo-wide grep + `.env.local.example` | No hardcoded secrets; env-sourced; stderr redaction for mysqldump/mysql. **Clean.** |

---

## Security Checklist

- [x] Argon2id password hashing (64 MiB / t=3 / p=4)
- [x] HMAC-SHA256 sessions, `timingSafeEqual`, secure cookie attrs (secure always-on in prod)
- [x] PAT auth: SHA-256 stored, constant-time compare, scope + expiry enforced, parameterized lookup
- [x] `withAdminAuth` on every `api/admin/**` route (lint-enforced, verified)
- [x] `requireSameOriginAdmin()` on every mutating server action (lint-enforced, verified)
- [x] Public mutating routes rate-limited (lint-enforced); expensive GETs rate-limited at runtime (gap → R12-SEC-02)
- [x] Path traversal: whitelist + SAFE_SEGMENT + realpath containment + symlink rejection (upload serve + backup download)
- [x] File upload: UUID names, per-file 200 MiB + cumulative caps, disk pre-check, decompression-bomb `limitInputPixels`, HDR gate
- [x] SSRF: OG photo route pins fetch base to trusted origin, fail-closed
- [x] Open redirect: OG fallback validates same-origin
- [x] CSV injection: formula-char prefix + C0/C1 + bidi + zero-width strip (`csv-escape.ts`)
- [x] XSS: React escaping; all JSON-LD via `safeJsonLd`; OG via `sanitizeForOg`
- [x] Unicode bidi/zero-width rejected at all admin string entry points (`validation.ts` / `sanitize.ts`)
- [x] Command injection: `spawn` array form, no shell, env-based MySQL creds
- [x] SQL injection: Drizzle parameterization; raw SQL confined to schema/admin maintenance, no untrusted concat
- [x] Privacy: GPS/filename excluded from public projections; on-disk GPS strip; analytics country-only
- [x] Security headers: CSP (nonce), HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, nosniff
- [x] Dependencies: `npm audit` 0 vulnerabilities (full + prod-only)
- [x] No hardcoded secrets

---

## Final Sweep — Commonly Missed Issues

| Issue | Status |
|-------|--------|
| Missing auth on a new route | NOT FOUND — only 8 API routes; admin routes lint-gated; no new unauthenticated mutating route |
| TOCTOU | NOT FOUND — upload-quota tracker pre-claims; serve paths stream from realpath; advisory locks on restore/backfill/upload/processing |
| Timing leaks | NOT FOUND — `timingSafeEqual` on session + token; dummy Argon2 for user-enumeration |
| Error messages leaking internals | NOT FOUND — generic client errors; stderr redacted; no stack traces in prod |
| ReDoS | NOT FOUND — all regexes linear/anchored |
| SSRF / open redirect | NOT FOUND — OG fetch base pinned + fail-closed; fallback same-origin-validated |
| Prototype pollution / type confusion | NOT FOUND — `Array.isArray` + `normalizeStringRecord` shape guards |
| Insecure deserialization | NOT FOUND — JSON parsing minimal + validated; embeddings decoded via length-checked `decodeEmbeddingColumn` |
| Mutable state leak | NOT FOUND — `BoundedMap.get()` + rate-limit getters return shallow copies; counters mutate via `.set()` |
| Header injection (Content-Disposition) | NOT FOUND — backup filename anchored regex disallows quotes/CRLF |
| Latent CSRF-bypass footgun | R12-SEC-01 (LOW, not exploitable today) |
| CI coverage gap for expensive GET rate-limit | R12-SEC-02 (LOW, informational) |

---

## Conclusion

GalleryKit's security posture is **strong and continues to converge**. This cycle's 21 commits are uniformly positive hardening (rate-limit mutation-bug fixes, audit field prioritization, graceful shutdown, config operator-gate in the fallback path, ENOENT-distinguished cleanup). No new CRITICAL/HIGH/MEDIUM findings. The two LOW items are a never-exploited-today CSRF footgun whose "fix" commit was incomplete (R12-SEC-01) and a CI-coverage hardening suggestion for expensive public GET routes (R12-SEC-02).

**Recommended maintenance:** (1) finish R12-SEC-01 by making the options variant truly internal; (2) extend `lint:public-route-rate-limit` to cover expensive GET routes (R12-SEC-02); (3) keep monitoring `npm audit` for `argon2`/`sharp`/`mysql2`/`next` CVEs.

*All findings verified against source at HEAD `2a9976a1`. Lint gates + `npm audit` evidence captured this cycle.*
