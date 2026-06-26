# Tracer Log — Cycle 12

**HEAD:** 2a9976a1  
**Date:** 2026-06-27  
**Agent:** Tracer (causal trace, competing hypotheses)  
**Scope:** Six high-risk data/control flows, end-to-end

---

## Scope and Method

Six flows traced from source to final effect. For each flow: observation restated, competing hypotheses identified, evidence collected for and against each, strongest alternative rebutted, current best explanation stated, any critical unknown and discriminating probe named. Findings produced only where a real defect or genuinely under-defended path was found. Flows confirmed sound are noted for provenance.

---

## Flow 1 — Upload → queue claim → Sharp processing → conditional UPDATE → delete-during-processing race

### Observation
An upload can be deleted while Sharp is processing its derivatives. The question is whether the queue path correctly detects this and avoids orphaned files on disk.

### Hypotheses

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | Race is fully handled: per-image advisory lock + conditional UPDATE + full-scan cleanup | High | Strong (source code) |
| 2 | Cleanup misses non-default image sizes (deleteImageVariants called with non-empty sizes array) | Low | Contradicted |
| 3 | Lock is released before cleanup, allowing a second worker to race the orphaned-file cleanup | Low | Contradicted |

### Evidence For H1
- `image-queue.ts`: `acquireImageProcessingClaim()` acquires `GET_LOCK('gallerykit:image-processing:{id}', 0)` (non-blocking) before any work begins.
- Pre-processing claim: `WHERE processed = false` conditional check; queue job exits early if row is already claimed.
- Post-encode conditional UPDATE `WHERE processed = false`; when `affectedRows === 0` the job treats this as a mid-encode delete.
- On `affectedRows === 0`: calls `deleteImageVariants(dir, filename, [])` with an empty sizes array `[]`, which triggers a full directory scan (not constrained to the default size ladder). This specifically handles non-default-size derivatives.
- Lock is held on `lockConn` for the entire job lifecycle; the lock is released after cleanup completes, preventing a second worker from racing the cleanup.
- Claim retry: `MAX_CLAIM_RETRIES=10` with escalating delay up to 25 s.

### Evidence Against H2 (non-default size gap)
- The empty array `[]` passed to `deleteImageVariants` is documented to mean "full scan." Any number of sizes written to disk at any configured size are removed.

### Evidence Against H3 (lock released before cleanup)
- The lock connection (`lockConn`) is released only in the `finally` block of the queue job, which executes after cleanup. The per-image lock scope covers the full job including post-encode cleanup.

### Rebuttal Round
Strongest challenge: a crash (SIGKILL) between the conditional UPDATE returning 0 and the cleanup call would leave orphaned files without holding the lock (lock is auto-released on connection drop). This is inherent to any non-transactional file+DB dual-state system. The risk is bounded because: (a) a new upload with the same UUID is cryptographically improbable; (b) the admin can run the sidecar backfill, which will either skip (row absent) or re-encode. This is not a code defect; it is a documented best-effort gap in any dual-store architecture.

### Current Best Explanation
SOUND. The delete-during-processing race is correctly handled for the normal process-exit path. The crash-recovery gap is inherent and bounded.

---

## Flow 2 — Session token creation → cookie → middleware guard → isAdmin() in server actions

### Observation
Admin actions must reject unauthenticated callers regardless of whether the request comes through the Next.js App Router or the API route handler path.

### Hypotheses

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | Defense-in-depth: middleware is format-check-only; full crypto verification is in every server action via isAdmin()/verifySessionToken() | High | Strong |
| 2 | API routes bypass middleware entirely, creating an unguarded surface | Low | Contradicted by lint gate |
| 3 | Middleware's token length check (< 100) can pass a crafted short-but-syntactically-valid token | Low | Irrelevant — crypto check in actions is authoritative |

### Evidence For H1
- `proxy.ts` line 140 comment explicitly states: "API routes (/api/*) are EXCLUDED from this middleware matcher. Any new /api/admin/* route MUST implement its own auth check."
- `proxy.ts` matcher: `'/((?!api|_next|_vercel|.*\\..*).*)' ` — API routes explicitly excluded.
- `proxy.ts` lines 90, 103: two-stage format check (length >= 100, then 3 non-empty colon-separated segments). This is a cheap early redirect for obviously-malformed tokens only. It never claims to be cryptographic.
- Every `/api/admin/**` route is wrapped with `withAdminAuth()` enforced by the `lint:api-auth` gate (`check-api-auth.test.ts`).
- `isAdmin()` → `verifySessionToken()`: HMAC-SHA256 verification via `timingSafeEqual` + DB session lookup. This runs in every mutating server action independently.
- Session rotation on login: new session created in a transaction, all prior sessions deleted to prevent session fixation.
- `requireSecureCookie` uses `getTrustedRequestProtocol()` — fails closed to `http` when no protocol header is present (tested in `__tests__/request-origin.test.ts`).

### Evidence Against H2
- The `lint:api-auth` gate (`check-api-auth.test.ts`) fails the build if any `/api/admin/**` HTTP-method export lacks `withAdminAuth()`. The gate is exercised by CI.

### Evidence Against H3
- The middleware's token format check is documented as defense-in-depth only. The definitive auth boundary is `verifySessionToken()` in actions, which performs HMAC verification and DB lookup regardless of what the middleware allowed through.

### Rebuttal Round
Strongest challenge: the `x-gk-admin-render: 1` header set in `proxy.ts` line 129 uses only cookie presence (not crypto verification). A fabricated `admin_session` cookie would cause the service worker to exclude that HTML response from its offline cache — a mis-classification, not a security breach. Crypto auth is downstream in `isAdmin()`.

### Current Best Explanation
SOUND. The two-layer design (cheap format check in middleware + definitive HMAC+DB check in every action) is correct and consistent with the defense-in-depth architecture.

---

## Flow 3 — getClientIp → TRUST_PROXY / TRUSTED_PROXY_HOPS → per-IP rate-limit bucket key

### Observation
Rate-limit bucket keys must use the real client IP. When behind a reverse proxy, this depends on correctly parsing the X-Forwarded-For chain.

### Hypotheses

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | IP extraction is correct: only trusts XFF when TRUST_PROXY=true, hops default safely | High | Strong |
| 2 | TRUSTED_PROXY_HOPS=0 or negative causes underflow (clientIndex < 0) and falls through to wrong IP | Low | Contradicted |
| 3 | Spoofed XFF is accepted when TRUST_PROXY is unset | Low | Contradicted |

### Evidence For H1
- `rate-limit.ts` `getClientIp()`: XFF only used when `TRUST_PROXY === 'true'`.
- `getTrustedProxyHopCount()`: parses `TRUSTED_PROXY_HOPS`, returns 1 if missing, non-numeric, non-positive, or NaN.
- XFF chain-too-short path: `clientIndex = validParts.length - hopCount - 1`; when `clientIndex < 0` the code falls through to `X-Real-IP`, then `null` → `'anon'`. No crash, no wrong-IP use.
- When TRUST_PROXY is unset (default), XFF is ignored completely and IP is sourced from `X-Real-IP` or returns null.

### Evidence Against H2
- `getTrustedProxyHopCount()` explicitly guards: if parsed result is absent or non-positive, returns 1. The underflow path (`clientIndex < 0`) falls through to `X-Real-IP`.

### Evidence Against H3
- Without `TRUST_PROXY=true`, XFF headers are treated as untrusted user input and ignored.

### Rebuttal Round
Strongest challenge: when `TRUST_PROXY=false` and neither `X-Forwarded-For` nor `X-Real-IP` is present (direct connection), `getClientIp()` returns null. The rate-limit code uses `'anon'` as the bucket key, pooling all such requests under one key. This is a bounded worst-case: it is the admin's deployment responsibility to configure a reverse proxy. The code makes the correct conservative choice.

### Current Best Explanation
SOUND. The hop-count parsing, fallback chain, and TRUST_PROXY gating are all correct.

---

## Flow 4 — Color detection precedence (NCLX > ICC chromaticity > ICC name) → encoder decision → ETag/settings-hash invalidation

### Observation
The color pipeline uses three layers of source detection with defined precedence. The ETag formula must incorporate any setting that affects the output bytes.

### Hypotheses

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | Detection precedence, encoder decision, and ETag are correctly implemented and mutually consistent | High | Strong |
| 2 | A new color-impacting setting could be added without being added to COLOR_IMPACTING_KEYS, silently breaking cache invalidation | Medium | Compile-time guard present but cannot catch forgotten new keys |
| 3 | imageSizes sort-before-hash is missing, causing spurious cache invalidation | Low | Contradicted |

### Evidence For H1
- `settings-hash.ts`: 9 `COLOR_IMPACTING_KEYS` correctly enumerated (5 color + 3 quality + 1 sizes key).
- Compile-time guard `_ColorKeysAreSettingKeys` enforces all listed keys are valid `GallerySettingKey` — catches typos and removed keys.
- `buildHashFromConfig` sorts `imageSizes` ascending before hashing (AGG-R7C3-02).
- `serve-upload.ts`: module-scoped 5 s TTL cache with stale-while-revalidate pattern. On DB failure, serves last-known hash; on true cold start, falls through to `FALLBACK_HASH`. No request is blocked.
- ETag format: `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`.

### Evidence For H2 (compile-time guard gap)
- The `_ColorKeysAreSettingKeys` guard verifies listed keys are valid, but it cannot detect a new byte-impacting setting key that was never added to `COLOR_IMPACTING_KEYS`. CLAUDE.md documents the risk: "CANNOT catch a forgotten new byte-impacting key."

### Evidence Against H3
- `buildHashFromConfig`: `const sortedSizes = [...(config.image_sizes ?? [])].sort((a, b) => a - b)` — sort is present and correct.

### Rebuttal Round
Strongest challenge: the static file serving path (`public/uploads/`) uses Next's own `W/"{size-hex}-{mtime-hex}"` ETag, NOT the settings-hash ETag. Flipping a color-impacting admin setting does NOT invalidate existing static derivatives until a re-encode (backfill). This is a documented and accepted operational gap (CLAUDE.md "Operational gotcha CRT-D1"), not a code defect.

### Current Best Explanation
SOUND. The color detection precedence, encoder decision matrix, and ETag formula are correctly implemented. H2 is a process gap, not a code gap, and is acknowledged in CLAUDE.md.

---

## Flow 5 — Backfill advisory lock + delete-during-reencode race + orphaned file cleanup

### Observation
The in-app backfill runner and the sidecar backfill script can run concurrently with the live upload queue and with admin-triggered image deletes. The question is whether the advisory lock and post-encode cleanup prevent double-encodes and orphaned files.

### Hypotheses

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | Both entry points correctly serialize via advisory locks and handle delete-during-reencode with full-scan cleanup | High | Strong |
| 2 | The live queue worker can race the backfill runner on a retried-failed row (processed=true rows re-enqueued) | Low | Contradicted by per-image lock |
| 3 | Detection failure after a successful re-encode could incorrectly version-bump the row, preventing retry | Low | Contradicted |

### Evidence For H1
- `admin-backfill-runner.ts`: `acquireBackfillLock()` uses `GET_LOCK('gallerykit_color_pipeline_backfill', 0)` (non-blocking). Concurrent callers get `{ status: 'already_running' }`.
- Per-image `acquireImageProcessingClaim()` inside the runner uses `GET_LOCK('gallerykit:image-processing:{id}', 0)`, identical semantics to the live queue worker's lock. A row claimed by the live queue is skipped (counted as `skippedLocked`), not raced.
- Delete-during-reencode: post-UPDATE `affectedRows === 0` → `deleteImageVariants(dir, file, [])` (full scan), counted as `deletedMidReencode`. No orphans, no false success/failure.
- State type JSDoc: "Rows whose re-encode succeeded but color detection threw. Derivative columns are persisted WITHOUT a pipeline_version bump so a later run retries detection."

### Evidence Against H2
- The per-image lock `gallerykit:image-processing:{id}` is the same lock name used by both the live queue worker and the backfill runner. MySQL advisory locks are connection-scoped, so a live queue worker holding the lock means the backfill runner gets acquired=0 (non-blocking) and correctly skips that row.

### Evidence Against H3
- Code path: re-encode succeeds → detection throws → `detectionFailures++` → version NOT bumped → row remains below `IMAGE_PIPELINE_VERSION` → next run retries. Documented in runner's state type JSDoc.

### Rebuttal Round
Strongest challenge: `lastError` in `AdminBackfillState` is last-writer-wins at concurrency > 1 — whichever worker failed last overrides the string message. This is documented in the JSDoc: "Do NOT treat `lastError` as a per-row failure log." Failure counts (`errors`, `encodeFailures`, `detectionFailures`) are additive and correct. The single scalar message is an acceptable tradeoff for a process-local admin status surface.

### Current Best Explanation
SOUND. Both entry points correctly serialize, handle the delete race, and correctly avoid version-bumping on detection failure.

---

## Flow 6 — View-event GC / audit-log sweep retention cutoff (negative/NaN env)

### Observation
If `VIEW_RETENTION_DAYS` or `AUDIT_LOG_RETENTION_DAYS` is set to a negative, zero, or non-finite value, the purge cutoff could be set to a future timestamp (causing all rows to be deleted) or suppress the purge entirely.

### Hypotheses

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | Both guards correctly reject negative and NaN values and fall back to DEFAULT | High | Strong (direct source read) |
| 2 | `Number.parseInt` with a non-numeric string returns NaN; `isFinite(NaN)` is false → falls back correctly | High | Strong |
| 3 | A zero value slips through | Low | Contradicted |

### Evidence For H1 and H2
- `view-retention.ts` `resolveRetentionMs()`:
  - `Number.parseInt(env, 10)` → stored as `retentionDays`
  - `Number.isFinite(retentionDays) && retentionDays > 0` → else `DEFAULT_VIEW_RETENTION_DAYS`
  - Covers: NaN (isFinite fails), negative (> 0 fails), Infinity (isFinite fails), zero (> 0 fails).
- `audit.ts` `purgeOldAuditLog()`: identical guard pattern.
- Chunked purge: `VIEW_PURGE_BATCH = 5000` rows, `MAX_BATCHES_PER_TABLE = 200` cap — prevents a single runaway sweep even if a misconfigured cutoff ever fired.

### Evidence Against H3
- The condition is `retentionDays > 0` (strictly greater than), so zero returns DEFAULT. Not `>= 0`.

### Rebuttal Round
None. The guard is airtight for all out-of-range inputs.

### Current Best Explanation
SOUND. Both retention guards correctly handle all degenerate env values.

---

## Findings

### R12-TRC-01 — `hasTrustedSameOriginWithOptions` export retains `allowMissingSource` escape hatch (LOW / INFORMATIONAL)

**Flow:** Session auth — same-origin check  
**Location:** `/apps/web/src/lib/request-origin.ts:109`

**Observation:** AGG-M9 hardened `hasTrustedSameOrigin()` to default fail-closed (`allowMissingSource = false`). However, `hasTrustedSameOriginWithOptions` is still exported as a named export at line 109: `export { hasTrustedSameOriginWithOptions }`. The option parameter `{ allowMissingSource?: boolean }` remains accessible to any future importer.

**Evidence for:** No production caller currently passes `allowMissingSource: true` (grep confirms). The test file at `__tests__/request-origin.test.ts:139` uses the phrase "retains the explicit loose opt-in", confirming the export is intentional. The comment in `request-origin.ts:88-89` states: "Callers that intentionally need the legacy loose contract must opt in via `allowMissingSource: true`."

**Assessment:** Intentional design decision; no current production risk. The risk is forward-facing: a future developer adding a new server action could accidentally call `hasTrustedSameOriginWithOptions({ allowMissingSource: true })` instead of the closed-default `hasTrustedSameOrigin()`, and the incorrect call would not trigger a compile error or lint gate.

**Suggested fix (optional):** Add a `@remarks` JSDoc warning that this function is an escape hatch and should not be called with `allowMissingSource: true` in new code. Alternatively, add the function name to the `lint:action-origin` scan's watchlist.

**Severity:** LOW / INFORMATIONAL  
**Confidence:** High

---

### R12-TRC-02 — `BoundedMap.entries()` returns raw mutable iterator (LOW / INFORMATIONAL)

**Flow:** Rate-limit bucket state mutation  
**Location:** `/apps/web/src/lib/bounded-map.ts:115-117`

**Observation:** `BoundedMap.get()` explicitly returns a shallow copy (`{ ...value }`) to prevent external mutation of internal map state. `BoundedMap.entries()` returns `this.map.entries()` — raw entries, including raw value references. A caller iterating via `entries()` and mutating value properties would corrupt internal map state, bypassing the copy protection of `get()`.

**Evidence for:** Grep confirms zero production callers of `.entries()` on any BoundedMap instance in `apps/web/src/`. The method is defined but unused in production. The comment at line 114 reads "Iterate over entries for external consumers that need full access" — the "full access" phrasing suggests mutation is permitted, which is inconsistent with `get()`'s protective copy policy.

**Failure scenario (latent):** A future rate-limit consumer iterates via `entries()` and mutates `entry.count` directly, bypassing the `BoundedMap.set()` path and hard-cap enforcement.

**Suggested fix:** Either change `entries()` to return copies consistent with `get()`, or add an explicit JSDoc `@remarks` warning that mutating values returned by `entries()` corrupts internal map state.

**Severity:** LOW / INFORMATIONAL  
**Confidence:** High — gap is real but inactive; no production callers

---

### R12-TRC-03 — `getPasswordChangeRateLimitEntry` missing final `{ ...entry }` spread (INFORMATIONAL)

**Flow:** Rate-limit — password change path  
**Location:** `/apps/web/src/lib/auth-rate-limit.ts`, `getPasswordChangeRateLimitEntry()`

**Observation:** `getLoginRateLimitEntry()` returns `{ ...entry }` (explicit final spread on an already-copied value). `getPasswordChangeRateLimitEntry()` returns `entry` directly. Both are functionally safe today because `BoundedMap.get()` already returns `{ ...value }`. The inconsistency creates a future maintainability trap: if `BoundedMap.get()` were ever changed to return the raw reference, `getLoginRateLimitEntry` would still be safe (its own final spread protects it) while `getPasswordChangeRateLimitEntry` would not.

**Suggested fix:** Add `return { ...entry }` as the final return in `getPasswordChangeRateLimitEntry()` for consistency and layered defense-in-depth.

**Severity:** INFORMATIONAL  
**Confidence:** High — currently safe; risk is contingent on BoundedMap regression

---

## Flows Confirmed Sound

All six primary flows traced end-to-end and found correctly implemented:

1. **Upload → queue claim → Sharp → conditional UPDATE → delete-during-processing cleanup** — SOUND. Per-image advisory lock, `affectedRows === 0` detection, `deleteImageVariants(dir, file, [])` full-scan cleanup, MAX_CLAIM_RETRIES escalation.

2. **Session token creation → cookie → middleware guard → isAdmin() in server actions** — SOUND. Middleware is format-check-only (cheap early redirect); authoritative HMAC+DB verification in every server action. API routes excluded from middleware by design; `lint:api-auth` gate enforces `withAdminAuth()` on all `/api/admin/**` routes.

3. **getClientIp → TRUST_PROXY / TRUSTED_PROXY_HOPS → per-IP rate-limit bucket key** — SOUND. XFF only trusted with `TRUST_PROXY=true`; hop count defaults safely to 1; chain-too-short falls through to `X-Real-IP`.

4. **Color detection precedence → encoder decision → ETag/settings-hash invalidation** — SOUND. 9 COLOR_IMPACTING_KEYS, compile-time guard, `imageSizes` sorted before hashing, stale-while-revalidate serving hash. Documented static-path gotcha (CRT-D1) is accepted and acknowledged in CLAUDE.md.

5. **Backfill advisory lock + delete-during-reencode race** — SOUND. Serialized by `gallerykit_color_pipeline_backfill`; per-image lock prevents double-encode; `affectedRows === 0` full-scan cleanup; detection failure leaves version un-bumped for retry.

6. **View-event GC / audit-log retention cutoff (negative/NaN)** — SOUND. `Number.parseInt(env, 10)` + `isFinite && > 0` guard in both `view-retention.ts` and `audit.ts`. Chunked batch cap prevents runaway sweep.

---

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |
| INFORMATIONAL | 1 |
| SOUND (no finding) | 6 flows |
