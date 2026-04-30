# Plan 114 — Cycle 5 Quick Fixes and Carry-Forward Items

**Created:** 2026-04-19
**Status:** PENDING
**Review findings:** #1, #2, #3, #4, #6, #10, #11, #12, #13, #14, USER TODO #4

---

## User TODO #4: Remove ./.agent/rules and ./.context from remote git

### Steps

1. Add `.agent/` and `.context/` to `.gitignore`
2. Run `git rm -r --cached .agent .context` to stop tracking them
3. Commit the changes
4. Keep local copies (do NOT delete local files)

## Finding #1: Replace native `confirm()` in topic-manager and tag-manager

**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`

**Fix:** Replace `confirm()` with AlertDialog, matching the pattern in `image-manager.tsx`.

## Finding #2: Add `Number.isFinite` guard in `images.ts`

**File:** `apps/web/src/app/actions/images.ts` line 173

**Fix:** Add `Number.isFinite(insertedId)` check after `Number(result.insertId)`, matching the pattern in `admin-users.ts` and `sharing.ts`.

## Finding #3: viewCountBuffer re-buffering should use bufferGroupViewCount

**File:** `apps/web/src/lib/data.ts` lines 53-61

**Fix:** Replace direct `viewCountBuffer.set()` in the `.catch()` handler with `bufferGroupViewCount(groupId)` so the cap check is applied.

## Finding #6: Admin nav horizontal scrolling

**File:** `apps/web/src/components/admin-nav.tsx`

**Fix:** Change `flex-wrap` to `flex-nowrap overflow-x-auto scrollbar-hide` for horizontal scrolling instead of wrapping.

## Finding #10: sql-restore-scan missing SET @@global pattern

**File:** `apps/web/src/lib/sql-restore-scan.ts`

**Fix:** Add `/\bSET\s+@@global\./i` to dangerous SQL patterns.

## Finding #11: Locale cookie missing Secure flag

**File:** `apps/web/src/components/nav-client.tsx`

**Fix:** Add `Secure` flag when `window.location.protocol === 'https:'`.

## Finding #12: info-bottom-sheet GPS code missing comment

**File:** `apps/web/src/components/info-bottom-sheet.tsx`

**Fix:** Add the same unreachable-GPS comment that `photo-viewer.tsx` has.

## Finding #13: uploadImages tracker rollback simplification

**File:** `apps/web/src/app/actions/images.ts`

**Fix:** Move the tracker pre-increment to after all validation checks pass, eliminating the need for manual rollback on validation failure.

## Finding #14: batchUpdateImageTags should report invalid tag names

**File:** `apps/web/src/app/actions/tags.ts` lines 300-302

**Fix:** Collect invalid tag names in the `warnings` array instead of silently skipping them.

## Verification

- All gates pass: eslint, next build, vitest, tsc --noEmit
- Admin pages load correctly
- Topic and tag deletion uses AlertDialog instead of confirm()
- No regressions in existing functionality
