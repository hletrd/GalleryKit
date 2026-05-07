# Verifier — Cycle 2 Deep Review

## C2-VF-01 (High/High): Verify `permanentlyFailedIds` cleanup on image deletion — NOT implemented

- **File**: `apps/web/src/app/actions/images.ts:482-483`, `584-588`
- **Evidence**: I read the `deleteImage` function (lines 435-521) and `deleteImages` function (lines 523-673). In `deleteImage`, line 483 only removes from `queueState.enqueued.delete(id)`. There is no corresponding `queueState.permanentlyFailedIds.delete(id)`. In `deleteImages`, lines 586-588 loop over `foundIds` removing from `enqueued` only, not `permanentlyFailedIds`. This confirms the bug reported by multiple agents.
- **Status**: CONFIRMED BUG — `permanentlyFailedIds` is not cleaned on image deletion.
- **Confidence**: High

## C2-VF-02 (Medium/High): Verify `normalizeStringRecord` Unicode rejection gap — CONFIRMED

- **File**: `apps/web/src/lib/sanitize.ts:35-55`
- **Evidence**: I read `normalizeStringRecord` (lines 35-55). It calls `stripControlChars(value.trim())` on line 52, which strips Unicode formatting characters. However, it does NOT check `UNICODE_FORMAT_CHARS.test()` before stripping, and it does NOT return a `rejected` flag. This confirms the architectural gap: `sanitizeAdminString` (line 140) checks `UNICODE_FORMAT_CHARS.test(input)` and returns `rejected: true`, while `normalizeStringRecord` silently strips without rejection.
- **Status**: CONFIRMED — architectural inconsistency in the defense-in-depth chain.
- **Confidence**: High

## C2-VF-03 (Medium/High): Verify admin user creation password length ordering — NEEDS CODE INSPECTION

- **File**: `apps/web/src/app/actions/admin-users.ts`
- **Evidence**: Need to verify whether `stripControlChars` is applied before or after the password length check in the `createAdminUser` function. This requires reading the file.
- **Status**: NEEDS VERIFICATION — will inspect the file.
- **Confidence**: Medium

## C2-VF-04 (Medium/Medium): Verify cycle 1 fix for `sanitizeAdminString` returns null when rejected

- **File**: `apps/web/src/lib/sanitize.ts:140-162`
- **Evidence**: I read the current code. Line 156-158 shows: `if (UNICODE_FORMAT_CHARS.test(input)) { return { value: null, rejected: true }; }`. Line 160-161 shows: `const stripped = stripControlChars(input) ?? ''; return { value: stripped, rejected: stripped !== input };`. This confirms the cycle 1 fix is correctly implemented: when Unicode formatting chars are found, value is null; when C0/C1 controls are found, value is the stripped string with rejected=true.
- **Status**: VERIFIED — cycle 1 fix is correct.
- **Confidence**: High

## C2-VF-05 (Medium/Medium): Verify cycle 1 fix for rate-limit rollback removal on infrastructure errors

- **File**: `apps/web/src/app/actions/auth.ts:243-254`
- **Evidence**: I read the current code. Lines 243-254 show the outer catch block in `login()`. The comment on lines 246-252 explicitly states "do NOT roll back the pre-incremented rate-limit counters on unexpected infrastructure errors." The catch block only returns `{ error: t('authFailed') }` with no rollback calls. This confirms the cycle 1 fix is correctly implemented.
- **Status**: VERIFIED — cycle 1 fix is correct.
- **Confidence**: High

## C2-VF-06 (Medium/Medium): Verify cycle 1 fix for queue bootstrap re-enqueue prevention

- **File**: `apps/web/src/lib/image-queue.ts:336-354, 436-438`
- **Evidence**: I read the current code. Lines 336-345 show that when a job fails MAX_RETRIES times, the ID is added to `state.permanentlyFailedIds` (line 341) with FIFO eviction (lines 342-345). Lines 436-438 show the bootstrap query excludes permanently-failed IDs using `notInArray`. Lines 516-518 show `permanentlyFailedIds` is cleared on restore. This confirms the cycle 1 fix is correctly implemented, except for the missing cleanup on image deletion (C2-VF-01).
- **Status**: VERIFIED — cycle 1 fix is correct (modulo the deletion cleanup gap).
- **Confidence**: High

## Summary

- Total findings: 6
  - New confirmed bugs: 2 (C2-VF-01, C2-VF-02)
  - Needs verification: 1 (C2-VF-03)
  - Cycle 1 fixes verified: 3 (C2-VF-04, C2-VF-05, C2-VF-06) — all correct
