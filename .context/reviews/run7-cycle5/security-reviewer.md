# Security Review Report — run-7 cycle-5

**Agent:** security-reviewer
**Date:** 2026-06-20
**HEAD:** `d38fa4a4` (working tree clean; only `.context/reviews/run7-cycle5/` untracked)
**Scope:** Full attack-surface re-inventory — 11 API routes (`apps/web/src/app/api/**`), 14 server-action files + `db-actions.ts`, session/token/HMAC libs, upload path-traversal handlers, rate-limit, PII guards, CSV/Unicode/OG sanitizers, the 3 security lint gates.

**Risk Level: LOW** (convergence — expected success condition)

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- NEW actionable findings: **0**

Code HEAD has had zero source changes since cycle-4 (commits since are review docs + SW-version stamp only). This is the 5th consecutive LOW/ZERO security cycle. A truthful zero is the success condition; this review re-derived the inventory from scratch rather than diffing, and confirms the posture independently.

## Dependency Audit
`npm audit --omit=dev`: **2 moderate, 0 critical, 0 high.** Both moderate are the single documented `postcss <8.5.10` XSS-in-stringify advisory reached transitively through `next` (GHSA-qx2v-qp2m-jg93). Fix requires a Next.js downgrade (`next@9.3.3`, a breaking change) — not actionable; documented as the next-transitive false-positive. No exploitable path: GalleryKit never feeds untrusted CSS through postcss stringify at runtime.

## Lint Gates — verified against code (not just "passing")
All three blocking security gates pass AND were inspected for bypassability:
- **`lint:api-auth`** — real TypeScript AST parse (`scripts/check-api-auth.ts`, `checkRouteSource`), not regex. Discovers `route.{ts,tsx,js,mjs,cjs}`. Requires each HTTP-method export to be a direct variable-export wrapping `withAdminAuth(...)`; unwraps paren/as/satisfies; rejects function-declaration and aliased exports. Covers both admin routes (`db/download`, `lr/upload`). Cannot be evaded by a `route.tsx`/`.mjs` rename.
- **`lint:action-origin`** — AST-based; recursively discovers all server-action-capable files under `app/actions/` (+ hard-coded `db-actions.ts`), excluding `auth`/`public` by name (which own their handling). Requires every mutating export to store+early-return on `requireSameOriginAdmin()`; read-only exports need explicit `@action-origin-exempt` JSDoc. Aliased exports rejected.
- **`lint:public-route-rate-limit`** — every public mutating handler must call a `preIncrement*`/`checkAndIncrement*` helper or carry `@public-no-rate-limit-required`. Verified the two exempt routes (`download`, `stripe/webhook`) carry sound justifications (256-bit single-use token; Stripe-signature gate).

## Attack-Surface Review Detail (all CONFIRMED clean)

### Authentication / Sessions (`auth.ts`, `session.ts`, `request-origin.ts`, `api-auth.ts`)
- Argon2id (memoryCost 64 MiB / timeCost 3 / parallelism 4). Login equalizes timing via a lazily-computed dummy hash (anti-enumeration).
- Rate limit pre-incremented BEFORE the Argon2 verify (TOCTOU-safe); dual buckets (per-IP + per-account `acct:` key); DB-backed with in-memory fast path; rollback only on validation rejects, NOT on infra errors (prevents budget-refund abuse).
- Session token: HMAC-SHA256 over `ts:random`, `timingSafeEqual` with length-guard, structural shape checks AFTER crypto (no timing oracle), 24 h age window, DB lookup by SHA-256 of the token (DB compromise yields no usable cookie). Production refuses the DB-stored-secret fallback.
- Session fixation prevented (transactional insert-then-delete on login); full session rotation on password change. Cookie: httpOnly, secure (TLS/prod), sameSite=lax, path=/.
- `withAdminAuth`: token path (scope-gated `verifyToken` + `tokenHasScope`) runs first and intentionally bypasses same-origin (cross-origin PAT integration; the `X-GalleryKit-Token` header cannot be set cross-origin without CORS preflight). Cookie path enforces `hasTrustedSameOrigin` (CSRF) → `isAdmin()`. Defense-in-depth no-store/nosniff applied to both success paths.
- `hasTrustedSameOrigin`: fails closed by default; trusted-proxy header parsing gated on `TRUST_PROXY`; default-port normalization. `requireSameOriginAdmin` centralizes the action-layer check.

### Admin PAT tokens (`admin-tokens.ts`)
`gk_` + base64url(32B). Stored as SHA-256 hex only; well-formed shape gate → hash lookup (plaintext never in a query param) → constant-time `tokenHashesEqual` → expiry. Fail-closed on missing table. Scope normalization against allowlist. `createToken`/`revokeToken` parameterized.

### Paid-download flow (checkout / webhook / download) — IDOR & money-path
- **Checkout** (`api/checkout/[imageId]`): per-IP rate limit (rollback Pattern 2), strict `/^\d+$/` price parse, tier allowlist, `payment_method_types:['card']` pin (closes async money-taken-no-goods until the `async_payment_succeeded` handler ships), idempotency key omitted on unknown-IP (avoids cross-buyer session collision).
- **Webhook** (`api/stripe/webhook`): mandatory signature verify before any DB work; gates on `payment_status==='paid'`; tier allowlist; zero-amount reject; oversized-email reject; deleted-image → 200 + manual-refund log (not a retry-storming 500); idempotency via `sessionId` SELECT + UNIQUE + insertId disambiguation (no dead-token logging on the dup-key loser). PII (email) kept out of error-level logs; plaintext token only logged behind `LOG_PLAINTEXT_DOWNLOAD_TOKENS`.
- **Download** (`api/download/[imageId]`): NO IDOR — entitlement keyed on token hash, not a guessable id. 256-bit token, shape regex short-circuit, constant-time `verifyTokenAgainstHash`, expiry/refunded/single-use checks. Atomic single-use claim (`UPDATE … WHERE downloadedAt IS NULL`) AFTER open-file validation so a missing file never burns the token. Path containment (`startsWith(uploadsDir+sep)`) + lstat symlink reject + realpath containment. GET is claim-free interstitial (mail-scanner safe) with restrictive CSP; POST claims. Content-Disposition extension sanitized + RFC 6266/5987 encoded.

### Public search (`search/semantic`, `search/similar/[id]`)
Same-origin gate, restore-maintenance guard, rate-limit pre-increment (rollback Pattern 2 — kept even on shared `unknown` bucket as a security control), content-type prefix check, chunked-encoding reject, body-size cap (8 KiB), code-point query-length validation, mode gating (disabled→503). Enrichment SELECTs only public fields (id, title, description, filename_jpeg, dims, topic, label, camera_model, lens_model, capture_date) + `processed=true` filter — **no GPS/PII**.

### OG routes (`api/og`, `api/og/photo/[id]`)
Rate-limited; strict integer id; `getImageCached` uses `publicSelectFields` (no PII); `sanitizeForOg` strips Unicode-format + C0 on every admin string before Satori render. Photo buffers fetched via `pickFirstAvailablePhotoBuffer` → HTTP back through `/uploads/` (full serve-upload containment); base filename is a DB UUID (not user-controlled); origin is server-derived. No traversal sink, no SSRF (fixed `${origin}/uploads/jpeg/` prefix, UUID filename).

### Upload path traversal (`serve-upload.ts`, `lr/upload`, `download`)
`ALLOWED_UPLOAD_DIRS` whitelist + `SAFE_SEGMENT` `^[a-zA-Z0-9._-]+$` + explicit `.`/`..` reject + segment length cap + dir↔ext map + lstat symlink reject + realpath `startsWith(root+sep)` containment. LR upload additionally: scope-gated auth, `getSafeUserFilename` basename sanitize, `isValidSlug`, `sanitizeAdminString` (bidi/zero-width), code-point caps, on-disk GPS strip when `strip_gps_on_upload`, upload tracker (TOCTOU pre-claim), contract lock, disk-space + restore-maintenance guards.

### PII guards (`data.ts`)
`publicSelectFields` derived by destructure-omit from `adminSelectFields` (separate object reference). Compile-time `_privacyGuard` (`_SensitiveKeysInPublic extends never`) rejects any of 20 sensitive keys (GPS, filenames, color/HDR audit, pipeline) in public fields. `publicMapSelectFields` has its OWN `_mapPrivacyGuard` allowing ONLY lat/lng beyond public. `getMapImages` (sole GPS-exposing public fn) double-gates: SQL `topics.map_visible=true` INNER JOIN + runtime assertion loop + 10k cap + `isNotNull(lat/lng)`. `getImage` uses public fields. Privacy-fields test (111 security tests total) green.

### Injection / secrets
- Zero `sql.raw` usages; zero template-literal-with-interpolation in `execute`/`query`. All dynamic SQL via Drizzle parameterized `sql\`\`` / query builder.
- DB backup/restore (`db-actions.ts`): `mysqldump`/`mysql` via `spawn` with an **arg array** (no shell → no command injection); `MYSQL_PWD` via env (no `-p` process-list leak); restore advisory-locked + header-validated + `--one-database` + `randomUUID()` temp file.
- CSV export (`csv-escape.ts`): C0/C1 strip, Unicode bidi/zero-width strip, CRLF collapse, formula-injection prefix with leading-whitespace tolerance, quote-doubling. Validation (`validation.ts`): full `UNICODE_FORMAT_CHARS` rejection on all admin string surfaces; ASCII-only `isValidSlug`; `safeInsertId` BigInt-overflow guard.
- Zero hardcoded secret literals; all secrets via `process.env`.

## Carried-over adjudicated items — re-confirmed (no escalation)

### REJ-R7C3-01 (indexSize not validated {0,4,8}, gps-exif-strip.ts:~466) — STAYS REJECTED
Re-read lines 455-530. `indexSize` is only used as `pos += indexSize` to SKIP the extent index field; it is NEVER passed to `readSized` (only `offsetSize`/`lengthSize`/`baseOffsetSize` are validated against {0,4,8} and used as read widths). Every extent read is bounds-checked (`pos + extentEntrySize > ilocBox.dataEnd` → return null). A malformed `indexSize` can only advance `pos`; over-reach is caught → safe null reject. No OOB read, no leak. **Confirmed disproved.**

### RES-R7C4-01 (HEIC anomaly GPS-strip fall-through) — STATUS UNCHANGED (RESIDUAL, reachability UNVERIFIED)
The `constructionMethod !== 0` branch (line ~525) returns null for non-file-offset (idat/item) construction, and `stripGpsFromOriginal` then falls back per its documented best-effort contract. Decisive mitigating fact re-verified: GPS DB columns are nulled BEFORE the on-disk strip on BOTH ingest paths (`exifDb.latitude/longitude = null` precedes `stripGpsFromOriginal` in `lr/upload/route.ts` and `actions/images.ts`), so the public API / gallery / map / search NEVER leak GPS regardless of strip outcome. The only residual is GPS remaining in the on-disk original streamed by the paid-download route, and only for an anomalous `construction_method != 0` HEIC. No NEW reachability evidence found (the review host's Sharp still lacks an HEVC decoder; Apple's EXIF item is typically file-offset method 0). Per the run-7 directive, escalation requires NEW evidence of a `construction_method != 0` path Apple actually uses for the EXIF item — none found this cycle. **No escalation.**

## Security Checklist
- [x] No hardcoded secrets (all via process.env; production refuses DB-fallback session secret)
- [x] All inputs validated (code-point lengths, slug/filename regex, Unicode-format rejection, content-type/body-size guards)
- [x] Injection prevention verified (Drizzle parameterized; zero sql.raw; spawn arg-array; CSV formula escaping)
- [x] Authentication/authorization verified (Argon2id, HMAC sessions, withAdminAuth, requireSameOriginAdmin, PAT scopes)
- [x] Authorization on every admin route/action (3 lint gates pass + inspected for bypassability)
- [x] No PII in public responses (compile-time guards + runtime map assertion; 111 security tests green)
- [x] No IDOR on download/entitlement (token-hash keyed, single-use, constant-time)
- [x] No SSRF (OG fetch uses fixed prefix + UUID filename + server origin)
- [x] Path traversal contained (SAFE_SEGMENT + whitelist + realpath + symlink reject on all file routes)
- [x] Rate limits on mutating public routes (pre-increment, rollback Pattern 2)
- [x] Dependencies audited (0 crit/high; 1 documented moderate transitive)

## Conclusion
The codebase is at a mature security plateau. Every high-value surface carries explicit, multi-cycle defense-in-depth lineage, and the three architectural lint gates plus the compile-time PII guards make whole vulnerability classes structurally unreachable. No new actionable security findings this cycle. Convergence holds.

**NEW actionable findings: 0**
