# Plan 56 — i18n Hardcoded Fallback Cleanup (C12-01, C12-02, C12-03)

**Status:** DONE
**Severity:** 1 MEDIUM + 2 LOW
**Findings:** C12-01 (search.tsx hardcoded fallbacks), C12-02 (home-client fallback), C12-03 (tag slug collision warnings)

---

## Problem

Three remaining i18n consistency gaps where hardcoded English strings appear as dead-code fallbacks or as user-facing warning text:

1. **C12-01 (MEDIUM)**: `search.tsx` has three `t('key') || 'English fallback'` patterns on lines 146, 197, 201. All translation keys exist in both locale files, so the fallbacks are dead code. They violate the i18n pattern and would mask a falsy translation.

2. **C12-02 (LOW)**: `home-client.tsx` line 326 has `t('home.noResultsHint') || 'Try removing some filters'`. Same dead-code fallback pattern.

3. **C12-03 (LOW)**: `tags.ts` lines 130 and 254, and `images.ts` line 195 return hardcoded English warning strings for tag slug collisions. These warnings are shown to admin users via toast in `image-manager.tsx` line 335.

---

## Implementation Steps

### Step 1: Fix C12-01 — Remove hardcoded fallbacks in search.tsx

File: `apps/web/src/components/search.tsx`

- Line 146: Change `placeholder={t('search.placeholder') || 'Search photos, tags, cameras...'}` to `placeholder={t('search.placeholder')}`
- Line 197: Change `{t('search.noResults') || 'No photos found'}` to `{t('search.noResults')}`
- Line 201: Change `{t('search.hint') || 'Search by title, tag, camera, or description'}` to `{t('search.hint')}`

### Step 2: Fix C12-02 — Remove hardcoded fallback in home-client.tsx

File: `apps/web/src/components/home-client.tsx`, line 326

- Change `{t('home.noResultsHint') || 'Try removing some filters'}` to `{t('home.noResultsHint')}`

### Step 3: Fix C12-03 — Localize tag slug collision warnings

This requires changes in three files:

**3a. Add translation key to both locale files:**

`apps/web/messages/en.json` — add under `serverActions`:
```json
"tagSlugCollision": "Tag \"{newName}\" was mapped to existing \"{existingName}\" (same slug)"
```

`apps/web/messages/ko.json` — add under `serverActions`:
```json
"tagSlugCollision": "태그 \"{newName}\"이(가) 기존 \"{existingName}\"에 매핑되었습니다 (동일한 슬러그)"
```

**3b. Update `tags.ts` to return structured warning data instead of English strings:**

In `addTagToImage()` (line ~130) and `batchUpdateImageTags()` (line ~254):
- Instead of returning `warning: \`Tag "${cleanName}" was mapped to existing "${tagRecord.name}" (same slug)\``, return `warning: { newName: cleanName, existingName: tagRecord.name } as object`
- The `warning` field type changes from `string` to `string | { newName: string; existingName: string }`

**3c. Update `images.ts` `uploadImages()` line 195:**

The collision warning there is only logged via `console.warn()` and not returned to the client, so no localization needed for that one. The console.warn is for server-side debugging only.

**3d. Update `image-manager.tsx` line 335 to format the localized warning:**

Change:
```tsx
res.warnings.forEach(w => toast.warning(w));
```
To:
```tsx
res.warnings.forEach(w => {
    if (typeof w === 'string') {
        toast.warning(w);
    } else {
        toast.warning(t('serverActions.tagSlugCollision', { newName: w.newName, existingName: w.existingName }));
    }
});
```

Wait — the `batchUpdateImageTags` function returns `{ success: boolean; added: number; removed: number; warnings: string[] }`. The warnings array is typed as `string[]`. Changing it to `(string | object)[]` would be a breaking type change.

A simpler approach: keep the warnings as strings in the return type but make them localized on the server side. Since the server action already calls `getTranslations('serverActions')`, we can use `t('tagSlugCollision', { newName, existingName })` directly in the server action and keep the return type as `string[]`.

**Revised Step 3b:**

In `tags.ts` `addTagToImage()` line ~130:
- Change: `` `Tag "${cleanName}" was mapped to existing "${tagRecord.name}" (same slug)` ``
- To: `t('tagSlugCollision', { newName: cleanName, existingName: tagRecord.name })`

In `tags.ts` `batchUpdateImageTags()` line ~254:
- Change: `` `Tag "${cleanName}" was mapped to existing "${tagRecord.name}" (same slug)` ``
- To: `t('tagSlugCollision', { newName: cleanName, existingName: tagRecord.name })`

The `t` variable is already available in both functions (called at the top of each).

No changes needed to `image-manager.tsx` — it already displays `string[]` warnings directly.

### Step 4: Verify build

Run `npm run build --workspace=apps/web` to ensure no compilation errors.

---

## Files Modified

- `apps/web/src/components/search.tsx` — remove 3 hardcoded English fallbacks
- `apps/web/src/components/home-client.tsx` — remove 1 hardcoded English fallback
- `apps/web/messages/en.json` — add `tagSlugCollision` key
- `apps/web/messages/ko.json` — add `tagSlugCollision` key
- `apps/web/src/app/actions/tags.ts` — localize 2 warning strings using `t()`

## Testing

- Search overlay should display localized placeholder, no-results, and hint text in both English and Korean
- Home page empty state should show localized hint text
- Tag slug collision warnings in admin should appear in Korean when locale is Korean
- Run `npm run build` to confirm no compilation errors
