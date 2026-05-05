# Aggregate Review — Cycle 7 (2026-05-06)

## Review Method

Deep single-pass review of all source files from 10 specialist perspectives:
- Security (`security-reviewer-c7.md`)
- Code Quality (`code-reviewer-c7.md`)
- Performance (`perf-reviewer-c7.md`)
- Test Coverage / Correctness (`test-engineer-c7.md`)
- Architecture (`architect-c7.md`)
- Debuggability (`debugger-c7.md`)
- Documentation (`document-specialist-c7.md`)
- UI/UX (`designer-c7.md`)
- Critical / Contradiction Analysis (`critic-c7.md`)
- Verification (`verifier-c7.md`)
- Data Flow Tracing (`tracer-c7.md`)

Key modules examined: `data.ts`, `auth.ts`, `session.ts`, `rate-limit.ts`, `image-queue.ts`, `process-image.ts`, `images.ts`, `admin-users.ts`, `api-auth.ts`, `admin-tokens.ts`, `og/photo/[id]/route.tsx`, `sw.js`, `gallery-config.ts`, `bounded-map.ts`, `upload-tracker-state.ts`, `proxy.ts`, `health/route.ts`, `content-security-policy.ts`, `image-manager.tsx`, `photo-viewer.tsx`.

---

## New Findings (not in cycles 1-6 deferred lists)

### HIGH severity

#### C7-HIGH-01: `deleteAdminUser` advisory lock name is not scoped per-user
- **Source:** Code review of `apps/web/src/app/actions/admin-users.ts:207`
- **Location:** `deleteAdminUser()` function
- **Issue:** The advisory lock `gallerykit_admin_delete` is a single global lock. If two admins concurrently delete different users, one blocks for 5 seconds and then fails with `DELETE_LOCK_TIMEOUT` even though the operations are independent.
- **Fix:** Scope the lock to the target user ID: `gallerykit_admin_delete:${id}`.
- **Confidence:** High

#### C7-SEC-01: `/api/og/photo/[id]/route.tsx` missing rate limiting
- **Source:** Security review
- **Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
- **Issue:** CPU-intensive GET route (Satori render, base64 encode) has NO rate-limit gate. The main `/api/og/route.tsx` has `preIncrementOgAttempt` (plan-233) but the photo sub-route does not. The `check-public-route-rate-limit.ts` lint gate only scans mutating methods (POST/PUT/PATCH/DELETE), so this gap is invisible to CI.
- **Fix:** Add `preIncrementOgAttempt` / `rollbackOgAttempt` calls mirroring the main OG route. Also expand the lint gate or document the GET exemption explicitly.
- **Confidence:** High

### MEDIUM severity

#### C7-SEC-02: `withAdminAuth` wrapper omits Cache-Control on success responses
- **Source:** Security review
- **Location:** `apps/web/src/lib/api-auth.ts:100-104`
- **Issue:** `NO_STORE_HEADERS` is only applied to error responses. Successful admin API responses (e.g., DB backup download) could be cached by intermediaries.
- **Fix:** Set `Cache-Control: no-store, no-cache, must-revalidate` on all responses from `withAdminAuth` unless the handler explicitly sets its own cache policy.
- **Confidence:** Medium

#### C7-SEC-03: `check-public-route-rate-limit.ts` lint gate covers only mutating HTTP methods
- **Source:** Security review + Critic review
- **Location:** `apps/web/src/scripts/check-public-route-rate-limit.ts`
- **Issue:** CPU-intensive GET routes (OG, image serving) are exempt from the gate by design. The gate's header claims it protects "every PUBLIC API route file" which is misleading.
- **Fix:** Option 2 recommended — require explicit `@public-no-rate-limit-required: <reason>` on all GET routes that call expensive code, and update the gate header to be accurate.
- **Confidence:** Medium

#### C7-MED-01: `BoundedMap.prune()` deletes during Map iteration
- **Source:** Code review
- **Location:** `apps/web/src/lib/bounded-map.ts:101-105`
- **Issue:** ES6-safe but fragile pattern; same pattern in `upload-tracker-state.ts` and `image-queue.ts`.
- **Fix:** Collect keys first, then delete in a separate pass. Extract a generic `pruneMapFifo` utility.
- **Confidence:** Medium

#### C7-MED-02: `uploadTracker` prune iteration-deletion duplicates BoundedMap logic
- **Source:** Code review
- **Location:** `apps/web/src/lib/upload-tracker-state.ts:27-30`
- **Issue:** Duplicate FIFO eviction logic. Hard-cap eviction (lines 33-40) is a third copy.
- **Fix:** Migrate `uploadTracker` to use `BoundedMap` or extract a shared utility.
- **Confidence:** Medium

#### C7-MED-03: `image-manager.tsx` edit dialog `maxLength` counts UTF-16 code units, not code points
- **Source:** Code review + Design review
- **Location:** `apps/web/src/components/image-manager.tsx:496-500`
- **Issue:** Client-side limit is stricter than server allows for emoji/supplementary characters.
- **Fix:** Custom `onChange` handler using `countCodePoints` with a visible character counter.
- **Confidence:** Medium

#### C7-MED-04: `searchImages` GROUP BY with all individual columns is fragile
- **Source:** Code review
- **Location:** `apps/web/src/lib/data.ts:1127-1139`
- **Issue:** Adding a column to `searchFields` requires updating two GROUP BY clauses. Missing one breaks under `ONLY_FULL_GROUP_BY`.
- **Fix:** Add a comment above `searchFields` noting the coupling, or refactor to group by `images.id` only.
- **Confidence:** Medium

#### C7-MED-05: `image-queue.ts` `claimRetryCounts` not cleaned when `permanentlyFailedIds` is capped
- **Source:** Code review
- **Location:** `apps/web/src/lib/image-queue.ts:341-345`
- **Issue:** Eviction from `permanentlyFailedIds` does not clean `claimRetryCounts` or `retryCounts`.
- **Fix:** Delete corresponding entries from all Maps when evicting from `permanentlyFailedIds`.
- **Confidence:** Medium

#### C7-CODE-01: `data.ts` line count approaching 1500 — god module risk
- **Source:** Code quality review
- **Location:** `apps/web/src/lib/data.ts`
- **Issue:** ~1480 lines, carrying D3-MED from cycle 2. View-count buffer logic adds non-DAL responsibility.
- **Fix:** Extract view-count buffer to `lib/view-count-buffer.ts`; plan extraction of image/topic/shared-group query modules.
- **Confidence:** Medium

#### C7-CODE-02: Inconsistent error-return patterns between server actions
- **Source:** Code quality review
- **Location:** `apps/web/src/app/actions/images.ts`, `sharing.ts`, `admin-users.ts`
- **Issue:** Mix of `{ success: false, error }` returns and direct `throw`. Client code must know which convention each action uses.
- **Fix:** Standardize on structured returns for new actions; document auth.ts exception.
- **Confidence:** Medium

#### C7-PERF-01: OG image generation lacks output-size bounding before base64 encoding
- **Source:** Performance review
- **Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:74-82`
- **Issue:** `fetch(photoUrl)` does not bound response body size. A large/malicious response could OOM before `OG_PHOTO_MAX_BYTES` check.
- **Fix:** Check `Content-Length` header before consuming body, or use a streaming size guard.
- **Confidence:** Medium

#### C7-PERF-02: `searchImagesAction` performs three DB queries sequentially
- **Source:** Performance review
- **Location:** `apps/web/src/lib/data.ts:~1050-1170`
- **Issue:** Tag/alias searches always pay main query latency first.
- **Fix:** Run queries in parallel with `Promise.all`, then merge/deduplicate.
- **Confidence:** Medium

#### C7-TEST-01: No test for OG photo route rate-limit bypass
- **Source:** Test coverage review
- **Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
- **Issue:** No Vitest or Playwright test verifying rate limiting on the per-photo OG route.
- **Fix:** Add integration test after wiring rate-limit helpers (C7-SEC-01).
- **Confidence:** Medium

#### C7-TEST-02: Missing test for `deleteAdminUser` concurrent-lock timeout
- **Source:** Test coverage review
- **Location:** `apps/web/src/app/actions/admin-users.ts`
- **Issue:** No test for GET_LOCK timeout path or scoped-lock concurrent behavior.
- **Fix:** Add Vitest tests with mocked connection.
- **Confidence:** Medium

#### C7-DEBUG-01: `image-queue.ts` permanent failure lacks failure reason in logs
- **Source:** Debuggability review
- **Location:** `apps/web/src/lib/image-queue.ts:~340-345`
- **Issue:** "Image N permanently failed" log does not include the underlying error.
- **Fix:** Include last error message (truncated) in the log.
- **Confidence:** Medium

#### C7-TRACE-01: View count buffer state is split across two Maps
- **Source:** Data flow review
- **Location:** `apps/web/src/lib/data.ts:17-27`
- **Issue:** Three separate Maps (buffer, retryCount, scalar failure counter) with no unified accessor.
- **Fix:** Encapsulate in a class with `toDebugSnapshot()`.
- **Confidence:** Medium

### LOW severity

#### C7-LOW-01: `upload-tracker-state.ts` prune iteration-deletion on raw Map
- **Fix:** Migrate to BoundedMap or use collect-then-delete. (Same as C7-MED-01)

#### C7-LOW-02: `proxy.ts` `isProtectedAdminRoute` asymmetry for `/admin`
- **Fix:** Add comment explaining why `/admin` (no prefix, no slash) is the login page.

#### C7-LOW-03: `photo-viewer.tsx` `navigate` stale closure edge case
- **Fix:** Guard `currentIndex === -1` in navigate.

#### C7-LOW-04: `health/route.ts` DB probe lacks timing
- **Fix:** Add `dbOkDurationMs` to response JSON.

#### C7-LOW-05: `content-security-policy.ts` no `style-src-attr` / `style-src-elem`
- **Already covered by deferred D4-MED.**

#### C7-LOW-06: `admin-users.ts` `deleteAdminUser` error-path lock release
- **Informational only — finally block is correct.**

#### C7-CODE-03: `process-image.ts` 10-bit AVIF probe flag never resets
- **Fix:** Retry up to N times before permanent downgrade.

#### C7-CODE-04: Duplicate retry/eviction logic across modules
- **Fix:** Extract `pruneMapFifo` utility.

#### C7-CODE-05: `searchImages` raw SQL aliases without type safety
- **Fix:** Add compile-time check or refactor to Drizzle relational queries.

#### C7-CODE-06: `adminSettings` key strings scattered as literals
- **Fix:** Centralized `AdminSettingKey` enum.

#### C7-PERF-03: `flushGroupViewCounts` chunk size vs pool capacity
- **Fix:** Document or serialize within chunks.

#### C7-PERF-04: `image-queue.ts` bootstrap scans entire table
- **Fix:** Consider `(processed, id)` index.

#### C7-PERF-05: React `cache()` does not dedupe across requests
- **Fix:** Document intentional absence; consider LRU for config/topics.

#### C7-TEST-03: `image-queue.ts` permanent failure eviction untested
- **Fix:** Add test for eviction + Map cleanup.

#### C7-TEST-04: `process-image.ts` 10-bit AVIF probe failure untested
- **Fix:** Mock sharp to simulate rejection.

#### C7-TEST-05: `bounded-map.ts` prune explicit test gap
- **Fix:** Add targeted prune test.

#### C7-ARCH-02: `rate-limit.ts` approaching module split threshold
- **Deferred.**

#### C7-ARCH-04: `upload-tracker-state.ts` / `upload-tracker.ts` tight coupling
- **Fix:** Merge or clarify responsibilities.

#### C7-ARCH-05: SW cache versioning build-time replacement unverified
- **Fix:** Add runtime assertion.

#### C7-ARCH-06: Smart collections AST depth bound not visible in schema
- **Fix:** Export constants with rationale.

#### C7-DOC-01: `admin-tokens.ts` PAT scope semantics undocumented
- **Fix:** Add doc comment block.

#### C7-DOC-02: Rate-limit lint gate header misleading about GET coverage
- **Fix:** Update header comment.

#### C7-DOC-03: Smart collections AST shape undocumented externally
- **Fix:** Add AST spec comment or markdown doc.

#### C7-UI-02: OG fallback redirects instead of branded placeholder
- **Fix:** Generate static fallback OG image.

#### C7-UI-03: SW stale-while-revalidate may show outdated EXIF metadata
- **Fix:** Include pipeline version in derivative URL.

#### C7-UI-04: Health endpoint lacks human-readable status
- **Fix:** Add `"status"` field.

#### C7-CRIT-03: `requireSameOriginAdmin()` vs `withAdminAuth()` overlap
- **Fix:** Document decision matrix.

#### C7-CRIT-04: SW version replacement invisible and unverified
- **Fix:** Runtime assertion.

#### C7-DEBUG-02: `flushGroupViewCounts` swallows per-group DB errors
- **Fix:** Log error before re-buffering.

#### C7-DEBUG-03: `rate-limit.ts` missing `TRUST_PROXY` warning at startup
- **Fix:** Startup-time production check.

#### C7-DEBUG-04: OG route fallback silent
- **Fix:** Add `console.warn` before each fallback.

#### C7-TRACE-02: Image processing state machine is implicit
- **Fix:** Add `processing_status` enum column (deferred, requires migration).

#### C7-TRACE-03: Upload tracker lacks correlation ID
- **Fix:** Add `uploadBatchId` to logs.

#### C7-TRACE-04: OG route fetches image three times
- **Informational only — acceptable for OG use case.**

---

## Previously fixed findings (confirmed still fixed from cycles 1-6)

- A1-HIGH-01: Login rate-limit rollback — FIXED
- A1-HIGH-02: Image queue infinite re-enqueue — FIXED
- C18-MED-01: searchImagesAction re-throws — FIXED
- C6F-01: getSharedGroup returns null on empty images — FIXED
- C6F-02: isNotNull(capture_date) guards — FIXED
- C6F-03: searchImages GROUP BY with created_at — FIXED
- C4F-08/09: getImageByShareKey blur_data_url and topic_label — FIXED
- C4F-12: search ORDER BY matches gallery — FIXED
- C5F-01: Undated image prev/next navigation — FIXED
- C5F-02: sort-order condition builder consolidation — FIXED

---

## Deferred items carried forward (no change)

- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D1-MED: CSV streaming
- D2-MED: auth patterns inconsistency
- D3-MED: data.ts god module
- D4-MED: CSP unsafe-inline
- D5-MED: getClientIp "unknown" without TRUST_PROXY
- D6-MED: restore temp file predictability
- D7-LOW: process-local state
- D8-LOW: orphaned files
- D9-LOW: env var docs
- D10-LOW: oversized functions
- D11-LOW: lightbox auto-hide UX
- D12-LOW: photo viewer layout shift
- D1-LOW: BoundedMap.prune() iteration delete
- C5F-02: sort-order condition builder consolidation (now fixed)
- C6F-06: getImageByShareKey parallel tag query

---

## Summary Statistics

- Total new findings this cycle: 40+ (including low-severity)
- HIGH severity: 2
- MEDIUM severity: 16
- LOW severity: 20+
- Previously fixed (verified): 10
- Deferred carry-forward: 18 items (no change)
