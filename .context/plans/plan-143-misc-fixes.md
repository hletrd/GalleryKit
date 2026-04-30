# Plan 143: Miscellaneous Fixes from Cycle 1 Review

**Priority:** P2-P3
**Source:** Multiple reviewers

## Findings to Address

### 1. Add `.tmp` file cleanup on startup (debugger D5)
**File:** `apps/web/src/lib/image-queue.ts` or `apps/web/src/instrumentation.ts`
- On startup, scan UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG for `.tmp` files
- Delete any found (they're orphans from crashed processes)
- Low risk: `.tmp` files are never served (SAFE_SEGMENT regex rejects them)

### 2. Fix `cleanString` over-aggressive null coercion (code-reviewer C5, debugger D6)
**File:** `apps/web/src/lib/process-image.ts:423-428`
- Only check for `'undefined'`/`'null'` string literals if the input was NOT originally a string
- This prevents dropping legitimate EXIF metadata that happens to be the word "null" or "undefined"

### 3. Remove redundant `topicRouteSegmentExists` pre-check (code-reviewer C8)
**File:** `apps/web/src/app/actions/topics.ts:59-61`
- The ER_DUP_ENTRY catch at line 91 already handles this case
- The pre-check adds an unnecessary DB query on the happy path
- Keep the `topicRouteSegmentExists` call in `createTopicAlias` since aliases may not have unique constraints

### 4. Add TRUST_PROXY startup warning (security-reviewer S6)
**File:** `apps/web/src/lib/rate-limit.ts`
- Log a warning when NODE_ENV=production and TRUST_PROXY is not set
- This alerts operators that rate limiting is ineffective

### 5. Fix `revalidateLocalizedPaths` empty string handling (debugger D3)
**File:** `apps/web/src/lib/revalidation.ts`
- Filter out empty/falsy path arguments before calling revalidatePath
- Prevents unnecessary root page revalidation

## Deferred Items

### D1. CSP headers (security-reviewer S5) — DEFERRED
**Reason:** Adding CSP headers requires careful tuning to avoid breaking existing functionality (inline scripts, styles, image sources). This is a feature addition, not a bug fix. It should be done in a dedicated cycle with proper testing.
**Exit criterion:** When the application is stable and a full CSP audit can be performed.

### D2. CSRF Origin header check (security-reviewer S2) — DEFERRED
**Reason:** Next.js 14+ provides built-in CSRF protection for server actions via Origin header checks. This was verified to be active by default. Adding an explicit check in middleware would be redundant and could break legitimate flows.
**Exit criterion:** If Next.js's built-in CSRF protection is ever found insufficient.

### D3. Full `RateLimiter` class (architect A2) — DEFERRED (see plan-142)

### D4. Storage backend integration (critic CR3, architect A3) — DEFERRED
**Reason:** The storage module correctly documents that it's "not yet integrated." This is a feature, not a bug. Full integration requires significant refactoring of process-image.ts and serve-upload.ts.
**Exit criterion:** When the storage backend is prioritized as a feature.

### D5. UI/UX accessibility issues (designer U1-U6) — DEFERRED
**Reason:** These are feature enhancements (keyboard navigation, ARIA roles, reduced motion). They require dedicated design and testing cycles. The current codebase has basic accessibility through shadcn/ui components.
**Exit criterion:** When an accessibility audit is prioritized.

### D6. Test coverage expansion (test-engineer T1-T6) — DEFERRED
**Reason:** Adding comprehensive tests for all server actions, image processing, and data access layer is a significant undertaking. It should be done incrementally alongside feature work.
**Exit criterion:** When test coverage is prioritized as a goal.

### D7. Batch tag deadlock retry (debugger D4) — DEFERRED
**Reason:** MySQL deadlocks on concurrent tag operations are rare and the error is returned to the user who can retry. Adding retry logic adds complexity for a low-probability event.
**Exit criterion:** If deadlocks become frequent in production.

### D8. Upload tracker eviction race (debugger D2) — DEFERRED
**Reason:** The race requires a 2+ hour upload window and concurrent uploads from the same IP. Extremely unlikely in practice.
**Exit criterion:** If upload tracking issues are reported.

### D9. `getImages` deprecation in favor of `getImagesLite` (perf-reviewer P1) — DEFERRED
**Reason:** `getImages` is currently unused (all consumers use `getImagesLite`). Deprecation is a documentation change, not a code fix.
**Exit criterion:** When `getImages` is confirmed unused and can be removed.

### D10. View count flush connection pool pressure (perf-reviewer P2) — DEFERRED
**Reason:** With MAX_VIEW_COUNT_BUFFER_SIZE=1000, the flush creates up to 1000 concurrent UPDATE queries. However, the pool limit of 10 connections naturally throttles this. The current behavior is acceptable for a personal gallery.
**Exit criterion:** If view count flush causes connection pool exhaustion.

### D11. Bootstrap queue unlimited select (perf-reviewer P3) — DEFERRED
**Reason:** Adding a LIMIT to the bootstrap query requires batch processing logic. For a personal gallery with typically <1000 unprocessed images, the current approach is fine.
**Exit criterion:** If bulk imports of >10,000 images become common.

## Exit Criteria
- `.tmp` file cleanup runs on startup
- `cleanString` no longer drops legitimate string values
- `topicRouteSegmentExists` pre-check removed from `createTopic`
- TRUST_PROXY warning logged in production
- Empty string paths filtered in `revalidateLocalizedPaths`
- All existing tests pass

## Implementation Status: PARTIALLY DONE
- 1. .tmp file cleanup on startup ✅ (0000000338)
- 2. cleanString over-aggressive null coercion ✅ (0000000260)
- 3. Remove topicRouteSegmentExists pre-check ✅ (00000005e6)
- 4. TRUST_PROXY startup warning ✅ (0000000e79)
- 5. revalidateLocalizedPaths empty string handling ✅ (00000001d7)
- CLAUDE.md update ✅ (000000046)
All deferred items remain deferred per the plan.
