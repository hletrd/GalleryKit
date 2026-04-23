# Test Engineer Review — Cycle 1 (New Loop)

**Reviewer:** Test coverage gaps, flaky tests, TDD opportunities
**Date:** 2026-04-19

## Methodology
- Reviewed all test files in `apps/web/src/__tests__/`
- Identified untested critical paths
- Checked for test quality and edge case coverage
- Compared test surface against CLAUDE.md test commands

## Existing Test Coverage
- `base56.test.ts` — Base56 encoding/decoding
- `session.test.ts` — Session token generation and verification
- `validation.test.ts` — Slug, alias, tag name, filename validation
- `queue-shutdown.test.ts` — Queue drain on shutdown
- `rate-limit.test.ts` — Rate limit pruning, IP normalization
- `auth-rate-limit.test.ts` — Login/password rate limit logic
- `revalidation.test.ts` — Path revalidation logic
- `locale-path.test.ts` — Locale path utilities
- `sql-restore-scan.test.ts` — SQL restore dangerous pattern detection

## Findings

### C1N-13: No tests for `searchImagesAction` rate limit rollback logic [MEDIUM, Medium Confidence]
**File:** `apps/web/src/app/actions/public.ts`
**Problem:** The search rate limit has a complex pre-increment + DB check + rollback pattern. There are no unit tests for this action, and the rollback logic at lines 74-84 (for DB increment failure) and the missing rollback at lines 62-69 (for DB limited=true) are both untested. This is a high-value test target because the logic is subtle and error-prone.
**Suggested fix:** Add unit tests for `searchImagesAction` covering:
1. Normal search (under limit)
2. Rate limit hit (in-memory)
3. Rate limit hit (DB-backed)
4. DB increment failure (rollback)
5. DB check returns limited (should rollback in-memory counter)
6. Concurrent requests (TOCTOU)

### C1N-14: No tests for image processing queue retry logic [LOW, Medium Confidence]
**File:** `apps/web/src/lib/image-queue.ts`
**Problem:** The queue has complex retry logic (MAX_RETRIES, claim retries, escalating delays) but no unit tests. The queue-shutdown test covers the drain logic but not the retry/count paths.
**Suggested fix:** Add integration tests for:
1. Failed processing retry
2. Max retries exceeded (job abandoned)
3. Claim lock contention (another worker has the lock)
4. Image deleted during processing (orphaned file cleanup)

### C1N-15: No tests for `flushGroupViewCounts` and view count buffering [LOW, Medium Confidence]
**File:** `apps/web/src/lib/data.ts:12-65`
**Problem:** The view count buffering system (Map + timer + flush + re-buffer on failure) has no tests. This is a subtle concurrent system with several edge cases (buffer cap, re-buffer during flush, concurrent flush prevention).
**Suggested fix:** Add tests for:
1. Normal buffer + flush cycle
2. Buffer cap enforcement (MAX_VIEW_COUNT_BUFFER_SIZE)
3. Re-buffer on flush failure
4. Concurrent flush prevention (isFlushing flag)
5. Graceful shutdown flush

### C1N-16: No tests for server actions (images, sharing, topics, tags, admin-users) [LOW, Low Confidence]
**File:** `apps/web/src/app/actions/*.ts`
**Problem:** None of the server actions have unit tests. Testing them requires mocking the DB and auth layer, which is non-trivial but important for a production application.
**Suggested fix:** Add integration tests with a test database, or mock-based unit tests for the validation and error handling paths at minimum.

## No-New-Findings Items
- Existing tests are well-structured and cover their respective modules
- Validation tests cover edge cases well
- SQL restore scan tests are comprehensive
