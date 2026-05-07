# Verifier — Cycle 20

## Review Scope
Evidence-based correctness verification against stated behavior. Validates that code actually does what comments, docs, and function signatures claim.

## New Findings

### VER-20-01: `uploadTracker` post-adjustment can produce negative count, violating the stated invariant [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 273-278
- **Description**: The comment at line 267 says "Update cumulative upload tracker with actual (not pre-incremented) values." The code uses additive adjustment: `currentTracker.count += (successCount - files.length)`. The stated behavior is to correct the pre-incremented count to match reality. However, when `successCount === 0`, the adjustment subtracts the full pre-incremented amount, which can make the count negative. The stated goal (correcting to actual values) would imply the count should represent actual successful uploads, which is >= 0. The negative count contradicts this stated invariant.
- **Evidence**: Trace the math: tracker starts at `count=0`. Pre-increment: `count += files.length` (e.g., 100). All uploads fail: `successCount=0`. Adjustment: `count += (0 - 100) = -100`. The tracker now claims -100 uploads in this window, which is meaningless.
- **Fix**: Clamp to 0 after adjustment.

### VER-20-02: `deleteAdminUser` returns `{ success: true }` without verifying deletion occurred [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/admin-users.ts` lines 157-166
- **Description**: The function's return type `{ success: true }` implies the user was deleted. But the transaction doesn't check `affectedRows` on the `adminUsers` delete. If the user didn't exist, the function still returns success. This is a behavior/code mismatch: the function claims success but didn't perform the requested action.
- **Fix**: Check affected rows.

### VER-20-03: `revokePhotoShareLink` conditional WHERE correctly prevents race — verified [N/A] [HIGH confidence]
- **File**: `apps/web/src/app/actions/sharing.ts` lines 256-266
- **Description**: Verified that C19-01 fix is correctly implemented. The UPDATE at line 260 uses `WHERE eq(images.id, imageId) AND eq(images.share_key, oldShareKey)`, and the affectedRows check at line 263 handles the concurrent-change case. This is correct.
- **Verdict**: Confirmed fixed.

### VER-20-04: `updateGallerySettings` roll-back on storage switch failure — verified [N/A] [HIGH confidence]
- **File**: `apps/web/src/app/actions/settings.ts` lines 82-98
- **Description**: Verified that C19-02 fix is correctly implemented. When `switchStorageBackend` throws, the catch block at line 85 deletes the `storage_backend` row from admin_settings (line 90), which causes `getGalleryConfig()` to return the default ("local"). This aligns the DB with the live state.
- **Verdict**: Confirmed fixed.

## Verification Summary

- C19-01 (revokePhotoShareLink race): **VERIFIED FIXED**
- C19-02 (storage backend DB/live inconsistency): **VERIFIED FIXED**
- C19-03 (mobile EXIF fields): **VERIFIED FIXED** — all 6 fields present in info-bottom-sheet.tsx
