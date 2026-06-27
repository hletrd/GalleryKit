# Security Review Report — Cycle 17

**Scope:** OWASP-Top-10 deep pass on GalleryKit (Next.js 16 / React 19 / TS / MySQL+Drizzle / Sharp / Argon2 / HMAC sessions). HEAD `7b5c1943`.
**Priority focus this cycle:** public anonymous search routes (`api/search/**`), `actions/topics.ts` rename (topic_views + smart_collections re-point), `actions/images.ts` upload TOCTOU quota, Lightroom PAT route, OG image routes, session/cookie + rate-limit libs, CSV-escape, Unicode-formatting validation, secrets/`eval`/`child_process`/raw-SQL grep.
**Risk Level:** LOW
**`npm audit`:** clean — `found 0 vulnerabilities` (prod + full).

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low / Informational: 3 (all non-exploitable; defense-in-depth / doctrinal-consistency observations)

Sixteen prior cycles closed essentially the entire OWASP surface. This cycle found **no new or still-open exploitable vulnerability**. All cycle-16 deltas (TOCTOU quota claim, topic_views re-point, smart-collection slug rewrite, OG Content-Length finite guard) were examined and are sound. Baseline gates verified green: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit` all OK; `privacy-fields` + `check-api-auth` tests pass (18/18).

## Priority-focus verification (all PASS)

### Public search routes — `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts`
- **PII:** enrichment SELECT is whitelisted to public columns only (`id, title, description, filename_jpeg, width, height, topic, topic_label, camera_model, lens_model, capture_date`). No GPS / `filename_original` / `user_filename` / ISO / pipeline columns. Matches `_PrivacySensitiveKeys`; cycle-16 guard test present.
- **Rate-limit:** both call `preIncrementSemanticAttempt(ip,...)` (shared 30/min bucket). Semantic POST charges after cheap validation and refunds (Pattern 2) only on the pre-expensive-work 503; the embed + 2000-row scan are charged. `similar` GET pre-increments after id validation. Bounded buckets (`createResetAtBoundedMap`, max 2000 keys).
- **Input validation:** content-type prefix check, chunked-TE reject, Content-Length finite+cap, `request.text()` 8 KiB body cap (`MAX_SEMANTIC_BODY_BYTES`), JSON shape check, `typeof query==='string'`, `countCodePoints(query) < 3` reject, `clampSemanticTopK` rejects non-number topK and clamps to `[1, SEMANTIC_TOP_K_MAX]`. No regex on the query → **no ReDoS**; `embedTextReal` tokenizer runs with `truncation:true`; `embedTextStub` is a bounded SHA-256.
- **id param:** strict `/^\d+$/` + positive-integer recheck. Drizzle `eq`/`inArray` parameterized.

### `actions/topics.ts` rename (topic_views + smart_collections re-point) — SAFE
- Re-point runs inside `db.transaction`. `tx.update(topicViews).set({ topic: slug })` and the FK-child updates use validated `slug` (`requireCleanInput` + `isValidSlug` → `^[a-z0-9_-]+$`, ≤100) via Drizzle parameter binding.
- **Smart-collection JSON rewrite:** `parseSmartCollectionQuery` (structural + scalar-type validation) → `remapTopicSlugInQuery` (pure; substitutes only the validated `newSlug` into exact-identity `topic eq`/`topic in` value positions) → `JSON.stringify(remapped.ast)` written via parameterized `.set({ query_json })`. No attacker-controlled JSON, no string-concatenated SQL. Malformed rows are caught and skipped; only `changed` rows are written. **No injection / coercion path.**

### `actions/images.ts` upload TOCTOU quota fix (CR-16-01) — SAFE
- Quota + format checks are now fully synchronous and the claim (`tracker.bytes/count += …; uploadTracker.set(...)`) is committed before the first `await` (disk/topic), closing the check-then-claim race. The two awaited validations roll the claim back via idempotent `settleUploadTrackerClaim(...,0,0)` on early return — cannot under-count to bypass `UPLOAD_MAX_*`. Path traversal handled by `getSafeUserFilename` (`path.basename` + `stripControlChars` + 255-byte cap) and `crypto.randomUUID` on-disk names; symlink rejection + decompression caps live in the Sharp pipeline; upload-contract advisory lock held across save→insert→enqueue.

### Lightroom PAT route — SAFE
- `gk_<base64url(32B)>` token; only SHA-256 hash persisted; lookup by hash is parameterized + `tokenHashesEqual` constant-time (`timingSafeEqual` with length + hex guards); `expires_at` enforced; scope gate via `tokenHasScope`; `withAdminAuth({allowTokenScope:'lr:upload'})`. Mirrors browser-path GPS strip, HDR-ingest gate, restore-maintenance + contract-lock, disk pre-check (`bavail`), tracker quota, idempotent settle. `revokeToken` is scoped by `userId AND tokenId` (no cross-admin IDOR).

### OG routes — SAFE
- SSRF fail-closed: internal photo fetch base pinned to `new URL(siteConfig.url).origin`; if unset/unparseable the per-photo route returns the fallback instead of `req.url` origin. `pickFirstAvailablePhotoBuffer` enforces 10 s timeout + 1 MB cap (finite-guarded Content-Length, DBG-16-02). `sanitizeForOg` (shared `stripUnicodeFormatting` + C0 strip) applied to every rendered string in both routes. Charged-404 policy (no enumeration refund) intact. Fallback redirect open-redirect-guarded (same-origin check).

### Session / cookie / auth — SAFE
- HMAC-SHA256 token, `timingSafeEqual` after length check, token-age window, hashed DB storage, shape checks placed after crypto verify (no timing oracle). Prod requires `SESSION_SECRET` env (refuses DB fallback). Login: same-origin + IP & account rate-limit (pre-increment TOCTOU fix), Argon2id timing-equalized dummy hash, session-fixation delete-in-transaction, cookie `httpOnly`/`secure`/`sameSite=lax`/`path=/`. Argon2id params (64 MiB / t=3 / p=4) exceed OWASP. `admin-users.deleteAdminUser`: last-admin advisory lock + transaction + self-delete guard, parameterized raw SQL.

### CSV / Unicode / XSS / CSP — SAFE
- `escapeCsvField`: C0/C1 strip, shared `UNICODE_FORMAT_CHARS` strip (bidi + zero-width + interlinear), CRLF collapse, leading-whitespace-tolerant formula-prefix quote, quote-doubling.
- Admin string surfaces reject bidi/zero-width via `sanitizeAdminString` / `containsUnicodeFormatting`; EXIF-derived strings source-stripped via `stripUnicodeFormatting`.
- All 8 `dangerouslySetInnerHTML` sinks are JSON-LD via `safeJsonLd` (`<`/`>`/U+2028/U+2029 escaped) under a CSP `nonce`. CSP (prod): nonce script-src (no `unsafe-inline`), `frame-ancestors 'self'` (clickjacking), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- Grep: no `eval`/`new Function`/`sql.raw`; `child_process` only the array-arg `spawn('mysqldump'|'mysql', [...], {env})` (no shell, creds via `MYSQL_PWD` env not argv, stderr redacted); no hardcoded secrets.
- `serve-upload.ts` / `db/download` path serving: `SAFE_SEGMENT` regex, `.`/`..` reject, dir/ext allowlist, `lstat` symlink reject, `realpath` containment (`startsWith(root+sep)`), stream from resolved path (TOCTOU-closed).

## Low / Informational observations (no fix required)

### 1. Semantic query has no explicit max code-point cap
**Severity:** LOW (informational) · **Category:** A04 design consistency · **Location:** `apps/web/src/app/api/search/semantic/route.ts:185`
**Issue:** Only a minimum (`countCodePoints(query) < 3`) is enforced; the upper bound is the 8 KiB body cap. The keyword-search path caps the query at 200 code points (`public.ts:243`, `data.ts:1458`).
**Exploitability:** None — body is hard-capped at 8192 bytes, `embedTextReal` tokenizes with `truncation:true`, `embedTextStub` is a bounded SHA-256; no regex touches the query so no ReDoS.
**Remediation (optional, parity):**
```ts
// after the < 3 check
if (countCodePoints(query) > 200) {
    return NextResponse.json({ error: 'Query too long' }, { status: 400, headers: NO_STORE_HEADERS });
}
```
**Confidence:** High that current behavior is safe; this is consistency-only.

### 2. `similar/[id]` refunds the post-lookup 404, unlike the OG charged-404 doctrine
**Severity:** LOW (informational) · **Category:** A04 / rate-limit doctrine · **Location:** `apps/web/src/app/api/search/similar/[id]/route.ts:124-138`
**Issue:** In production mode, a request for an id with no production embedding does one indexed `SELECT … LIMIT 1` then `rollbackSemanticAttempt(ip)` — so embedding-existence probes are not metered, diverging from the OG routes' "charge everything post-DB" enumeration-oracle policy (SEC-R4C17-01).
**Blast radius:** Negligible — production-only; image IDs are already public; the refunded branch costs a single indexed lookup (the expensive 2000-row scan only runs after a *successful* target lookup, and is charged); reveals only "image N has a production embedding," true for ~all processed photos. Adjudicated acceptable previously (SEC-R4C18-04: "no enumeration value, no amplification analogue").
**Remediation (optional):** keep the 404 charged (drop the `rollbackSemanticAttempt(ip)` on the no-embedding/corrupt branches) to match the OG charged-404 contract.
**Confidence:** High that impact is minimal.

### 3. `getClientIp` collapses all callers to one `'unknown'` bucket when `TRUST_PROXY` unset
**Severity:** LOW (informational, pre-existing, documented) · **Location:** `apps/web/src/lib/rate-limit.ts:174-179`
**Issue:** Without `TRUST_PROXY=true` behind a proxy, every client shares one rate-limit bucket. Already mitigated by a one-time `[SECURITY]` `console.error` and documented in CLAUDE.md; fail-closed (rate limit stays applied to the shared bucket). Operator-configuration item, not a code defect. No change recommended.

## Security Checklist
- [x] No hardcoded secrets (grep clean; secrets via env; mysqldump creds via `MYSQL_PWD`)
- [x] All inputs validated (slug/filename/JSON-shape/length/topK; Unicode-format rejection)
- [x] Injection prevention verified (Drizzle parameterization; smart-collection AST allowlist + param binding; LIKE wildcard escaping; no `eval`/`sql.raw`; array-arg `spawn`)
- [x] Authn/authz verified (Argon2id, HMAC sessions, `withAdminAuth`+token scope, `requireSameOriginAdmin`, last-admin lock, middleware guard)
- [x] SSRF fail-closed on OG routes; path traversal + symlink + realpath containment on file serving
- [x] Rate-limiting present + bounded on every expensive public surface (semantic/similar/og/share/search/load-more/view-record/login/user-create/password-change)
- [x] PII guards enforced (`publicSelectFields` / `searchFields` / `timelineSelectFields` compile-time `_PrivacySensitiveKeys` guards; GPS excluded)
- [x] XSS/CSRF/clickjacking (JSON-LD via `safeJsonLd`+nonce CSP; same-origin on mutations; `frame-ancestors 'self'`)
- [x] Dependencies audited — `npm audit` 0 vulnerabilities

**Verdict:** No new or still-open Critical/High/Medium findings in cycle 17. Overall risk LOW. The three items above are non-exploitable consistency/defense-in-depth notes; none block release.
