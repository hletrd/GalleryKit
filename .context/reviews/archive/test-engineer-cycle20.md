# Test Engineer — Cycle 20

## Review Scope
Test coverage gaps, flaky tests, edge case testing, and TDD opportunities for the existing test suite.

## New Findings

### TE-20-01: No test for `uploadTracker` negative-count scenario [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` (no corresponding test in `__tests__/`)
- **Description**: The `uploadTracker` Map in `uploadImages` is an in-memory server-side state with no test coverage. The negative-count bug (CR-20-05/SEC-20-01/DBG-20-01/ARCH-20-01/VER-20-01) would be caught by a test that: (1) uploads N files that all fail, (2) then uploads M files that succeed, and (3) verifies the tracker count is N + M (not M + negative drift from step 1). However, since `uploadImages` is a server action that depends on FormData, Sharp, and the DB, testing it requires significant mocking. This is already covered by TE-38-01 (server action test gaps).
- **Fix priority**: Medium — the bug itself should be fixed (clamp to 0), and a unit test for the tracker adjustment logic would prevent regression.

### TE-20-02: No test for `deleteAdminUser` returning success on non-existent user [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/admin-users.ts` (no corresponding test)
- **Description**: The function returns `{ success: true }` even when the user ID doesn't exist. A test should verify the return value when deleting a non-existent user.
- **Fix priority**: Low — this is a behavior correctness issue, not a security or data integrity issue.

### TE-20-03: `searchImagesAction` rate-limit rollback test is missing [LOW] [LOW confidence]
- **File**: `apps/web/src/__tests__/rate-limit.test.ts`
- **Description**: The rate-limit rollback logic in `searchImagesAction` (public.ts lines 69-74) is not explicitly tested. The general rate-limit tests exist but don't cover the rollback-after-DB-limit pattern specific to search.
- **Fix priority**: Low — the rollback pattern is the same as login and share creation, which have been tested in prior cycles.

## Existing Test Assessment

Existing tests cover:
- `base56.test.ts` — encoding/decoding
- `session.test.ts` — token generation and verification
- `queue-shutdown.test.ts` — queue drain on shutdown
- `auth-rate-limit.test.ts` — login/password rate limiting
- `revalidation.test.ts` — path revalidation
- `locale-path.test.ts` — i18n path construction
- `sql-restore-scan.test.ts` — SQL dump security scanning
- `rate-limit.test.ts` — IP normalization and rate limiting
- `validation.test.ts` — input validation

Missing coverage (unchanged from prior cycles):
- Server actions (images, topics, tags, sharing, admin-users, settings, seo, public)
- Image processing pipeline (process-image.ts)
- Data layer (data.ts)
- Upload serving (serve-upload.ts)
- Storage backends (storage/*.ts)

These gaps are tracked in prior deferred items (TE-38-01 through TE-38-04).
