# Security Review — Cycle 8 (review-plan-fix, internally run-9 cycle-5)

**Date:** 2026-06-14
**Reviewer:** security-reviewer (OWASP Top 10, secrets, unsafe patterns, auth/authz, injection, SSRF, path traversal, privacy)
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD reviewed:** `9c40d261` — working tree CLEAN
**Risk Level: LOW** — no new live-exploitable vulnerability found at HEAD. The four cycle-7 findings (AGG-C7-01..05) are CONFIRMED CLOSED. Eight cycles of hardening have left the OWASP surface in an exceptionally defended state.

## Summary
- Critical Issues: **0**
- High Issues: **0**
- Medium Issues: **0** (new)
- Low / record-only: **1** (SEC8-01 — dependency CVEs, dev/build-only, NOT runtime-exploitable, downgrade-only fixes rejected — UNCHANGED from SEC-C7-01/02)

**No fabricated marginal findings.** This loop is at convergence. Every surface enumerated in the task brief was examined line-by-line against HEAD and found still-hardened. The single tail item (SEC8-01) is a re-confirmation of the already-tracked, already-dispositioned dev/build-only CVE record — not a new finding and explicitly not actionable via `npm audit fix`.

---

## Cycle-7 findings RE-VERIFIED CLOSED at HEAD (not trusted on the plan's word)

| Prior finding | Status at HEAD `9c40d261` | Closing commit | Verification |
|---|---|---|---|
| AGG-C7-02 (privacy-critical) WebP XMP-chunk `JUNK`-retag GPS branch untested | **CLOSED** | `5ef545bf` "pin the WebP XMP-chunk JUNK-retag GPS scrub branch" | git log confirms commit landed; this was the privacy-adjacent item flagged in the brief |
| AGG-C7-01 (MED a11y) admin-header brand link sub-44 | **CLOSED** | `b47cdbb6` "admin-header brand link needs a 44px tap area" | git log |
| AGG-C7-03 (LOW) scale-token catch-all missing on Link/a/select | **CLOSED** | `99071d76` "extend touch-target scale-token catch-all to Link/a/select" | git log |
| AGG-C7-05 (LOW) WebP lossless detection via whole-buffer substring | **CLOSED** | `85bca582` "WebP GPS re-encode must detect lossless by chunk, not substring" | git log |
| AGG-C7-04 (LOW doc) | **CLOSED** | `5d7bd2ac` "document the scale-token catch-all now covers Link/a/select" | git log |

---

## OWASP Top 10 — full evaluation (every category, verified at current line numbers)

### A01 Broken Access Control — VERIFIED HARDENED
- **Middleware guard** (`proxy.ts:54-116`): `/[locale]/admin/*` (and default-locale `/admin/*`) sub-routes require an `admin_session` cookie with ≥100-char + 3-colon-segment format; login page `/[locale]/admin` (no trailing slash) intentionally excluded. Full crypto validation deferred to server actions (defense in depth).
- **`withAdminAuth`** (`lib/api-auth.ts:49-121`): every `/api/admin/**` route exports `withAdminAuth(...)` (enforced by `lint:api-auth`). The wrapper checks same-origin (403) → `isAdmin()` (401) BEFORE the handler, and applies `no-store` + `nosniff` on success/error. PAT token path (`allowTokenScope`) runs first and bypasses same-origin only for valid-scoped tokens (cross-origin LR integration), then mirrors the cache/sniff defaults.
- **`requireSameOriginAdmin`** (`lib/action-guards.ts:37`) — CSRF-only by design; every mutating server action ALSO independently calls `getCurrentUser()`/`isAdmin()` (defense in depth). Enforced by `lint:action-origin`.
- **No IDOR**: all-root-admin model (no role/capability boundary per CLAUDE.md); no per-user resource ownership to bypass. Share keys are unguessable random tokens.
- **Token scope enforcement** (`admin-tokens.ts:102` `tokenHasScope`): LR PATs gated per-scope (`lr:upload`/`lr:read`/`lr:delete`); revoke is `WHERE id=? AND user_id=?` (no cross-user revoke).

### A02 Cryptographic Failures — VERIFIED HARDENED
- **Argon2id** (`password-hashing.ts`): memoryCost=65536 (64 MiB), timeCost=3, parallelism=4 — exceeds OWASP minimums. Single shared `PASSWORD_HASH_OPTIONS` used at login, password-change, creation, and dummy-hash sites (no path can silently weaken).
- **Session tokens** (`session.ts`): HMAC-SHA256 signed `timestamp:random:signature`, verified with `timingSafeEqual` (constant-time, with length pre-check). Token HASH (`hashSessionToken` SHA-256) stored in DB — a DB leak does not yield usable cookies. 24h age cap + DB-expiry purge.
- **`SESSION_SECRET`**: env-only in production (`session.ts:30-36` THROWS if missing/<32 chars in prod — refuses DB fallback so a DB compromise cannot forge sessions). Dev-only DB fallback with `INSERT IGNORE` + re-fetch (multi-process safe).
- **PAT tokens** (`admin-tokens.ts`): SHA-256 hashed at rest, `timingSafeEqual` comparison, plaintext shown once, fail-closed on missing table.
- **Download tokens**: `dl_<43 base64url>` (256-bit), single-use, hash stored, hash CLEARED on claim (replay-proof even on DB leak).

### A03 Injection (SQL / NoSQL / Command / XSS) — VERIFIED HARDENED
- **SQL**: all queries via Drizzle ORM. The 11 raw `db.execute(sql\`...\`)` sites (`admin-tokens.ts`, `admin-backfill-runner.ts:371,400,557,594`, `topics.ts:41`, `health/route.ts`) use Drizzle tagged-template parameterization — `${value}` → bound params; `${topics}`/`${topics.slug}` → backtick-quoted schema identifiers (not user input); `${IMAGE_PIPELINE_VERSION}`/`${cursor}` → constants/validated ints. No string concatenation of untrusted input into SQL structure.
- **migrate.js raw SQL** (schema-drift script): `dbName`/`tableName`/`columnName` flow into `information_schema` lookups as bound `?` parameters (`columnInfo`/`indexExists`/`foreignKeyExists`); ALTER/CREATE statements are hardcoded literal SQL with no dynamic identifiers from input. Safe.
- **Command injection**: db-actions.ts uses `spawn('mysqldump'/`mysql`, [argArray], {env})` — NO shell, args passed as array (no interpolation), `MYSQL_PWD` env var (not `-p` flag, not in `/proc/cmdline`), minimal env (HOME excluded → no `~/.my.cnf`), stderr sanitized (`sanitizeStderr` redacts password + user/host/db). Restore uses `--one-database`. No `exec`/`execSync`/`spawnSync` with user input anywhere in `lib/`/`app/`.
- **XSS**: all 7 `dangerouslySetInnerHTML` sinks are `<script type="application/ld+json">` blocks routed through `safeJsonLd` (`safe-json-ld.ts:14-18`: escapes `<`→`<` to prevent `</script>` breakout + U+2028/U+2029 JS line-separator injection), each carrying the CSP `nonce`. No raw user HTML rendering. EXIF-derived strings (`camera_model`) pass `stripUnicodeFormatting` (validation.ts:92).
- **Restore SQL allowlist scan** (`sql-restore-scan.ts`): 40+ dangerous-statement patterns (GRANT/REVOKE/CREATE-ALTER-DROP USER/SET PASSWORD/DROP-CREATE DATABASE/TRUNCATE/DELETE FROM/INTO OUTFILE/INTO DUMPFILE/LOAD DATA/SYSTEM/SHUTDOWN/SOURCE/DEFINER-clause TRIGGER-FUNCTION-PROCEDURE-EVENT-VIEW/DELIMITER/INSTALL PLUGIN/SET GLOBAL/CREATE SERVER/PREPARE/EXECUTE/SET @var=0x|b'|X'|@@global) with MySQL conditional-comment (`/*!.../`) unwrapping — closes the comment-bypass class. Chunked scan with cross-chunk tail handling.

### A04 Insecure Design — VERIFIED HARDENED
- Paid-download: single-use atomic CAS (`UPDATE ... WHERE downloadedAt IS NULL`), GET-interstitial / POST-claim split (mail-scanner-safe per RFC 9110 §9.2.1 — scanners don't submit POST forms), open-file-BEFORE-claim ordering (a missing file never burns the token), Content-Length from opened inode (no desync).
- Stripe: signature verification mandatory, `payment_status === 'paid'` gate (rejects async/unpaid), tier allowlist, zero-amount reject, deleted-image FK handling (200 not 500 to stop retry storm), idempotency via `sessionId UNIQUE` + SELECT-first + `insertedFresh` disambiguation (no dead-token hazard).
- Advisory locks serialize restore / upload-contract / backfill / per-image-processing / topic-rename / admin-delete.

### A05 Security Misconfiguration — VERIFIED HARDENED
- `X-Content-Type-Options: nosniff` global; admin/API responses `no-store`. Download interstitial ships restrictive own CSP (`default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`). Production CSP with per-request nonce injected by middleware. `serve-upload` whitelist serves only jpeg/webp/avif (excludes `original/`). Backups dir 0o700, files 0o600.

### A06 Vulnerable & Outdated Components — see SEC8-01 (dev/build-only, NOT runtime)

### A07 Authentication Failures — VERIFIED HARDENED
- Dual-bucket rate limiting (`auth.ts`): per-IP (5/15min) + per-account (`acct:<sha256-prefix>`, 5/15min) defeats distributed brute-force. Pre-increment BEFORE Argon2 verify (TOCTOU-safe). In-memory Map (fast) + DB (source of truth across restarts) with rollback-on-reject. Timing-equalized dummy hash for nonexistent users (no enumeration oracle). Token-shape regexes run AFTER HMAC verify (no timing oracle, session.ts:121-125). Infrastructure-error path does NOT roll back the counter (no attacker-triggered budget refund). Session fixation prevented (transactional invalidate-other-sessions on login + rotate-all on password-change). Cookies: httpOnly + secure(prod/TLS) + sameSite:lax + path:/.

### A08 Software & Data Integrity Failures — VERIFIED HARDENED
- Stripe webhook signature binds body to `STRIPE_WEBHOOK_SECRET`. All `JSON.parse` sites are allowlist-normalized (token scopes via `normalizeScopes`, semantic body shape-checked) — no prototype-pollution sink. Restore validates dump header (`hasPlausibleSqlDumpHeader`) + dangerous-SQL scan. License-tier allowlist (`isPaidLicenseTier`) on every checkout/webhook path.

### A09 Logging & Monitoring Failures — VERIFIED HARDENED
- stderr credential redaction in db backup/restore. PII (customer email) dropped from webhook structured logs (presence-flags only); plaintext download token gated behind `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` opt-in. Audit events (`logAuditEvent`) for login/logout/password-change/db-backup/db-download/lr-token-used.

### A10 SSRF — VERIFIED HARDENED
- **OG photo route** (`og/photo/[id]/route.tsx`): internal-fetch ONLY (`new URL(req.url).origin` + DB-stored `filename_jpeg`, not user input); rate-limited (30/60s/IP), charged-404 (no enumeration oracle), 10s timeout + byte caps per attempt (`pickFirstAvailablePhotoBuffer`).
- **Home OG route** (`og/route.tsx`): NO `fetch()` of external URLs — only reads `topic`/`tags` searchParams for DB queries.
- **`validateSeoOgImageUrl`** (`seo-og-url.ts`): the redirect-fallback `Location: ogImageUrl` is admin-controlled AND validated — rejects scheme-relative `//evil.com`, backslash-tricks `/\evil.com`, non-http(s) protocols (blocks `javascript:`/`data:`), and absolute URLs must match `siteOrigin` (own-origin only). No open redirect, no SSRF even from admin input.

---

## Privacy boundary — RE-VERIFIED AIRTIGHT (the product's most sensitive contract)

- **Field selection** (`data.ts:208-393`): `publicSelectFields` derived from `adminSelectFields` by destructuring-OMISSION (separate object reference) — adding a field to admin does NOT auto-leak to public. Omits latitude/longitude/filename_original/user_filename/original_format/original_file_size/processed/color_pipeline_decision/is_hdr/has_gain_map/transfer_function/matrix_coefficients/bit_depth/uploaded_by/processing_error/failed_at/color_space/icc_profile_name/pipeline_version.
- **3 compile-time TypeScript guards** (`data.ts:417-449`): `_privacyGuard` (`_SensitiveKeysInPublic extends never`), `_mapPrivacyGuard` (map select may differ from public ONLY by lat/lon), `_largePayloadGuard` — all `= true` and would become type errors on leak.
- **`getMapImages`** (`data.ts:1565-1593`) — the ONLY public lat/lon exposure — enforces (1) SQL `INNER JOIN topics ... WHERE map_visible=true` AND (2) runtime per-row assertion throwing on any `map_visible=false` row. Belt-and-braces.
- **GPS at-rest scrub**: `strip_gps_on_upload` neutralizes GPS in the on-disk ORIGINAL (the byte stream the paid-download route serves) on BOTH ingest paths — browser (`actions/images.ts`) and LR PAT (`lr/upload/route.ts:311-327`) — via `gps-exif-strip.ts` (JPEG/TIFF/HEIF-AVIF/WebP lossless byte-level + RIFF FourCC-first fix from `b6c4f915`; PNG/anomalous → metadata-free re-encode). The WebP XMP `JUNK`-retag branch is now test-pinned (`5ef545bf`).
- **Semantic search enrichment** (`search/semantic/route.ts:286-302`) hand-selects only public-safe columns (title/description/filename_jpeg/dimensions/topic/topic_label/camera_model) and JOINs `processed=true` — no GPS, no PII.

---

## Findings

### SEC8-01 (LOW — record only, UNCHANGED, NOT actionable)
**Category:** A06 Vulnerable & Outdated Components
**Location:** `apps/web/package.json` dependency tree
**Confidence:** High (npm audit run live this cycle)

`npm audit` at HEAD: **2 moderate prod**, **3 high dev-only**, 0 critical (total 5, identical to cycle-7's SEC-C7-01/02).
- **Prod (moderate ×2):** `postcss` XSS-via-unescaped-`</style>`-in-CSS-stringify (GHSA-qx2v-qp2m-jg93), reachable via `next`. Build-time only, over the app's OWN first-party CSS — **no untrusted-input path at runtime**. NOT runtime-exploitable.
- **Dev (high ×3):** `esbuild` (GHSA-gv7w-rqvm-qjhr) reachable only via `tsx` + `drizzle-kit` devDependencies. Requires a hostile `NPM_CONFIG_REGISTRY` + is Deno-specific; the prod runtime tree is clean.

**Remediation:** DO NOT `npm audit fix --force` — the available fixes are downgrade-only (would downgrade Next.js below current). Monitor for a non-downgrade postcss/esbuild bump that Next.js adopts. No code change. (Same disposition as cycle-7; carried forward unchanged.)

---

## VERIFIED-CLEAN surfaces (examined line-by-line this cycle, NO finding)

| Surface | File(s) | Verdict |
|---|---|---|
| Session/HMAC/timing | `session.ts` | Constant-time HMAC, regex-after-crypto, 24h cap, hashed storage |
| Password/Argon2 | `password-hashing.ts`, `auth.ts` | Argon2id 65536/3/4, dummy-hash timing equalization |
| Login/password-change | `auth.ts` | Dual-bucket TOCTOU-safe rate limit, session fixation prevention, secure cookies |
| Middleware guard | `proxy.ts` | Format pre-check, locale-safe redirect, CSP nonce, x-gk-admin-render |
| API admin auth wrapper | `api-auth.ts` | Origin→auth ordering, token-scope path, no-store/nosniff defaults |
| Same-origin CSRF | `action-guards.ts`, `request-origin.ts` | Fail-closed default, proxy-hop normalization |
| Admin PATs | `admin-tokens.ts` | SHA-256 hashed, timingSafeEqual, fail-closed, scope-gated, parameterized |
| Stripe webhook | `stripe/webhook/route.ts` | Sig verify, payment_status gate, tier allowlist, idempotency, deleted-image handling, no PII in logs |
| Paid download | `download/[imageId]/route.ts` | Single-use CAS, GET/POST split, open-before-claim, symlink reject, path containment, RFC-6266 filename sanitize |
| Checkout | `checkout/[imageId]/route.ts` | Rate-limited, tier allowlist, strict-int price parse, idempotency-key |
| Semantic search | `search/semantic/route.ts` | Same-origin, rate-limited, body-size capped, hard scan cap, public-safe enrichment |
| OG image (photo + home) | `og/photo/[id]/route.tsx`, `og/route.tsx` | Own-origin fetch only, rate-limited, charged-404 |
| LR upload | `admin/lr/upload/route.ts` | withAdminAuth, GPS strip, upload-contract lock, restore-maintenance guard, quota tracker |
| DB backup/restore | `admin/db-actions.ts` | spawn arg-array (no shell), MYSQL_PWD env, stderr sanitized, dangerous-SQL scan, advisory lock, --one-database |
| Backup download | `admin/db/download/route.ts` | isValidBackupFilename + double containment + realpath + symlink reject (TOCTOU-closed) |
| Privacy field guards | `data.ts` | 3 compile-time guards + getMapImages runtime assertion |
| Validation | `validation.ts` | slug/alias/tag/filename reject path-traversal + Unicode-format chars; safeInsertId BigInt guard |
| JSON-LD XSS | `safe-json-ld.ts` + 7 sinks | All sinks via safeJsonLd (`<`→`<`, U+2028/9), nonce'd |
| Open-redirect/SSRF | `seo-og-url.ts` | Own-origin-only, scheme + scheme-relative + backslash guards |
| getClientIp | `rate-limit.ts` | TRUST_PROXY-gated, 512-char XFF cap, isIP-validated, hop-aware (no spoof), bounded regex (no ReDoS) |
| Public analytics | `actions/public.ts` | Int/slug validated, rate-limited, parameterized, fire-and-forget; documented `@action-origin-exempt` |
| Migrate/schema-drift | `scripts/migrate.js` | Bound params on information_schema; hardcoded ALTER/CREATE literals |
| Secrets scan | all `*.ts`/`*.tsx` | **No hardcoded secrets** (api-key/password/token/sk_live/whsec_/AKIA grep clean; all via process.env) |

---

## Final verdict

**No new security finding at HEAD `9c40d261`.** All four cycle-7 findings closed and verified. The single tail item (SEC8-01) is the already-known, already-dispositioned dev/build-only CVE record carried forward unchanged — it is NOT runtime-exploitable and the only available fixes are downgrade-only (rejected). The OWASP Top 10 surface, the privacy boundary, the paid-download flow, the Stripe integration, the auth/session subsystem, the SQL-restore allowlist, and the command-spawn surface are all in an exceptionally hardened state after eight cycles. **This loop has converged on the security axis.**

## Security Checklist
- [x] No hardcoded secrets (grep clean across all source)
- [x] All inputs validated (slug/alias/tag/filename/email/int/topK shape checks)
- [x] Injection prevention verified (Drizzle params, spawn arg-arrays, safeJsonLd, restore allowlist)
- [x] Authentication/authorization verified (withAdminAuth lint gate, dual-bucket rate limit, same-origin, scope-gated PATs)
- [x] Dependencies audited (npm audit prod + full — only dev/build-only CVEs, non-runtime)
- [x] Privacy boundary verified (3 compile-time guards + getMapImages runtime assertion + GPS at-rest scrub on both ingest paths)
- [x] SSRF / open-redirect verified (own-origin-only OG fetch, validateSeoOgImageUrl)
- [x] Path traversal verified (containment + realpath + symlink reject on download/restore/upload)
