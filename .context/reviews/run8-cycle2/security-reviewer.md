# Security Review — Run-8 Cycle-2 (security-reviewer)

**HEAD:** `f63af3b9` (run-8 cycle-1 SW stamp; source baseline `47b1e21f`)
**Date:** 2026-06-21
**Scope:** Whole-repo OWASP-style deep security review. Auth/session, admin API routes, server actions, public routes & rate limiting, file-upload security, SQL-injection surfaces, privacy field guards, secrets handling. Explicit angle: did the Stripe paid-download removal leave any privacy/authz hole or dead-but-reachable path?

## NEW FINDINGS: 0

**Risk level: LOW (unchanged).** The codebase is at converged state. The single source change since the converged baseline `47b1e21f` is a 2-line comment refresh in `process-image.ts` (the already-implemented FIND-R8C1-02 cleanup); everything else changed since baseline is test files. No new attack surface, no new authz/privacy hole, no dead-but-reachable code path. The Stripe removal remains surgically clean and strictly attack-surface-reducing.

---

## What changed since the converged baseline (provenance)

`git diff --stat 47b1e21f..HEAD -- apps/web/src`:
- `lib/process-image.ts` — **−4/+4, comment-only** (confirmed via full diff: docblock of `stripGpsFromOriginal` "degrading the paid deliverable" → "degrading the on-disk original"; FIND-R8C1-02). Zero logic change.
- 6 test files (free-download-contract add, migrate-reconcile-coverage add, 3 docstring refreshes, 1 dead-fixture-line drop) — the cycle-1 plan deliverables.

`lib/gps-exif-strip.ts` and `lib/rate-limit.ts` show 20-Jun mtimes in `ls -la` but `git log 47b1e21f..HEAD --` returns **zero commits** for both — the mtimes are checkout artifacts, not edits. Functional logic is byte-identical to the converged baseline.

**Conclusion: there is essentially nothing new to find at the source level.** This review re-validates the converged invariants below from first principles rather than trusting the prior cycle.

---

## Coverage — re-verified this cycle (file:line, evidence)

### Authentication & Session (A07: Auth Failures, A02: Crypto)
- **`lib/session.ts`** — HMAC-SHA256 sign/verify. Verify order is correct: HMAC `timingSafeEqual` (length-checked first to avoid throw) runs BEFORE the random/signature shape regexes (lines 110-125), so the structural checks cannot be a timing oracle. Token age bound 24 h, `tokenAge < 0` rejected (clock-skew/forgery). DB stores `sha256(token)` (`hashSessionToken`), so DB compromise ≠ usable cookies. **Prod refuses DB-secret fallback** (lines 30-36, throws) — signing key stays out of the user-data trust domain; min 32 chars enforced. CONFIRMED solid.
- **`lib/password-hashing.ts`** — Argon2id, memoryCost 65536 (64 MiB), timeCost 3, parallelism 4. Exceeds OWASP minimums; single shared policy object prevents path skew. CONFIRMED.
- **`app/actions/auth.ts`** — login: same-origin gate (`hasTrustedSameOrigin`, line 95) before any work; rate-limit pre-increment BEFORE Argon2 verify (TOCTOU-closed) on BOTH IP and account buckets; dummy-hash timing equalization for user-enumeration (line 177); session-fixation prevention via transactional insert-then-delete-others (lines 210-222); secure-cookie decision uses trusted-proxy protocol normalization; on infra error does NOT roll back rate-limit budget (anti-amplification, lines 248-255). updatePassword: validates field shape before rate-limit consume; rotates ALL sessions on change (lines 390-401, stolen-cookie-survives-rotation closed); code-point length bounds (12-1024). CONFIRMED comprehensive.
- **`proxy.ts`** — middleware cookie presence + format check (3 colon segments, ≥100 chars) is a cheap pre-filter; full crypto validation in server actions (defense-in-depth). `/api/*` correctly EXCLUDED from matcher with the documented "new /api/admin/* MUST self-auth" warning. CONFIRMED.

### Admin API routes (A01: Broken Access Control)
- **`lib/api-auth.ts` `withAdminAuth`** — enforces, in order: (1) optional token-scope path (`X-GalleryKit-Token` + `tokenHasScope`) which intentionally bypasses same-origin for cross-origin PATs; (2) `hasTrustedSameOrigin` (CSRF defense, 403); (3) `isAdmin()` (401); plus no-store + nosniff on every response (success and error, token and cookie paths). CONFIRMED.
- **`api/admin/db/download/route.ts`** — `withAdminAuth`-wrapped; `isValidBackupFilename` + `path.resolve` containment + `lstat` symlink rejection + `realpath` containment + streams from RESOLVED path (TOCTOU-closed); audit-logged. CONFIRMED.
- **`api/admin/lr/upload/route.ts`** — `withAdminAuth({allowTokenScope:'lr:upload'})`; mirrors browser-path defenses fully (safe-filename, slug/title/desc sanitize+codepoint bounds, restore-maintenance guards, upload-contract lock, disk pre-check, per-token upload-tracker quota with idempotent settle, HDR-ingest gate, GPS strip of on-disk original, attribution). CONFIRMED.
- `lint:api-auth` PASS (2/2 routes wrap `withAdminAuth`).

### Server actions (A01, CSRF)
- `lint:action-origin` PASS — all 44 mutating exports either store + early-return on `requireSameOriginAdmin()` or carry an explicit `@action-origin-exempt`. Spot-checked admin-users.ts (3 hits), settings.ts (2), seo.ts (2), admin-backfill.ts (2). `auth.ts`/`public.ts` own their own surface handling by design. CONFIRMED.

### Public routes & rate limiting (A05, DoS)
- `lint:public-route-rate-limit` PASS.
- **`api/search/semantic/route.ts`** (POST) — same-origin → maintenance → content-type strict-prefix → chunked-reject → content-length + body-size cap (8 KB) → JSON shape → codepoint min-3 → rate-limit pre-increment (Pattern-2 rollback) → fail-closed config gate. Enrichment SELECT returns ONLY public fields (title/desc/filename_jpeg/topic/camera/lens/date — no GPS/PII). CONFIRMED.
- **`api/search/similar/[id]/route.ts`** (GET) — same gate chain; production-only; rate-limited internally (the lint "no mutating handlers" classification is correct — GET — and it still rate-limits). Public-field enrichment only. CONFIRMED.
- **`api/og/photo/[id]/route.tsx`** (GET) — rate-limited (30/60s); **SSRF-pinned** internal fetch to `siteConfig.url` origin (not request Host) — closes the blind-SSRF/cache-poison lever (lines 111-116); charged-404 prevents free image-id enumeration oracle. `sanitizeForOg` strips bidi/C0 before Satori render. CONFIRMED.

### File-upload security (A01, path traversal)
- **`lib/serve-upload.ts`** — `ALLOWED_UPLOAD_DIRS = {jpeg,webp,avif}` (original/ excluded), `SAFE_SEGMENT` regex, `.`/`..`/empty/over-255 rejection, dir↔extension map, `lstat` symlink rejection, `realpath` containment from resolved root, streams from resolved path (TOCTOU-closed), no SVG content-type (XSS-via-SVG avoided). CONFIRMED.
- nginx `location ^~ /uploads/original/ { return 404; }` + app whitelist = defense in depth on the original store.

### SQL injection / input validation (A03)
- **`lib/validation.ts`** — `UNICODE_FORMAT_CHARS` bidi/zero-width reject + `stripUnicodeFormatting` strip (shared source-of-truth regex, `\uXXXX` escapes for editor-portability); slug/filename/tagname/alias validators all reject path separators + control/format chars; `safeInsertId` BigInt-overflow guard. CONFIRMED.
- **`lib/csv-escape.ts`** — C0/C1 strip, shared Unicode-format strip, CRLF-collapse, leading-whitespace-tolerant formula-injection prefix (`=+-@`), quote-doubling. CONFIRMED.
- Application queries use Drizzle parameterization throughout the routes reviewed; no string-concatenated SQL on any user-input path observed.

### Privacy (A01, sensitive data exposure)
- **`lib/data.ts`** — `publicSelectFields` is destructured FROM `adminSelectFields` (separate object reference) with explicit omission of all PII (latitude, longitude, filename_original, user_filename, original_format/size, processed) AND admin-only fields (color_space, icc_profile_name, pipeline_version, is_hdr, has_gain_map, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at). Three compile-time guards present and `= true` (typecheck-enforced): `_privacyGuard` (`_SensitiveKeysInPublic extends never`), `_mapPrivacyGuard`, `_largePayloadGuard`. `getMapImages` is the ONLY lat/long public exposure — enforced at SQL (INNER JOIN `topics.map_visible = true`) AND a runtime per-row assertion. CONFIRMED.

### Stripe-removal blast radius (the run's explicit angle)
- `grep -rniE "stripe|entitlement|downloadToken|checkout|license_tier|customerEmail|paid.?download"` over `*.ts/*.tsx` (excluding tests/comments/md) = **0 hits in source**.
- `find app/api` = only `health`, `live`, `og`, `og/photo`, `search/semantic`, `search/similar/[id]` (non-admin) + `admin/db/download`, `admin/lr/upload`. The deleted `api/stripe`, `api/checkout`, `api/download` are GONE — no dead route, no dangling registration.
- **RES-R7C6-01 stays CLOSED.** The only route-layer references to `UPLOAD_DIR_ORIGINAL` are `statfs(...)` disk-space probes in `lr/upload/route.ts:179` and `actions/images.ts:205` — neither streams the on-disk original to an HTTP client. No new route reads/streams `data/uploads/original/`. The re-open exit criterion is NOT met.
- `npm audit --omit=dev`: 2 moderate (postcss `<8.5.10` via `next@16.2.6` internals) — build-time only, unchanged from run-7/run-8c1, NOT a runtime exposure (per prior adjudication). 0 critical / 0 high.

### Secrets handling
- `SESSION_SECRET` env-only in prod (refuses DB fallback). `MYSQL_PWD` env for mysqldump (not `-p` flag). Session tokens stored hashed. PAT tokens verified via `verifyToken` (hash lookup). No hardcoded secrets observed in the surfaces reviewed; the CLAUDE.md "rotate historical git values" guidance is operator-facing and already documented.

---

## DO-NOT-RE-FILE honored
- **RES-R7C6-01** — re-verified CLOSED (no new original-streaming route). Not re-filed.
- **REJ-R7C3-01** (gps-exif indexSize) — DISPROVED; gps-exif-strip.ts unchanged since baseline. Not re-filed.
- **Stripe webhook items** — routes deleted. Not re-filed.

## Carried deferrals (security-adjacent) — re-verified UNCHANGED, no exit criterion met
- TE-R7C2-04 (`logAuditEvent` truncation untested) — code correct, callers swallow throws; carried.
- OBS-R7C2-03/04 (restore non-transactional / failRestore temp leak) — operator-runbook-mitigated; carried.
- R7C1-CR-04 (timeline bounds validation) — parameterized SQL, callers validate upstream; carried.
None are new and none meet their re-open criteria.

---

## Verdict

LOW risk. All OWASP Top-10 categories in scope evaluated against current source. Every security invariant the prior cycles converged on holds at HEAD, re-derived from the code this cycle (not trusted blindly). The Stripe removal introduced no authz/privacy hole and left no reachable dead path. Three security lint gates green; prod audit unchanged (2 build-time moderates). **No new actionable security finding.**

## Security Checklist
- [x] No hardcoded secrets (env-only signing key; hashed tokens at rest)
- [x] All inputs validated (validation.ts + csv-escape.ts + per-route shape/size/codepoint gates)
- [x] Injection prevention verified (Drizzle parameterization; no concatenated SQL on user paths; no SVG-XSS)
- [x] Authentication/authorization verified (withAdminAuth + requireSameOriginAdmin + isAdmin; lint gates green)
- [x] Dependencies audited (`npm audit --omit=dev`: 0 crit / 0 high / 2 build-time moderate, unchanged)
- [x] Privacy guards verified (publicSelectFields derivation + 3 compile-time guards + map_visible SQL+runtime enforcement)
- [x] Stripe-removal blast radius verified (0 source residuals; 0 new original-streaming routes; RES-R7C6-01 stays CLOSED)
