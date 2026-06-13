# Security Review — GalleryKit (deep fan-out, run-6)

**Reviewer:** security-reviewer
**Scope:** OWASP Top 10, secrets, unsafe patterns, auth/authz, injection (SQL/LIKE/CSV/formula), SSRF, path traversal, symlink, crypto/timing, rate limits, Unicode/bidi spoofing, decompression bombs, insecure deserialization, session/cookie security. All `apps/web/src/app/api/**` routes, `apps/web/src/app/actions/**`, `lib/{session,api-auth,validation,csv-escape,gps-exif-strip,serve-upload,smart-collections,safe-json-ld,admin-tokens,request-origin,rate-limit}.ts`, `proxy.ts`, `db-actions.ts`, Stripe webhook + checkout + download routes.
**Validated against:** code at HEAD (`8fc403a2`) + uncommitted working tree. Lint gates run live. `npm audit` run live.
**Risk Level: LOW** — no exploitable CRITICAL/HIGH/MEDIUM finding in runtime-reachable code. Two prior findings (AGG-3, AGG-4) confirmed FIXED. One documented scoped limitation (AGG-12) persists by design.

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |
| INFO / verified-clean | 9 |

- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 2 (SEC-01 npm-audit dev-only advisories — NOT actionable; SEC-02 `applyAltSuggested` no explicit code-point cap — source already byte-bounded)

## Findings Table

| ID | Severity | Category | Location | Status |
|---|---|---|---|---|
| SEC-01 | LOW (build-time only) | A06 Vulnerable Components | `apps/web/package.json` (drizzle-kit/tsx→esbuild, next→postcss) | Not runtime-reachable; do NOT `audit fix --force` |
| SEC-02 | LOW | A03 Injection (data-integrity) | `apps/web/src/app/actions/images.ts:1007-1009` | Source byte-bounded upstream; cosmetic |
| SEC-03 | INFO | A10 SSRF | `apps/web/src/lib/og-photo-fetch.ts:50-52` + `og/photo/[id]/route.tsx:120` | Bounded; not exploitable |
| SEC-V1 | VERIFIED-FIXED | A03 (bidi spoofing) | `process-image.ts:574`, `images.ts:1007` | AGG-3 closed |
| SEC-V2 | VERIFIED-FIXED | A03 (bidi spoofing) | `og/photo/[id]/route.tsx:37`, `p/[id]/page.tsx:43` | AGG-4 closed (commit 170297ed) |
| SEC-V3 | DOCUMENTED-LIMITATION | A04 Insecure Design | `stripe/webhook/route.ts:88,99` | AGG-12 — async_payment_succeeded unhandled (plan-316) |
| SEC-V4 | VERIFIED-CLEAN | A01/A07 AuthN/Z | `lib/session.ts`, `lib/api-auth.ts`, `actions/auth.ts` | Strong |
| SEC-V5 | VERIFIED-CLEAN | A03 Injection | `lib/smart-collections.ts` | Allowlist + param-bound + scalar-enforced |
| SEC-V6 | VERIFIED-CLEAN | A03 XSS (JSON-LD) | `lib/safe-json-ld.ts:16` | `</script>` breakout escaped |
| SEC-V7 | VERIFIED-CLEAN | Path traversal/symlink | `serve-upload.ts`, `download/[imageId]`, `db/download` | realpath+sep+lstat |
| SEC-V8 | VERIFIED-CLEAN | A02 Crypto/timing | `lib/session.ts:113-117`, `admin-tokens.ts:69` | timingSafeEqual + length pre-check |
| SEC-V9 | VERIFIED-CLEAN | Privacy (GPS leak) | `lib/gps-exif-strip.ts` | Byte-level strip, no `withMetadata()` |

---

## LOW Findings

### SEC-01 — npm audit: 3 HIGH + 2 MODERATE advisories, all build/dev-time only
**Severity:** LOW (informational; NOT runtime-exploitable)
**Category:** A06 Vulnerable & Outdated Components
**Location:** `apps/web` dependency tree

`npm audit` reports 5 advisories:
- **esbuild GHSA-gv7w-rqvm-qjhr (HIGH, 8.1)** via `drizzle-kit` and `tsx` (both `isDirect: true` devDeps). The advisory is "missing binary integrity verification in the **Deno** module enables RCE via `NPM_CONFIG_REGISTRY`" — exploitable only when installing esbuild's Deno binary from a malicious registry, i.e. a build/CI-time supply-chain vector, not a request-path vector.
- **postcss GHSA-qx2v-qp2m-jg93 (MODERATE, 6.1)** via `next`'s nested `postcss` — "XSS via unescaped `</style>` in CSS Stringify output." Requires running PostCSS stringify over attacker-controlled CSS, which happens only at **build** time in this app (Tailwind/PostCSS compile step), never on a user request.

**Why not actionable:** the production runtime container (`prod-deps` Dockerfile stage) ships neither `drizzle-kit`, `tsx`, `esbuild`, nor `postcss` on the request path — they are build/migration tooling. `npm audit fix --force` would install `drizzle-kit@0.19.1` (semver-major downgrade) AND `next@9.3.3` (catastrophic downgrade from 16.2), directly violating the CLAUDE.md "Always Use Latest Versions" rule and breaking the app. **Recommendation:** leave pinned; track upstream `next`/`drizzle-kit`/`tsx` releases that pull in patched transitives (esbuild ≥ 0.28.1, postcss ≥ 8.5.10). No emergency action.
**Confidence:** High. **Security-class:** Build-time only — deferral is correct here per the repo's stable-pin policy.

### SEC-02 — `applyAltSuggested` writes EXIF-derived caption to title/description without an explicit code-point cap
**Severity:** LOW (data-integrity; effectively bounded)
**Category:** A03 (length-validation parity gap)
**Location:** `apps/web/src/app/actions/images.ts:1007-1009`

```ts
const stripped = (stripUnicodeFormatting(stripStubPrefix(row.alt_text_suggested)) ?? '').trim();
if (!stripped) continue;
toUpdate.push({ id: row.id, caption: stripped });   // → images.title / images.description, NO countCodePoints cap
```

Every other write path into `images.title` (≤255) / `images.description` (≤5000) validates via `countCodePoints` and rejects loudly (`updateImageMetadata`, the LR-upload route `images.ts`-parity). This copy path applies the bidi/zero-width strip (good — AGG-3 lineage) but no length cap. **Why low / not exploitable:** the source column `alt_text_suggested` is machine-generated by `caption-generator.ts` (camera model + EXIF fields) and every EXIF string flowing in is already capped at `MAX_DB_VARCHAR_BYTES` by `cleanMetadataString` (`process-image.ts:566`), so it cannot exceed the destination column width in practice; the admin cannot inject arbitrary length here (the field is read-only, auto-derived). Worst case on a hypothetical future producer drift is a silent MySQL strict-mode `Data too long` throw caught by the surrounding transaction. Trust boundary: admin-only action, admin-controlled trigger, machine-derived value.
**Fix:** add `if (countCodePoints(stripped) > 255 /* or 5000 for description */) continue;` (or truncate) before push, matching the canonical metadata-write contract.
**Confidence:** Medium (the upstream bound makes this cosmetic). **Security-class:** No — data-integrity hygiene, safely deferrable.

---

## INFO

### SEC-03 — OG per-photo image fetch derives origin from request URL (bounded SSRF surface)
**Severity:** INFO (not exploitable)
**Category:** A10 SSRF
**Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:120` (`origin = new URL(req.url).origin`) → `lib/og-photo-fetch.ts:50-52` (`fetch(\`${origin}/uploads/jpeg/${sizedFilename}\`)`)

The per-photo OG generator fetches the photo derivative over HTTP using an `origin` derived from the inbound request URL, then renders the body into a PNG via Satori. In theory a spoofed `Host`/forwarded-host could redirect the fetch. **Why not exploitable:** (1) the path is fixed to `/uploads/jpeg/{filename}` and `baseFilename` is the DB-stored `filename_jpeg` (a `crypto.randomUUID()`-derived name, not attacker-controlled); (2) the fetch enforces a 10 s `AbortSignal.timeout` and a 1 MB Content-Length + buffered-body cap, and the result must decode as an image to render; (3) there is no attacker-controlled path/query reflected into the fetch URL, so it cannot be pivoted to an arbitrary internal endpoint to exfiltrate non-image responses; (4) the endpoint is per-IP rate-limited (`preIncrementOgAttempt`, 30/60s) and the 404 stays charged (no enumeration oracle, `SEC-R4C17-01`). The blast radius is at most fetching the app's own image under a different authority. No change required; documented for completeness.
**Confidence:** High (bounded). **Security-class:** No.

---

## VERIFIED — Prior findings re-checked at HEAD

### SEC-V1 (AGG-3) — FIXED ✅ EXIF bidi/zero-width strip now present
- `apps/web/src/lib/process-image.ts:566-574` — `cleanMetadataString` now does `(stripUnicodeFormatting(String(value)) ?? '').replace(/\0/g, '').trim()`. Strips full bidi/zero-width set (the GLOBAL twin), not just NUL. Import at line 28.
- `apps/web/src/app/actions/images.ts:1007` — `applyAltSuggested` strips via `stripUnicodeFormatting(stripStubPrefix(...))` before persisting into `title`/`description`. The symmetric source + persist-path defense is in place.
**Verdict:** Closed. The Trojan-Source EXIF-caption vector into the photo viewer / OG card is neutralized at both producer and persist boundaries.

### SEC-V2 (AGG-4) — FIXED ✅ OG/JSON-LD now strips ALL bidi chars
- `apps/web/src/app/api/og/photo/[id]/route.tsx:36-37` — `sanitizeForOg` = `(stripUnicodeFormatting(value) ?? '').replace(OG_C0_CONTROL_CHARS, '')`. Uses the `/g`-flagged `stripUnicodeFormatting` (validation.ts:92), NOT the non-global `UNICODE_FORMAT_CHARS.test`-only regex.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:42-43` — same `stripUnicodeFormatting`-backed `sanitizeForOg`.
- Confirmed by commit `170297ed` ("fix(security): strip ALL bidi chars in OG/JSON-LD, not just the first").
**Verdict:** Closed. The "only the first bidi char stripped" partial-sanitization bug is gone; values with 2+ bidi/zero-width chars are now fully scrubbed before the public OG card and JSON-LD.

### SEC-V3 (AGG-12) — PERSISTS as documented scoped limitation ⚠️
- `apps/web/src/app/api/stripe/webhook/route.ts:88` — handler gates on `event.type === 'checkout.session.completed'` only.
- Line 99 comment explicitly acknowledges: "a future cycle should add a handler for `checkout.session.async_payment_succeeded`." Line 105-118 rejects `payment_status !== 'paid'` (so an `unpaid` async session correctly does NOT mint an entitlement), but there is **no** later handler for the `async_payment_succeeded` event that fires when ACH/bank-transfer funds settle.
**Impact:** A customer paying via a delayed method (ACH, bank transfer, OXXO, Boleto) completes Checkout, funds eventually settle, but no entitlement row is ever written → the `/api/download/[imageId]` route returns 404 "Token not found" forever for a PAID purchase. Money taken, asset never delivered, no automated remediation. Per-tenant financial-trust impact.
**Status:** CLAUDE.md (`entitlements` schema note) and the route docstring both document this as a scoped limitation owned by **plan-316 CRT-R5C1-04**; only card / immediate-payment methods are fully supported today. **Recorded per mandate.** This is a genuine paid-flow gap, not a code defect to fix ad-hoc — the safe fix (mint entitlement on `async_payment_succeeded`, reusing the same `payment_status === 'paid'` + tier-allowlist + idempotency path) belongs in plan-316. If async payment methods are not enabled in the Stripe dashboard, the gap is not reachable. **Recommendation:** until plan-316 ships, disable async/delayed payment methods in the Stripe Checkout configuration so no customer can reach the un-fulfilled state.
**Confidence:** High. **Security-class:** Business-logic / financial — deferral is explicitly sanctioned by repo plan ownership, but operators MUST gate async payment methods off in Stripe in the interim.

### SEC-V4 — Auth / session / cookie: CLEAN ✅
- `lib/session.ts`: HMAC-SHA256 token (`timestamp:random:signature`); verify does length-pre-check then `timingSafeEqual` (constant-time) BEFORE shape assertions (no timing oracle, line 121-125 comment is correct); 24 h age bound (rejects negative age / future timestamps); DB lookup by `sha256(token)` so a DB leak yields no usable cookies; expired sessions self-purge. Production REFUSES the DB-stored secret fallback (line 30-36) — signing key stays out of the user-data trust domain.
- `actions/auth.ts` login: dummy-Argon2id hash equalizes exists/missing timing; rate-limit pre-increment BEFORE verify (TOCTOU-safe) across BOTH per-IP and per-account (`acct:`) buckets; session-fixation prevented (insert-then-delete-others in one txn); `Secure` cookie under TLS/prod via trusted-proxy-normalized protocol; `httpOnly`+`sameSite:lax`+`path:/`; same-origin gate on login/logout/updatePassword; no rate-limit rollback on infra errors (correct — prevents attacker-induced budget refund). `updatePassword` rotates ALL sessions on change.
- `lib/api-auth.ts` `withAdminAuth`: origin check → cookie check (or PAT-scope path that intentionally bypasses same-origin for cross-origin integrations); injects `no-store`+`nosniff` on every response incl. token path.
- `admin-users.ts` delete: global advisory lock (`LOCK_ADMIN_DELETE`), last-admin guard inside txn, self-delete blocked, parameterized raw SQL, audit-FK detach (`UPDATE audit_log SET user_id=NULL`).
- `proxy.ts`: middleware presence+format gate on `admin_session` for `/[locale]/admin/*` (full crypto verify in actions, defense-in-depth); `x-gk-admin-render` header only reflects requester's own cookie (no cross-user disclosure); `/api/*` correctly excluded from matcher with documented contract that every `/api/admin/*` route must self-auth.

### SEC-V5 — Smart-collection deserialization → SQL: CLEAN ✅
`lib/smart-collections.ts`: column allowlist (`ALLOWED_COLUMNS` + `VALID_COLUMNS`), `MAX_DEPTH=4`, `MAX_IN_VALUES=100`, per-column operator narrowing (`TAG_OPERATORS` rejects non-eq/contains for tag at validation/write time), **scalar-value runtime enforcement** (`isScalarValue` — closes the mysql2 plain-object-expansion-into-SQL vector, HARD-R4C4-07), LIKE escaping (`/[%_\\]/g`), and ALL values flow through Drizzle parameter binding (`eq`/`gt`/`inArray`/`sql\`${}\``). The dead unauthenticated `getSmartCollections` getter was removed (SEC-R4C5-02). `query_json` is admin-only input but the compiled query runs on the PUBLIC `/c/[slug]` page — the write-time-fail-loud doctrine is correctly applied. No injection.

### SEC-V6 — JSON-LD XSS (`dangerouslySetInnerHTML`): CLEAN ✅
All 8 `dangerouslySetInnerHTML` sites render JSON-LD/structured data through `safeJsonLd` (`lib/safe-json-ld.ts:16`): `.replace(/</g,'\\u003c')` defuses the `</script>` breakout, plus U+2028/U+2029 escaping. Title/text fields feeding the LD object are additionally `sanitizeForOg`-scrubbed. No raw user/admin HTML reaches the DOM. `atom-feed.ts` and `download-interstitial.ts` independently `&lt;`-escape; the download interstitial ships its own restrictive CSP (`default-src 'none'`).

### SEC-V7 — Path traversal / symlink: CLEAN ✅
- `serve-upload.ts`: `ALLOWED_UPLOAD_DIRS` whitelist + `SAFE_SEGMENT` regex + per-segment `.`/`..`/length checks + dir↔extension map + `lstat` symlink rejection + `realpath` containment (`startsWith(\`${resolvedRoot}${path.sep}\`)`) + streams from the RESOLVED path (closes realpath→open TOCTOU).
- `download/[imageId]`: `path.resolve` + `startsWith(uploadsDir+sep)` + `lstat` symlink reject + parallel `realpath` containment + `open()`-before-claim ordering so a missing/replaced file never burns the single-use token; Content-Disposition extension sanitized + RFC 6266/5987 encoded.
- `db/download`: `withAdminAuth` + `isValidBackupFilename` + `path.resolve` containment + `lstat` symlink reject + `realpath` containment.
All three resolve the symlink TOCTOU correctly.

### SEC-V8 — Crypto / timing: CLEAN ✅
Argon2id (`PASSWORD_HASH_OPTIONS`, 64 MiB / t=3 / p=4); session HMAC verify uses `timingSafeEqual` with length pre-check; `admin-tokens.tokenHashesEqual` uses `timingSafeEqual` over hex buffers; download-token verify uses `verifyTokenAgainstHash` (constant-time). No `Math.random()` for security material — `randomBytes`/`crypto.randomUUID()` throughout. Stripe webhook verified via `constructStripeEvent` (HMAC signature, constant-time 400 on forgery) before any DB work.

### SEC-V9 — Privacy / GPS leak on paid-download original: CLEAN ✅
`lib/gps-exif-strip.ts` performs lossless byte-level GPS-IFD neutralization (JPEG/TIFF/HEIF/WebP, bounds-checked walkers; GPS-bearing XMP zeroed/dropped) and explicitly does NOT use Sharp `withMetadata()` (which retains EXIF/XMP/GPS in Sharp 0.33+). Both ingest paths (browser `uploadImages` + LR PAT route `lr/upload/route.ts:326`) call `stripGpsFromOriginal` when `strip_gps_on_upload` is set, so the on-disk ORIGINAL that the paid-download route streams is scrubbed — not just the DB columns. `publicSelectFields` omits `latitude`/`longitude`/`filename_original`/`user_filename` with a compile-time `_SensitiveKeysInPublic` guard.

---

## Lint-gate invariants — VERIFIED in code (not just gate-passing)
- `lint:api-auth` ✅ — both `/api/admin/**` routes (`db/download`, `lr/upload`) wrap `withAdminAuth(...)`; the wrapper enforces origin→cookie (or scoped-PAT) before the handler runs.
- `lint:action-origin` ✅ — every mutating action across all 14 `actions/*.ts` files + `db-actions.ts` stores `requireSameOriginAdmin()` and returns early on truthy result (manually confirmed login/updatePassword/createAdminUser/deleteAdminUser/collections/sales/lr-tokens/images). All 10 `@action-origin-exempt` getters either gate on `isAdmin()` (admin getters return `unauthorized`/`[]`) or are write-only public analytics (`recordPhotoView`/`recordTopicView`/`recordSharedGroupView` — input-validated, per-IP rate-limited, FK-constrained, return `void`, leak no data).
- `lint:public-route-rate-limit` ✅ — `checkout` + `semantic` use `preIncrement*` helpers; `download` + `stripe/webhook` carry justified `@public-no-rate-limit-required` (single-use token / Stripe signature gates). OG routes (GET) carry their own `preIncrementOgAttempt` rate limit beyond the lint's POST-only scope.

## Sweep results (no findings)
- `eval(` / `new Function(` — none in src (excl. tests).
- Hardcoded secrets (api-key/secret/password/token = literal) — none; all secrets via `process.env`.
- Raw-SQL string interpolation — every `sql\`…${x}…\`` binds `x` as a Drizzle parameter; no concatenation of untrusted input. Raw `conn.query` in admin-users/db-actions is parameterized (`?` placeholders).
- CSV/formula injection — `csv-escape.ts` (per CLAUDE.md: `=+-@` prefix, C0/C1 strip, bidi strip, zero-width strip) + `\x01` separator split; admin string fields reject bidi/zero-width at validation (`UNICODE_FORMAT_CHARS`).
- Decompression bomb — Sharp `limitInputPixels` configured; wide-gamut sources downscaled before rgb16 fan-out.
- Insecure deserialization — only JSON via `JSON.parse` behind structural validators (`parseSmartCollectionQuery`, semantic body); no `node-serialize`/`vm`/prototype-pollution sink observed.

## Security Checklist
- [x] No hardcoded secrets (all via env; production refuses DB-secret fallback)
- [x] All inputs validated (slug/filename/username regexes, code-point length caps, scalar-value enforcement, Content-Type/-Length/body-size guards)
- [x] Injection prevention verified (Drizzle param binding, LIKE escape, CSV escape, smart-collection allowlist, JSON-LD `</script>` escape)
- [x] Authentication/authorization verified (Argon2id, timing-safe HMAC sessions, per-IP+per-account rate limits, same-origin CSRF on all mutating actions + admin routes, last-admin guard, PAT scope gating)
- [x] Path traversal / symlink verified (realpath+sep containment, lstat symlink reject on all 3 fs-serving routes)
- [x] Privacy verified (byte-level GPS strip on disk + DB, PII omission with compile-time guard)
- [x] Dependencies audited (5 advisories, all build/dev-time only — `audit fix --force` correctly NOT recommended)
- [x] Prior findings re-checked (AGG-3 FIXED, AGG-4 FIXED, AGG-12 documented limitation)
