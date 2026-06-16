# Security Review Report — Run-6 Cycle-6

**HEAD:** `4eb83aab`
**Agent:** security-reviewer (OWASP Top 10 / secrets / unsafe patterns / auth-authz)
**Date:** 2026-06-17
**Scope:** Full crown-jewel re-audit + cycle-5→HEAD delta + repo-wide unsafe-pattern sweep
**Risk Level:** LOW (no actionable issues)

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0

**Verdict: 0/0/0/0 — security-neutral cycle. The crown-jewel surface remains hardened; no real, HEAD-verified vulnerability was found.** This is the correct, honest outcome of a system that converged in cycle 5. No marginal/speculative findings are reported per the cycle-6 directive.

---

## Lint-gate results (all PASS)

| Gate | Result |
|---|---|
| `npm run lint:api-auth` | **PASS** — `src/app/api/admin/db/download/route.ts`, `src/app/api/admin/lr/upload/route.ts` both wrap `withAdminAuth(...)`. |
| `npm run lint:action-origin` | **PASS** — "All mutating server actions enforce same-origin provenance." Every mutating export stores + early-returns on `requireSameOriginAdmin()`; `getAdminTags` correctly carries an `@action-origin-exempt` comment. |
| `npm run lint:public-route-rate-limit` | **PASS** — checkout + semantic use rate-limit helpers; download + stripe-webhook carry `@public-no-rate-limit-required` (both bearer/signature gated); health/live/og/similar have no mutating handlers. |

## npm-audit results (8 advisories — ALL dev/build-time, runtime-NON-exploitable)

`npm audit --workspace=apps/web` reports 1 low / 3 moderate / 4 high. Every advisory is in a **dev or build-time dependency** with no attacker-reachable runtime surface:

| Pkg | Sev | Tree position | Runtime exploitable? |
|---|---|---|---|
| `@babel/core` <=7.29.0 | — | build transpile | No — no runtime source-map read of attacker input. |
| `esbuild` 0.17–0.28 | high | via `tsx` + `drizzle-kit` (dev/migration) | No — dev/CLI only; the RCE requires a malicious `NPM_CONFIG_REGISTRY` Deno path, absent in prod. |
| `js-yaml` <=4.1.1 | mod | dev toolchain | No — no runtime YAML parse of untrusted input. |
| `postcss` <8.5.10 (GHSA-qx2v-qp2m-jg93) | mod | **`next@16.2.6` → postcss@8.4.31 (IS in prod tree)** | **No** — the advisory is XSS via unescaped `</style>` in PostCSS's CSS **stringify** output. PostCSS stringify runs at **build time** (Tailwind/Next CSS compilation over first-party CSS). There is no runtime code path where user input reaches PostCSS stringify. Re-verified at HEAD: assessment from cycles 1-5 still holds. |
| `vite` 8.0.0–8.0.15 | high | via `vitest` (dev only) | No — test runner; `server.fs.deny` bypass is Windows-dev-server only. |

`npm audit fix --force` was deliberately NOT run: it would install `next@9.3.3` (a destructive 7-major downgrade) and `drizzle-kit@0.19.1` (breaking). The runtime fix correctly waits for an in-place `next` patch bump.

---

## What was verified (read IN FULL at HEAD)

**Auth / session / tokens**
- `lib/session.ts` — HMAC-SHA256 session tokens; `timingSafeEqual` with length-prefix guard; token-shape regex applied AFTER crypto verify (no timing oracle); 24h age bound (rejects negative age = future-dated); stored as SHA-256 hash (DB compromise yields no usable cookies); `SESSION_SECRET` REFUSES the DB fallback in production (`throw` on missing env). Clean.
- `lib/password-hashing.ts` — Argon2id, 64 MiB / t=3 / p=4, exceeds OWASP. Single shared policy object. Clean.
- `app/actions/auth.ts` — login: timing-equalized dummy Argon2 hash (no user enumeration); dual **per-IP + per-account** rate buckets, pre-incremented BEFORE Argon2 (TOCTOU-safe), strict `>` DB semantics with rollback only on over-limit; session-fixation prevented (insert+delete-others in one transaction); `secure` cookie gated on trusted proto/prod; `unstable_rethrow` before generic catch; **no rollback on infra error (Pattern 1)** = correct (denies attacker extra attempts via induced DB errors). `updatePassword`: validates field shape BEFORE rate pre-increment (typos don't lock out), 12-codepoint min, full session rotation on change. Clean.
- `lib/api-auth.ts` (`withAdminAuth`) — central same-origin enforcement (AGG9R-02) + `isAdmin()`; PAT token path bypasses same-origin by design (scope-gated, Lightroom); no-store + nosniff defaults injected on both token and cookie success paths. Clean.
- `lib/rate-limit.ts` / `auth-rate-limit.ts` — `getClientIp` trusts `X-Forwarded-For` ONLY when `TRUST_PROXY=true` (spoofing prevented by default; one-time SECURITY warn when proxy headers present without the flag); `TRUSTED_PROXY_HOPS` selects the correct client slot; bounded maps with eviction; DB-backed decrement wrapped in a transaction. Clean.

**Paid-download / Stripe surface**
- `lib/download-tokens.ts` — `dl_<43 base64url>` shape pre-check before any hash/DB; `timingSafeEqual` on 64-hex SHA-256; stored-hash shape guard distinguishes DB corruption from wrong token. Clean.
- `api/download/[imageId]/route.ts` — single-use claim is an atomic conditional UPDATE (`WHERE downloadedAt IS NULL`); file is **opened BEFORE the claim** so a vanished file never burns the token (C3-RPF-05 / R4C4-06); GET interstitial is claim-free + fs-free (mail-scanner / auto-HEAD safe) with its own restrictive CSP; double path-traversal containment (`startsWith` + realpath); FileHandle leak-closed on every post-open branch; RFC 6266/5987 Content-Disposition encoding. Clean.
- `api/checkout/[imageId]/route.ts` — per-IP rate limit pre-incremented before DB; Pattern-2 rollback on every pre-Stripe early-return; strict `/^\d+$/` price parse; `payment_method_types:['card']` pins immediate-capture (closes the money-taken-no-goods async gap); idempotency key omitted only for unknown-IP (avoids cross-buyer collision). Clean.
- `api/stripe/webhook/route.ts` — mandatory signature verify (constant-time 400 on forgery); `payment_status==='paid'` gate; email shape + 255-cap reject before insert; tier allowlist; zero-amount reject; SELECT-by-sessionId idempotency + `ON DUPLICATE KEY` belt; `insertId>0` disambiguates the dup-key loser so no dead plaintext token is logged; deleted-image → 200 + manual-refund log (no retry storm); PII (email) kept out of error-level logs. Clean.

**File-serving / DB backup-restore**
- `lib/serve-upload.ts` — `ALLOWED_UPLOAD_DIRS` whitelist + `SAFE_SEGMENT` + per-segment `.`/`..` reject + dir↔ext map; `lstat` symlink reject + realpath containment; **streams from the realpath-resolved path** (closes TOCTOU symlink-swap); fd released on abort/error; no SVG content-type. Clean.
- `admin/db-actions.ts` — mysqldump/mysql via **argument arrays** (no shell string), credentials via `MYSQL_PWD`/`MYSQL_*` env (never `/proc/cmdline`), `HOME` excluded (no `~/.my.cnf`); restore validates header + scans for dangerous SQL in 1 MB chunks + `--one-database`; advisory lock `gallerykit_db_restore` on a dedicated connection with explicit RELEASE on every early-return; backups dir `0o700`, files `0o600`; stderr scrubbed of credentials. Clean.
- `api/admin/db/download/route.ts` — `withAdminAuth` + `isValidBackupFilename` + double containment + lstat-symlink-reject + realpath; audit-logged with requester IP; streams resolved path. Clean.

**Privacy / PII**
- `lib/data.ts` — `publicSelectFields` / `publicMapSelectFields` derived by **destructuring-omission** from a single `adminSelectFields` (separate object refs); THREE compile-time guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`) from one canonical `PrivacySensitiveKeys` union; `getMapImages` is the ONLY lat/long exposure — gated by `topics.map_visible=true` INNER JOIN at the SQL layer AND a runtime per-row assertion that throws on any leak. Clean.
- `lib/gps-exif-strip.ts` — container-aware byte surgery (JPEG/TIFF/HEIF/AVIF/WebP); every walker bounds-checked and returns `null` on anomaly → caller re-encodes; ExtendedXMP cross-chunk reconstruction; post-EOI trailer rejection (SEC-R4C10-01); GPS IFD zeroed inline+offset+entry-count. Mirrored on the LR PAT path. Clean.
- `lib/validation.ts` / `lib/csv-escape.ts` — `UNICODE_FORMAT_CHARS` (bidi U+202A-202E/U+2066-2069 + zero-width/invisible) as single source; CSV escape strips C0/C1, strips formatting chars, collapses CRLF, prefixes formula chars `=+-@` with leading-whitespace tolerance, doubles quotes. `stripUnicodeFormatting` covers machine-derived EXIF source path. Clean.

**Middleware / XSS / injection sinks**
- `proxy.ts` — admin sub-route guard is presence + format only (full crypto verify lives in server actions = defense-in-depth, not the gate); `/api/*` correctly EXCLUDED from matcher (each admin API self-guards via `withAdminAuth`); `x-gk-admin-render` reflects only the requester's own cookie. Clean.
- All `dangerouslySetInnerHTML` (8 sites) are JSON-LD only, routed through `safeJsonLd()` (escapes `<`→`<` closing-tag breakout + U+2028/U+2029) and carry the CSP `nonce`. Combined with admin-string bidi/invisible-char rejection at the validation layer, no XSS vector. Clean.
- No `child_process.exec`/`eval`/`new Function` — the only `.exec()` hits are regex; the only `spawn` is the env-var-credentialed mysqldump/mysql. Clean.

**Hard-guard items (re-verified, NOT reopened)**
- `import 'server-only'` on `@/db` — NOT proposed (breaks tsx backfill, proven cycle 5). The cycle-5→HEAD delta is exactly the test that pins this boundary (`client-server-only-boundary.test.ts`, +183 lines).
- CLIP/semantic search — confirmed fail-closed: `semantic/route.ts` re-reads resolved mode and 503s unless `stub`/`production`; resolver heals stored `'production'`→`'disabled'` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. NOT activated.
- `postcss<8.5.10` transitive — re-confirmed build-time-only, non-exploitable at runtime (above).

## Secrets scan
- `grep` for `secret|password|api_key|private_key = "<16+ char literal>"` across `src/**/*.{ts,tsx}` → **zero hardcoded secrets**. All secrets flow through `process.env`.

## Cycle-5 → HEAD delta
`git diff 2f603716..4eb83aab -- apps/web/src` touches exactly ONE file: `__tests__/client-server-only-boundary.test.ts` (test-only, +183/-8). **The cycle delta is security-neutral** — no runtime code, no new attack surface.

## Security Checklist
- [x] No hardcoded secrets (verified `src/**`)
- [x] All inputs validated (codepoint length caps, shape regexes, body-size guards, bidi/invisible-char rejection)
- [x] Injection prevention verified (Drizzle parameterization; CSV formula-injection; SQL-restore scan; spawn arg-arrays; JSON-LD `<`-escape)
- [x] Authentication/authorization verified (Argon2id, timing-safe tokens, dual rate buckets, `withAdminAuth`, same-origin lint, session-fixation prevention)
- [x] IDOR/BOLA — paid download bound to single-use 256-bit token + constant-time verify; admin backup download path-contained + auth-gated
- [x] Path traversal / symlink — whitelist + SAFE_SEGMENT + lstat + realpath-from-resolved on all three fs-serving paths
- [x] Privacy field leakage — 3 compile-time guards + runtime map_visible assertion + GPS byte-strip
- [x] Dependencies audited (8 advisories, all dev/build-time, runtime-non-exploitable; no destructive `--force`)
- [x] CSRF / same-origin — central in `withAdminAuth` + `requireSameOriginAdmin` (lint-enforced)
- [x] Rate limits on mutating public routes (lint-enforced; TRUST_PROXY-gated IP source)
