# Security Review — run-7 cycle-6

**Agent:** security-reviewer (OWASP angle, fresh skeptical rebuild)
**HEAD:** 1463f219 (source tree byte-identical to converged cycle-5 source HEAD e855e6ee — `git diff e855e6ee HEAD -- apps/web/src apps/web/scripts apps/web/drizzle` is EMPTY; the only commits since are docs + a SW version-stamp)
**Risk Level:** LOW
**Outcome:** 0 new actionable findings — truthful zero.

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0 new
- `npm audit --omit=dev`: 2 MODERATE, 0 CRITICAL/HIGH (carried, not new — see below)

The attack surface was rebuilt from scratch this cycle (not diffed against prior reviews). Every OWASP-relevant surface was re-read and re-reasoned. All defenses are intact, all three security lint gates pass, and the security-contract test suite is green (105/105 deterministic). This is the expected and correct converged-state result.

## npm audit (prod deps)
```
postcss <8.5.10  (MODERATE) — XSS via unescaped </style> in CSS Stringify output
  └─ only at node_modules/next/node_modules/postcss (8.4.31, BUNDLED inside Next 16.2.6)
2 moderate severity vulnerabilities; 0 critical, 0 high
```
**Assessment — not actionable / not new.** The project's OWN direct dependency `postcss` is already 8.5.10 (patched, both root `package.json:9` and `apps/web/package.json:80`). The flagged copy is Next.js's internal build-time `postcss` (8.4.31), used by Next's CSS pipeline at build/stringify time — it does not process runtime user input in this app. The only remediation `npm audit fix --force` offers is a downgrade to `next@9.3.3` (a catastrophic breaking change). The fix arrives when Next bumps its bundled postcss; tracking upstream is the correct posture. Severity is MODERATE, below the crit/high report bar, and it has been present every prior cycle (carried).

## Verified-clean surfaces (rebuilt this cycle)

### A01 Broken Access Control / CSRF
- `lib/api-auth.ts` `withAdminAuth`: enforces `hasTrustedSameOrigin` (CSRF) THEN `isAdmin()` on the cookie path; token path requires a valid PAT with the exact `allowTokenScope` (intentional same-origin bypass for cross-origin Lightroom PAT integration). Adds no-store + nosniff defaults on both auth paths. Token path returns 401 on present-but-invalid token (no fall-through to cookie path).
- `lint:api-auth` (`scripts/check-api-auth.ts`): PASSES. AST scanner rejects function-declaration, class-declaration, and aliased HTTP-method exports; unwraps `as`/`satisfies`/parenthesized/type-assertion before matching `withAdminAuth(...)`; covers route.ts/tsx/js/mjs/cjs. Both admin routes (`db/download`, `lr/upload`) confirmed wrapped. Not bypassable via any export form I could construct.
- `lint:action-origin` (`scripts/check-action-origin.ts`): PASSES. Recursive discovery over `app/actions/**` + hard-coded `db-actions.ts`; requires the `requireSameOriginAdmin()` result to be STORED and RETURNED-on-early (bare/ignored calls rejected); rejects `@action-origin-exempt` on mutating bodies; detects pre-guard mutations (mutation-before-guard ordering); rejects aliased exports. `auth`/`public` basename exemptions are justified (own same-origin handling / intentional anonymous read surface).
- `lib/request-origin.ts`: fails closed (no Origin AND no Referer → reject) by default; `X-Forwarded-*` only trusted under `TRUST_PROXY=true` and reads the right-most (trusted-hop) value; default-port normalization is correct.
- `proxy.ts` middleware admin guard + per-action `isAdmin()` defense-in-depth (documented).

### A02 Cryptographic Failures
- `lib/password-hashing.ts`: Argon2id, memoryCost 65536 (64 MiB), timeCost 3, parallelism 4 — exceeds OWASP minimums. Shared policy object used by login/change/create/seed so no path can skew.
- `lib/session.ts`: HMAC-SHA256; `timingSafeEqual` with length pre-check (no throw); shape regexes applied AFTER crypto verify (no timing oracle); 24h age window (rejects negative age); session token stored as sha256 hash (DB leak ≠ usable cookie); production REFUSES DB-fallback secret (env-only signing key, separate trust domain); 128-bit random + ≥32-byte secret.
- `lib/admin-tokens.ts` (PAT): `gk_`+base64url(32B); sha256-hashed storage; constant-time `tokenHashesEqual`; well-formed-shape gate before DB; hash-based lookup (no plaintext in query logs); fails closed if table absent; scopes via allowlist (`normalizeScopes`); all raw SQL is Drizzle `sql` template parameterization.
- `lib/download-tokens.ts` (paid download): 256-bit token, sha256-hashed storage, `timingSafeEqual` constant-time verify, shape gate (`dl_`+43 base64url) + stored-hash shape gate (64-char lowercase hex) before any buffer work.

### A03 Injection
- SQL: application queries use Drizzle ORM parameterization. Reviewed every `sql\`...${...}\`` interpolation in data.ts, smart-collections.ts, data-timeline.ts, admin-tokens.ts, sharing.ts, auth.ts, tags.ts — every interpolated VALUE is parameterized (`${count}`, `${year}`, `${pred.value}`, `${presentedHash}`, `inArray`) and every interpolated IDENTIFIER is a Drizzle column ref or table object (compiled, never attacker-string). `smart-collections.ts` resolves `col` from a static `ALLOWED_COLUMNS` map (`isAllowedDirectColumn` allowlist) — column names cannot be attacker-controlled. No `sql.raw` with untrusted input. No `child_process` exec with concatenated input (db-actions `spawn('mysqldump'/'mysql', [argv-array])` uses fixed argv + `MYSQL_PWD` env, never a shell string).
- XSS (JSON-LD): all `dangerouslySetInnerHTML` JSON-LD sites use `safeJsonLd()` which escapes `<`→`<` (defeats `</script>` breakout) + U+2028/U+2029, AND carry a CSP `nonce`. Admin-controlled strings additionally pass `validation.ts` Unicode-formatting rejection + `og-sanitize` defense-in-depth.
- LIKE wildcard abuse: `%`/`_`/`\` escaped at search (`smart-collections.ts` contains/tag predicates, search path).

### A04/A05 Insecure Design / Misconfiguration
- Global `X-Content-Type-Options: nosniff`; restrictive per-route CSP on the download interstitial (`default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`); no-store on all admin/paid responses; production-required SESSION_SECRET; runtime pinned to `nodejs` on every Node-bound route.

### A06 Vulnerable Components
- See npm audit above — 0 crit/high.

### A07 Auth Failures
- Login rate limiting: per-IP (5/15min) + per-account (`acct:<sha256-prefix>`, 5/15min) bounded Maps with DB backup (`auth-rate-limit.ts` + `rate-limit.ts`); rollback-on-infra-error (decrement, not delete, for concurrency safety); password-change bucket decoupled from login.

### A08 Integrity Failures
- Stripe webhook (`api/stripe/webhook/route.ts`): MANDATORY signature verification (`constructStripeEvent`) before ANY DB work — forged/unsigned → 400 in constant time; `payment_status==='paid'` gate (async-unpaid → documented no-op); tier allowlist; strict integer imageId; zero-amount reject; oversized-email reject-before-truncate; idempotency via sessionId UNIQUE + SELECT-first + ON DUPLICATE KEY UPDATE + insertId>0 fresh-insert disambiguation (dup-key loser never logs a dead plaintext token); deleted-image → 200 + manual-refund log (no Stripe retry storm).
- Checkout (`api/checkout/[imageId]`): card-only pin (`payment_method_types:['card']`) closes the money-taken-no-goods async-payment gap; per-IP rate limit (Pattern-2 rollback); strict `/^\d+$/` price parse; code-point-safe title truncation.

### A09 Logging Failures
- Structured-object logs with correlation keys (sessionId/imageId/entitlementId); PII (customer email) deliberately not logged at error level; `LOG_PLAINTEXT_DOWNLOAD_TOKENS` opt-in gated; audit-log inserts on PAT upload.

### A10 SSRF
- No outbound-URL-from-user-input surface. Stripe SDK targets fixed Stripe endpoints; CLIP weights load OFFLINE (`allowRemoteModels=false`).

### File-upload / path-traversal (deep)
- `lib/serve-upload.ts`: `ALLOWED_UPLOAD_DIRS` {jpeg,webp,avif} whitelist + `SAFE_SEGMENT` `/^[a-zA-Z0-9._-]+$/` + explicit `.`/`..`/empty/over-length rejection + extension-matches-dir check + `lstat` symlink rejection + `realpath` containment with `${resolvedRoot}${path.sep}` prefix (closes `/upload-evil` prefix-confusion).
- `api/download/[imageId]`: `path.resolve` + `startsWith(uploadsDir+sep)` + lstat symlink reject + parallel realpath containment + open-BEFORE-atomic-claim ordering (token never burned on missing file); Content-Disposition extension sanitized + RFC 6266/5987 encoded.
- `api/admin/lr/upload`: `getSafeUserFilename` (basename, control/format-char reject, UTF-8 byte budget), slug validation, `sanitizeAdminString`, code-point length caps, HDR-ingest gate, GPS strip, disk pre-check, upload tracker (idempotent settle), contract lock (finally-release).
- `api/admin/db/download`: `withAdminAuth` + `isValidBackupFilename` + containment + lstat symlink reject + TOCTOU-closed realpath streaming + audit log.

### PII guards
- `lib/data.ts`: `adminSelectFields` (full, with lat/lng/filename_original/user_filename) → `publicSelectFields` derived by explicit destructuring-omission (separate object reference, not shared); `_SensitiveKeysInPublic` compile-time guard fails `tsc` if a sensitive key ever lands in public set; `publicMapSelectFields` is the sole lat/lng exposure (map markers, by design). `privacy-fields.test.ts` locks `SENSITIVE_KEYS`.

### Sanitizers (Unicode / Trojan-Source / CSV / OG)
- `lib/validation.ts` `containsUnicodeFormatting`/`UNICODE_FORMAT_CHARS`: rejects bidi overrides (U+202A-202E, U+2066-2069) + zero-width/invisible (U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB) on every admin string surface.
- `lib/csv-escape.ts`: formula-injection (`=`/`+`/`-`/`@` with leading-WS tolerance) + C0/C1 strip + bidi/zero-width strip.
- `lib/og-sanitize.ts` `sanitizeForOg`: shared by both OG routes + JSON-LD page (bidi/zero-width + C0 strip before Satori render).
- `lib/safe-json-ld.ts`: `<`→`<` + U+2028/U+2029 escape.

## Carried items (re-checked, NO new evidence to escalate)
- **RES-R7C5-01** (HEIC GPS-strip fall-through, `gps-exif-strip.ts`): reachability still UNVERIFIED. I did not produce a real iPhone .heic fixture returning null from `stripGpsFromIsobmffBuffer`, nor a production log hit. No NEW reachability evidence → remains a carried residual, not escalated. (Per task instruction, escalate only on new reachability evidence.)
- **REJ-R7C3-01** (gps-exif indexSize): remains DISPROVED — not re-filed.
- **R7C1-CR-01, OBS-R7C2-03/04**: carried deferrals, no new evidence → not re-raised.

## Lint gates + tests (evidence)
- `lint:api-auth` → PASS
- `lint:action-origin` → "All mutating server actions enforce same-origin provenance."
- `lint:public-route-rate-limit` → PASS (webhook + download carry justified `@public-no-rate-limit-required`; semantic uses rate-limit helper; OG/similar are non-mutating GET)
- Security-contract tests (privacy-fields, check-api-auth, check-action-origin, check-public-route-rate-limit, csv-escape, og-sanitize, sanitize-for-og-global, checkout-route): **105/105 PASS** (deterministic)
- Full suite: 238 files / 2240 tests PASS on clean re-run (a first run showed 3 flaky failures, all in Sharp/libvips AVIF-decode fixtures under parallel load — `process-image-orientation.test.ts` "unsupported image format" — environmental, not security; re-run green)

## Security Checklist
- [x] No hardcoded secrets (env-only SESSION_SECRET; PATs/session/download tokens hashed at rest)
- [x] All inputs validated (slug/email/title/token shapes, code-point lengths, body-size/content-type/chunked guards)
- [x] Injection prevention verified (Drizzle parameterization, ALLOWED_COLUMNS allowlist, LIKE escaping, safeJsonLd, no shell-string exec)
- [x] Authentication/authorization verified (withAdminAuth + same-origin + 3 lint gates pass)
- [x] Dependencies audited (0 crit/high; 2 carried moderate in Next-bundled postcss)
