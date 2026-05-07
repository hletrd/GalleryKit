# Test Engineer Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository — test coverage gaps, flaky tests, TDD opportunities, missing edge-case tests.

## Inventory reviewed

Test files in `apps/web/src/__tests__/` and `apps/web/e2e/`. Cross-referenced with source files to identify untested code paths and missing edge-case coverage.

---

## Findings

### C1F-TE-01 (High / High). No integration test for `getImage` prev/next navigation with identical timestamps

- Location: `apps/web/src/lib/data.ts:682-753`
- The `getImage` function's prev/next navigation uses complex composite conditions on `(capture_date, created_at, id)`. There are no tests verifying the behavior when multiple images share identical `capture_date` and `created_at` values (batch uploads without EXIF).
- **Severity**: Medium — the logic is complex and fragile.
- **Fix**: Add a unit test that creates 5 images with identical timestamps and different IDs, then verifies prev/next for each.

### C1F-TE-02 (Medium / High). No test for rate-limit rollback on unexpected login errors

- Location: `apps/web/src/app/actions/auth.ts:249-258`
- The rollback path when `login` encounters an unexpected error (not wrong password, but infrastructure failure) is untested. This is the path identified in C1F-CR-04 where rollback gives the attacker extra attempts.
- **Severity**: Medium — this is a security-relevant path.
- **Fix**: Add a test that simulates an Argon2 error during login and verifies the rate-limit counter is correctly handled.

### C1F-TE-03 (Medium / Medium). No test for view count buffer behavior during DB outage

- Location: `apps/web/src/lib/data.ts:62-148`
- The view count buffer has complex behavior: atomic Map swap, chunked flushing, retry counting, exponential backoff, and capacity-based dropping. None of these edge cases appear to have dedicated tests.
- **Severity**: Medium — the buffer handles money-adjacent data (analytics) and has complex failure modes.
- **Fix**: Add unit tests for: (a) buffer at capacity drops new increments, (b) failed flush re-buffers with retry count, (c) retry count exceeds max and drops increment, (d) concurrent flush prevention.

### C1F-TE-04 (Medium / Medium). No test for image processing queue bootstrap with permanently-failing images

- Location: `apps/web/src/lib/image-queue.ts:397-474`
- The bootstrap re-scan cycle identified in C1F-DB-02 (fail 3x → bootstrap → re-enqueue → repeat) has no test. This could cause the queue to loop indefinitely.
- **Severity**: Medium — could cause resource waste in production.
- **Fix**: Add a test that simulates 3 failures and verifies the bootstrap re-scan behavior.

### C1F-TE-05 (Low / Medium). No test for `sanitizeAdminString` returning `rejected=true` with stripped value

- Location: `apps/web/src/lib/sanitize.ts:130-148`
- The `sanitizeAdminString` function returns both `value` and `rejected` flag. If a caller ignores `rejected`, the stripped value gets persisted. There's no test verifying that callers check `rejected`.
- **Severity**: Low — current callers are verified, but a regression test would catch future violations.
- **Fix**: Add a lint-like test that scans action files for `sanitizeAdminString` usage and verifies `rejected` is checked.

### C1F-TE-06 (Low / Low). Missing edge-case tests for `normalizeImageListCursor`

- Location: `apps/web/src/lib/data.ts:447-472`
- The cursor normalization function handles multiple input formats (Date objects, ISO strings, MySQL datetime strings). Edge cases like extremely large IDs, negative IDs, and malformed date strings should be tested.
- **Severity**: Low — the function has reasonable guards.
- **Fix**: Add tests for edge cases: `id: 0`, `id: -1`, `id: Infinity`, `created_at: "not-a-date"`.
