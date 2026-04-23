# Code Reviewer -- Cycle 11 (2026-04-23)

## Scope
Full repository review of all server actions, libraries, routes, and data access layer in `apps/web/src/`. Focus on rate-limit consistency, error handling, privacy guards, and TOCTOU protections — areas hardened in cycles 1-10.

## Files Reviewed
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`

## Findings

### C11-FRESH-01 — `createAdminUser` does not roll back rate-limit on `ER_DUP_ENTRY`
- **Severity:** LOW / MEDIUM (usability with security dimension)
- **Confidence:** High
- **File:** `apps/web/src/app/actions/admin-users.ts`
- **Lines:** 159-173 (catch branch)
- **Problem:** When `db.insert(adminUsers)` throws `ER_DUP_ENTRY` (username already exists), the catch branch returns `{ error: t('usernameExists') }` WITHOUT rolling back either the in-memory counter (line 111, `checkUserCreateRateLimit`) or the DB-backed counter (line 119, `incrementRateLimit`). In contrast, the generic-error branch (lines 163-171) does roll back both counters.
- **Failure scenario:** An admin makes 10 legitimate attempts to create a new user, each time typing a username that happens to match an existing admin (e.g., due to a shared naming convention), and gets locked out for 1 hour because each duplicate-entry attempt consumed a rate-limit slot without being returned. The admin cannot create new users during that window even though no brute-force activity occurred.
- **Ordering inconsistency:** All the other adjacent improvements in this code path (AGG10R-RPL-01, AGG9R-RPL-01, C11R2-02) emphasize that legitimate form-field typos must NOT consume a rate-limit slot. Duplicate-username is the same class of user-error and deserves the same rollback treatment.
- **Fix:** In the catch branch, after the `ER_DUP_ENTRY` check, roll back both counters before returning `{ error: t('usernameExists') }`. Match the rollback pattern from the generic-error branch (lines 166-171).
- **Regression test:** Add a unit test in `admin-user-create-ordering.test.ts` verifying that a duplicate-username failure rolls back both the in-memory `userCreateRateLimit` Map and calls `resetRateLimit` for the DB bucket.

## Previously-addressed findings confirmed fixed
- **AGG10R-RPL-01 (`createAdminUser` form-field validation ordering)**: lines 89-104 correctly validate BEFORE rate-limit pre-increment. Confirmed fixed.
- **AGG9R-RPL-01 (`updatePassword` form-field validation ordering)**: lines 288-306 correctly validate BEFORE pre-increment. Confirmed fixed.
- **C46-01 (`tagsString` sanitize-before-validate)**: line 103 correctly sanitizes before length check.
- **C46-02 (`searchImagesAction` query sanitize-before-validate)**: `public.ts` line 29 correctly sanitizes before length check.
- **C7R2-01 / C7R2-02 (`createTopicAlias` / `createTopic` control-char rejection)**: both correctly reject malformed input.
- **C2R-01 (`unstable_rethrow` in `updatePassword`)**: line 399 correctly rethrows Next.js internal control-flow signals.

## Areas of strength
1. **Rate-limit rollback consistency**: Every long-running auth path now rolls back BOTH in-memory and DB counters on infrastructure failures. Duplicate-username is the remaining exception identified above.
2. **Privacy guards**: `publicSelectFields` derived from `adminSelectFields` with compile-time `_privacyGuard` assertion. No PII leakage path.
3. **Advisory locks**: `deleteAdminUser` and `withTopicRouteMutationLock` both use MySQL `GET_LOCK`/`RELEASE_LOCK` for correctness under concurrency.
4. **Sanitize-before-validate pattern**: Uniformly applied across all server actions. The "if sanitization changes the value, reject" defense-in-depth check is consistently used for destructive operations.

## Confidence note
All findings validated against source with line-exact citations. The identified issue (C11-FRESH-01) is a consistency gap in an established pattern rather than a novel vulnerability, which aligns with the mature state of the codebase.
