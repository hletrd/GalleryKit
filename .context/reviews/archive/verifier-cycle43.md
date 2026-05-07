# Verifier — Cycle 43 (2026-04-20)

## Findings

### V43-01: Verify `stripControlChars` is applied consistently across ALL user input paths [MEDIUM] [HIGH confidence]
**Files:** `apps/web/src/app/actions/*.ts`, `apps/web/src/lib/sanitize.ts`
I systematically checked every server action that accepts user input:

- `auth.ts:login` — username/password: not sanitized, but these go through Argon2 hash, not stored as-is. **OK**
- `auth.ts:login` — locale: validated by `isSupportedLocale`. **OK**
- `auth.ts:updatePassword` — passwords: go through Argon2. **OK**
- `auth.ts:logout` — locale: validated. **OK**
- `topics.ts:createTopic` — label: `stripControlChars` applied. slug: validated by `isValidSlug`. **OK**
- `topics.ts:updateTopic` — label: `stripControlChars` applied. slug: validated. **OK**
- `topics.ts:createTopicAlias` — alias: `stripControlChars` applied. **OK**
- `topics.ts:deleteTopicAlias` — alias: `stripControlChars` applied. **OK**
- `tags.ts:updateTag` — name: `stripControlChars` applied. **OK** (fixed in cycle 41)
- `tags.ts:addTagToImage` — name: `stripControlChars` applied. **OK** (fixed in cycle 41)
- `tags.ts:removeTagFromImage` — name: `stripControlChars` applied. **OK** (fixed in cycle 42)
- `tags.ts:batchAddTags` — name: `stripControlChars` applied. **OK** (fixed in cycle 42)
- `tags.ts:batchUpdateImageTags` — add path: `stripControlChars` applied. remove path: `stripControlChars` applied. **OK** (fixed in cycle 42)
- `images.ts:uploadImages` — tags: `stripControlChars` applied. **OK** (fixed in cycle 42)
- `images.ts:uploadImages` — topic: validated by `isValidSlug`. **OK**
- `images.ts:updateImageMetadata` — title/description: `stripControlChars` applied. **OK**
- `admin-users.ts:createAdminUser` — username: `stripControlChars` applied. **OK** (fixed in cycle 1)
- `settings.ts:updateGallerySettings` — values: `stripControlChars` applied. **OK**
- `seo.ts:updateSeoSettings` — values: `stripControlChars` applied. **OK**
- `public.ts:searchImagesAction` — query: `stripControlChars` applied. **OK**
- `sharing.ts:createPhotoShareLink` — imageId: integer validation only. **OK** (numeric, no string storage)
- `sharing.ts:createGroupShareLink` — imageIds: integer validation only. **OK**

**Result:** All user input paths that store string data now apply `stripControlChars` before validation/storage. The fixes from cycles 41-42 are correctly implemented. No new gaps found.

### V43-02: `db-actions.ts` child process env passes LANG/LC_ALL — verified consistency concern [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
Verified that `HOME` was removed (commit 00000002b) but `LANG`/`LC_ALL` remain. This is inconsistent with the principle of minimizing env passthrough. Same finding as C43-01.

### V43-03: Verify privacy field separation is correctly implemented [INFO] [HIGH confidence]
**File:** `apps/web/src/lib/data.ts` lines 96-162
After commit 00000008e8, `publicSelectFields` is now derived via destructuring (`const { latitude, longitude, filename_original, user_filename, ...publicSelectFields } = adminSelectFields`). The compile-time privacy guard uses `Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>` which correctly detects if any sensitive key exists in `publicSelectFields`. I verified this by checking the type: if `latitude` were added to `publicSelectFields`, `Extract<keyof typeof publicSelectFields, 'latitude'>` would resolve to `'latitude'`, and the guard would fail because `'latitude' extends never` is false. The `eslint-disable` comments for unused vars are appropriate since the destructured variables are intentionally omitted.
**Result:** Privacy field separation is correctly implemented after the fix. The guard works. No issue.

## Summary
1 MEDIUM finding (LANG/LC_ALL passthrough — confirmed cross-agent). Verified that all prior fixes (stripControlChars, privacy separation) are correctly implemented. No new correctness bugs found.
