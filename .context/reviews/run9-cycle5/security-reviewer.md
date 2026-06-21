# Security Review Report — run-9 cycle-5

**Agent:** security-reviewer
**HEAD:** e34c04cf5c9f2133766dc4284bc2c473a95e3111
**Scope:** Whole-repo OWASP-Top-10 review (auth chain, api/admin/** + public routes, app/actions/**, file upload/serve, DB restore/backup, SQL construction, rate-limit, sanitizers, privacy gating, ISOBMFF/ICC/GPS binary parsers, the 3 security lint scanners).
**Risk Level:** LOW (no exploitable surface found)

## Summary

- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- **Genuine DEFECTs: 0 — CONVERGENCE**

Since run-8 convergence (f63af3b9) the only production-source changes are two aria-label fixes (`bulk-edit-dialog.tsx`, `similar-photos.tsx`); the diff touches no security-relevant logic. The full security surface re-audited this cycle is unchanged from prior CLEAN adjudications and continues to hold a high bar with deep defense-in-depth.

## Security lint validation (explicit task)

All three security lints are AST-based (TypeScript compiler API), not regex, and verified to enforce their claims at the code level. All three run GREEN against current source.

| Lint | Enforcement verified | Fail-closed posture |
|---|---|---|
| `lint:api-auth` (`scripts/check-api-auth.ts`) | Every HTTP-method export in `api/admin/**` must be `NAME = withAdminAuth(...)`. Rejects function/class declarations (L131-135), aliased `export {}` (L103-110), and non-`withAdminAuth` initializers (L64-73, unwraps paren/as/satisfies). | A file exporting NO handler fails "does not export any HTTP handlers" (L138-141). |
| `lint:action-origin` (`scripts/check-action-origin.ts`) | Requires a `const x = requireSameOriginAdmin()` guard var (L116-132), early `return` on it (L158-172), AND no mutating call before the guard (L219-221, 238). Rejects `@action-origin-exempt` on a body containing a mutating call (L289-294). Rejects aliased exports (L315-323). Recursive discovery of `actions/**` + hard-coded `db-actions.ts`. | Missing guard / missing body / pre-guard mutation all fail. |
| `lint:public-route-rate-limit` (`scripts/check-public-route-rate-limit.ts`) | Public POST/PUT/PATCH/DELETE handlers must import a rate-limit module or call `preIncrement*`/`checkAndIncrement*`, or carry `@public-no-rate-limit-required`. Strips strings (L135-138) + comments (L147-149) before matching; ignores commented-out imports (L162-167); `export *` fails closed (L91-96). | **Documented gap: GET handlers are NOT scanned.** Manually audited below. |

**GET-route gap (documented, manually audited):** the only expensive public GET surfaces are `api/og/route.tsx`, `api/og/photo/[id]/route.tsx`, and `api/search/similar/[id]/route.ts`. All three are independently rate-limited (`preIncrementOgAttempt` / `preIncrementSemanticAttempt`) and same-origin-gated where applicable. No unmetered expensive public GET exists. The gap is covered by code, not lint.

## OWASP Top 10 coverage

- **A01 Broken Access Control:** `withAdminAuth` centrally enforces token-scope OR (same-origin + `isAdmin()`) on every `api/admin/**` route (`api-auth.ts`). Server actions enforce `requireSameOriginAdmin()` + `isAdmin()` (lint-gated). Middleware `proxy.ts` guards `/[locale]/admin/*`. Last-admin deletion blocked atomically via `GET_LOCK` + `COUNT(*) <= 1` (`admin-users.ts:219-231`); self-delete blocked (L194). Public read actions intentionally anonymous + rate-limited. **CLEAN.**
- **A02 Cryptographic Failures:** Argon2id (64 MiB / t=3 / p=4). Sessions HMAC-SHA256 + `timingSafeEqual` BEFORE shape assertions (no timing oracle — `session.ts:110-125`). Production refuses DB-stored secret fallback (`session.ts:30-36`). PATs SHA-256-hashed at rest, `timingSafeEqual` re-compare (`admin-tokens.ts:64-73`). Session/token storage hashed so DB compromise yields no usable credentials. **CLEAN.**
- **A03 Injection:**
  - SQL: All app queries Drizzle-parameterized. Only raw SQL is `sql\`SELECT 1\`` (health check, no input). Smart-collections compiler (`smart-collections.ts`) is the lone admin-input→SQL surface and is airtight: column allowlist, depth cap (4), scalar-value enforcement rejecting objects/arrays/null/NaN that mysql2 would expand into SQL fragments (L327-329), LIKE-escaping, IN-cardinality cap (100), per-column operator narrowing, parameter binding throughout.
  - Command: `spawn('mysqldump'|'mysql', [argArray], {env})` — no shell, credentials via `MYSQL_PWD`/`MYSQL_USER` env (never `/proc/cmdline`), `HOME` excluded (no `~/.my.cnf`).
  - Path: `serve-upload.ts` enforces `SAFE_SEGMENT` regex, `..`/`.` rejection, extension↔dir map, `lstat` symlink rejection, `realpath` containment under `UPLOAD_ROOT` (TOCTOU-closed by streaming from the resolved path).
  - Formula/CSV: `csv-escape.ts` (prior CLEAN) escapes `= + - @`, strips C0/C1, bidi, zero-width.
  - XSS: JSON-LD via `safe-json-ld.ts` escapes `<` (blocks `</script>` breakout) + U+2028/2029. OG cards via `sanitizeForOg` (bidi/zero-width/C0 strip). Admin string fields reject Unicode-format chars at validation.
  - SQL-restore: `sql-restore-scan.ts` strips comments/string/hex/binary literals + extracts conditional-comment bodies BEFORE matching ~40 dangerous-statement patterns; whole-file chunked scan with 1 MB tail overlap so boundary-straddling statements are caught. **CLEAN.**
- **A04 Insecure Design:** Single-writer topology documented; advisory locks (restore, upload-contract, backfill, per-image, admin-delete) serialize correctly. Charged-404 rate-limit policy (Pattern 4) prevents enumeration oracles on OG routes. **CLEAN.**
- **A05 Security Misconfiguration:** `X-Content-Type-Options: nosniff` global + per-route; admin responses `no-store`; derivatives `must-revalidate` (deliberate, not immutable). `stripDefaultPort` correctly normalizes proxy hosts. **CLEAN.**
- **A06 Vulnerable Components:** No findings in app code. Dependency CVE scan deferred to repo CI (`npm audit` not run in this read-only pass; no new deps added since run-8).
- **A07 Auth Failures:** Login rate-limit dual-bucket (per-IP + per-account `acct:<sha256>`), bounded Maps + DB backup, Pattern-1 no-rollback on infra error (prevents attacker extra attempts). Token age cap 24 h. PAT expiry enforced. **CLEAN.**
- **A08 Integrity Failures:** No unsafe deserialization. `JSON.parse` outputs structurally validated (smart-collections `validateNode`, semantic body shape check, token `parseScopes` filtered against allowlist). No `eval` / `new Function` / dynamic `require`. **CLEAN.**
- **A09 Logging Failures:** Audit events on backup/restore/CSV/upload/user-delete. `sanitizeStderr(data, DB_PASSWORD, [DB_USER,DB_HOST,DB_NAME])` redacts secrets from mysqldump/mysql stderr. No secret values logged (session.ts logs a message, not the secret). **CLEAN.**
- **A10 SSRF:** `og-photo-fetch.ts` internal fetch pins origin to trusted `siteConfig.url` (`route.tsx:111-116`), fixed `/uploads/jpeg/` path, filename is a DB-sourced `crypto.randomUUID()` derivative; 10 s timeout + 1 MB cap per attempt. No user-controlled URL reaches any fetch. **CLEAN.**

## Binary parsers (defense-in-depth, admin-only-upload paths)

A subagent flagged candidate memory-safety issues in `color-detection.ts`, `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`, `gps-exif-strip.ts`. **Every flag was verified false** by reading the exact lines — the subagent consistently missed the preceding bounds checks:

- `icc-extractor.ts:99` `readUInt32BE(recOffset+4)` — guarded by `recOffset+12 > iccLen` break at L93; whole fn in try/catch (L122). NOT a defect.
- `gain-map-detection.ts:203/206` refCount read/loop — guarded by `inner+idSize+2 > innerEnd` (L196), loop hard-capped `i < 1024` + `inner+idSize > innerEnd` break (L207). NOT a defect.
- `gps-exif-strip.ts` IFD-chain "infinite loop" / "integer overflow" — `MAX_IFD_CHAIN` cap + `visited` Set cycle-detection (L158-160); every offset gated by `inBounds()` before read/fill; values bounded by 0xFFFFFFFF + tiffStart << 2^53 (no precision loss). NOT a defect.
- `color-detection.ts`, `icc-chromaticity.ts` — confirmed clean (MAX_DEPTH/MAX_SCAN_BYTES + per-read length checks).

All five parsers have hard iteration + byte-budget caps and length-checked multi-byte reads; no regex over attacker input with nested quantifiers.

## Privacy / PII gating

`adminSelectFields` (full) → `publicSelectFields` (derived by explicit omission of `latitude`, `longitude`, `filename_original`, `user_filename`, `original_format`, `original_file_size`, `processed`) as a separate object reference; `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` compile-time guards intact. GPS is exposed ONLY via `publicMapSelectFields` through `getMapImages`, which is double-gated: SQL `INNER JOIN ... eq(topics.map_visible, true)` + runtime per-row assertion refusing GPS for `map_visible=false`. Default `map_visible=false`; flipping it requires an authenticated, origin-gated admin action. **CLEAN.**

## Not re-filed (per directive)

ARCH-R7C2-01/TE-R7C2-02 (Stripe, CLOSED), RES-R7C6-01 (HEIC GPS residual, CLOSED), REJ-R7C3-01 (gps-exif indexSize, DISPROVED), CSP nonce reuse / session off-by-one (REFUTED). No carried deferrals met new-evidence exit criteria.

## Verification evidence

- `npx tsx scripts/check-api-auth.ts` → OK (2 admin routes)
- `npx tsx scripts/check-action-origin.ts` → "All mutating server actions enforce same-origin provenance."
- `npx tsx scripts/check-public-route-rate-limit.ts` → OK (all public routes)
- `vitest run check-api-auth + check-action-origin + check-public-route-rate-limit + privacy-fields + sql-restore-scan` → 77/77 passed

## Security Checklist

- [x] No hardcoded secrets (env-var sourced; stderr redacted)
- [x] All inputs validated (slug/integer/codepoint/scalar/JSON-shape)
- [x] Injection prevention verified (SQL/path/command/formula/XSS)
- [x] Authentication/authorization verified (central wrapper + lint-gated actions + middleware)
- [x] Rate-limit on all expensive public surfaces (incl. GET routes not covered by lint)
- [x] SSRF closed (origin-pinned internal fetch)
- [x] Privacy/PII gating intact (compile-time guards + double-gated map GPS)
- [x] Binary parsers bounds-checked (subagent false positives refuted)
- [ ] Dependencies audited — deferred to repo CI (no new deps since run-8)

**Verdict: ZERO genuine DEFECTs. Convergence confirmed at HEAD e34c04cf.**
