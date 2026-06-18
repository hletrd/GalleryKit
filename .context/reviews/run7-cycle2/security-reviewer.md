# Security Review Report — Run-7 Cycle-2

**Agent:** security-reviewer
**HEAD:** `1cdbb883` (working tree clean; only untracked `.context/reviews/run7-cycle2/`)
**Date:** 2026-06-18
**Scope:** Whole-repo functional source under `apps/web/src/` — every API route (admin + public), every server action, auth/session/origin libs, file-upload paths, privacy guards, CSV/Unicode/sanitize, rate-limiting, middleware, Stripe money flow, CLIP semantic routes, DB backup/restore.

## Verdict

**Risk Level: LOW.** No new security finding (0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW). The codebase remains exceptionally hardened. Every attack surface was re-read at HEAD; all four blocking lint/type gates were re-run and their invariants verified against the actual code (not just gate exit codes). This continues the 0-finding security trend (run-6 cycle-11, run-7 cycle-1).

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total NEW findings** | **0** |

**npm audit (`--omit=dev`): 0 critical, 0 high, 2 moderate, 0 low** — both moderate are the known postcss `</style>` XSS advisory (GHSA-qx2v-qp2m-jg93) pinned via `next@16.2.6 → postcss@8.4.31`. Not runtime-reachable (build-time Tailwind/autoprefixer over first-party CSS only); documented repo false-positive. No non-breaking fix exists (next is already latest stable major).

## Attack surfaces re-verified CLEAN at HEAD

### Authentication / session / origin
- **`session.ts`** — HMAC-SHA256 token; `timingSafeEqual` after length check; structural regex checks placed AFTER crypto verification (no timing oracle); 24h age window with `tokenAge < 0` guard; DB lookup by SHA-256 token hash (DB compromise yields no usable cookie); `SESSION_SECRET` env required in prod (throws rather than falling back to DB secret). Sound.
- **`api-auth.ts` (`withAdminAuth`)** — token path (PAT scope) → same-origin check → `isAdmin()`; no-store + nosniff defaults applied to all responses. Token path correctly bypasses same-origin (CORS integration is the point of PATs) but requires a valid scoped token. Sound.
- **`request-origin.ts`** — fail-closed by default (requires explicit Origin/Referer match); `X-Forwarded-*` only trusted under `TRUST_PROXY=true`, taking the right-most (trusted-hop) value; default-port normalization. Sound.
- **`action-guards.ts` (`requireSameOriginAdmin`)** — centralizes the provenance policy; returns localized error string on failure. Verified upheld by `lint:action-origin` (all mutating actions store + early-return the result).
- **`password-hashing.ts`** — Argon2id, memoryCost=65536 (64 MiB), timeCost=3, parallelism=4 (exceeds OWASP); single shared policy across login/change/create/bootstrap prevents skew. `argon2.verify` constant-time.
- **`admin-tokens.ts`** — `gk_<base64url(32B)>`; hash-only storage; constant-time `tokenHashesEqual`; scope allowlist (`normalizeScopes`); parameterized `db.execute(sql\`…\`)` (drizzle bound params, NOT concatenation); fail-closed on missing table.
- **`proxy.ts`** — convenience guard for `/[locale]/admin/*` (cookie presence + format only; full crypto in server actions = defense in depth, documented); per-request CSP nonce via `crypto.randomUUID()`; API routes correctly excluded from matcher (each implements its own auth); `x-gk-admin-render` reflects only the requester's own cookie. Sound.

### Money flow (Stripe paid downloads)
- **`/api/checkout/[imageId]`** — per-IP rate limit (Pattern 2, rollback on every 4xx/5xx early-return); strict integer price parse (`/^\d+$/`); card-only pin (`payment_method_types: ['card']`) closing the async-payment money-taken-no-goods gap (AGG-H1); idempotency key omitted on unknown-IP to avoid cross-buyer collision; code-point title truncation. Sound.
- **`/api/stripe/webhook`** — mandatory `constructStripeEvent` signature verification (constant-time 400 on forgery before any DB work); `payment_status==='paid'` gate; tier allowlist; zero-amount reject; deleted-image FK handling (200 + manual-refund log, no retry storm); idempotency via SELECT-by-sessionId + ON DUPLICATE KEY with `insertedFresh` disambiguation (affectedRows===1 && insertId>0); PII-safe logging (no email at error level; plaintext token only under opt-in `LOG_PLAINTEXT_DOWNLOAD_TOKENS`). Sound.
- **`/api/download/[imageId]`** — 256-bit single-use bearer token; shape regex pre-check; entitlement lookup with used-row disambiguation; constant-time `verifyTokenAgainstHash`; expiry + refunded + single-use checks; `path.resolve` + `startsWith(dir+sep)` + `lstat` symlink reject + **realpath TOCTOU close** (streams from resolved handle); file opened BEFORE atomic claim so a missing file never burns the token; Content-Disposition extension sanitized + RFC 5987 encoding; handle never leaks on any post-open path. Sound.
- **`download-tokens.ts`** — 256-bit random; hash-only; shape + stored-hash-shape validation; constant-time compare. No enumeration / timing oracle.

### Privacy guards (PII / GPS)
- **`data.ts`** — `publicSelectFields` derived from `adminSelectFields` by explicit omission (separate object reference); compile-time `_privacyGuard` (`_SensitiveKeysInPublic extends never`) and `_mapPrivacyGuard`; `publicMapSelectFields` exposes lat/lon ONLY behind the `map_visible` topic inner-JOIN. **Typecheck exit 0 confirms no PII has leaked into any public select shape at HEAD.**
- **GPS strip (`gps-exif-strip.ts` + `images.ts:311` + LR upload `route.ts:311`)** — when `stripGpsOnUpload` is set, BOTH ingest paths null the DB lat/lon columns AND call `stripGpsFromOriginal` on the on-disk original (the file the paid-download route streams). Container-aware byte-level scrubbers (JPEG/TIFF/HEIF/WebP) are bounds-checked, return `null` on any structural anomaly to force the tier-2 metadata-free re-encode. The privacy GUARD ITSELF is sound (TE-R7C2-01 concerns its TEST coverage, not the guard). Sound.

### Injection / XSS / SSRF / command-exec
- **No SQL injection** — all queries use Drizzle parameterization or `sql\`…\`` bound-param template literals; smart-collections validates column/operator against allowlists + `isScalarValue` (blocks object/array/null that mysql2 would expand into SQL fragments); no string concatenation into queries.
- **No XSS** — all `dangerouslySetInnerHTML` sites are JSON-LD, every one routed through `safeJsonLd()` (escapes `<`→`<` blocking `</script>` breakout, plus U+2028/U+2029) AND carrying a CSP nonce. OG cards rendered by Satori into images with shared `sanitizeForOg`.
- **No command injection** — only `spawn('mysqldump'|'mysql', [argArray])` (no shell), credentials via `MYSQL_PWD` env (not `/proc/cmdline`), minimal env (HOME excluded → no `~/.my.cnf`), `DB_NAME` from env not user input. stderr redacted via `sanitizeStderr` before logging.
- **No SSRF** — the only `fetch()` (`og-photo-fetch.ts`) targets `${self-origin}/uploads/jpeg/{server-generated-UUID-name}_{size}.jpg`; neither host nor filename is user-controllable; 10s timeout + 1 MB cap.
- **No `eval` / `new Function`.**

### Unicode / bidi / Trojan-Source / CSV
- `validation.ts` / `sanitize.ts` / `csv-escape.ts` — `UNICODE_FORMAT_CHARS` (no /g, for `.test()`) vs `_GLOBAL`/`_RE` (/g, for `.replace()`) split is deliberate (avoids stateful-lastIndex bug); one shared character set derived via `.source`; CSV formula-prefix guard tolerates leading whitespace AND strips ZWSP (which `\s` doesn't match). `safeInsertId` guards BigInt overflow. No ReDoS in any reviewed regex (simple character classes, no nested quantifiers).

### Rate-limiting / DoS
- `rate-limit.ts` — bounded Maps (eviction-capped); `getClientIp` trusts XFF only under `TRUST_PROXY`, hop-count-aware (selects client before trusted suffix), `net.isIP` validation, 512-char XFF cap, one-time misconfiguration warning. Public expensive surfaces (checkout/og/share/semantic/similar) all rate-limited (verified by `lint:public-route-rate-limit`); webhook + download exempt with documented signature/token-shape gates.

## Lint / type gate verification (invariants upheld in code, not just gate pass)
- `lint:api-auth` — exit 0; manual scan confirms EVERY `src/app/api/admin/**/route.ts` exports wrap `withAdminAuth`.
- `lint:action-origin` — exit 0; every mutating server action stores + early-returns `requireSameOriginAdmin()`.
- `lint:public-route-rate-limit` — exit 0; semantic + similar use the rate-limit helper; webhook carries the documented exempt tag.
- `typecheck` (app + scripts) — exit 0; the compile-time PII privacy guards hold.

## Rejected / Disproved candidates (NOT findings)
- **postcss XSS advisory (2× moderate)** — not runtime-reachable (build-time only over first-party CSS); documented repo false-positive; no non-breaking fix (next is latest stable major). NOT a finding.
- **og-photo-fetch SSRF** — origin is self-host, filename is server-generated UUID; not attacker-controllable. NOT a finding.
- **smart-collections JSON.parse proto-pollution** — parsed object walked field-by-field with explicit type narrowing; `__proto__`/`constructor` keys are never read as data and never assigned; values gated by `isScalarValue`. NOT a finding.
- **middleware not cryptographically validating the session cookie** — by design and documented; authoritative auth is `isAdmin()` / `withAdminAuth` at the action/route layer; a forged format-valid cookie fails there. NOT a finding.
- **ReDoS in sanitize.ts (REJ-2 prior)** — re-confirmed no nested quantifiers in `UNICODE_FORMAT_CHARS` / sanitizeStderr / normalizeIp / TOKEN_SHAPE_RE. NOT re-litigated.

## Narrow residuals carried (NOT new findings — reachability unverified / documented design)
- **RES-R7C2-01 / RES-R7C1-01 [INFO]** — `process-image.ts:1628-1634`: a structurally anomalous HEIC that defeats the lossless ISOBMFF scrubber cannot be re-encoded (prebuilt Sharp has no HEVC encoder), so the on-disk original retains GPS while the DB lat/lon columns are nulled. Only the paid-download route would stream the un-scrubbed original, and only for a genuinely malformed/hostile HEIC (normal iPhone HEIC files are handled correctly — locked by `strip-gps-from-original.test.ts`). The code logs at error level. **Same documented narrow residual as run-7 cycle-1; reachability still requires a real anomalous in-the-wild HEIC, which is not available in this environment to confirm. Not escalated to a new finding.**

## Commonly-missed sweep (all CLEAN)
- Timing attacks — constant-time everywhere (session, download token, admin token, password). ✓
- IDOR — similar/semantic enrichment returns only public columns for `processed=true` images; download/checkout gated by token/entitlement. ✓
- Missing authz — every admin route wrapped; every mutating action origin-guarded. ✓
- Log injection / secret-in-log — no plaintext secret logged except opt-in token path; stderr redacted; emails not logged at error level. ✓
- ReDoS — no vulnerable regex. ✓
- Open redirect — no dynamic redirect targets (only static `/admin` login). ✓
- Mass assignment — server-side insert objects built field-by-field, not spread from request body. ✓
- Header injection — no user input interpolated into response headers unsanitized (Content-Disposition extension sanitized). ✓
- Prototype pollution — no recursive merge of untrusted JSON; values type-narrowed. ✓
- Hardcoded secrets — none in source (heuristic grep clean). ✓

## Security Checklist
- [x] No hardcoded secrets
- [x] All inputs validated (codepoint length, Unicode strip, shape regexes, allowlists)
- [x] Injection prevention verified (SQL parameterized, no command shell, JSON-LD escaped)
- [x] Authentication/authorization verified (Argon2id, HMAC sessions, withAdminAuth, origin guards)
- [x] Dependencies audited (0 crit/high; 2 moderate non-reachable postcss false-positive)
