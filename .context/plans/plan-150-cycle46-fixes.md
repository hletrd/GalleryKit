# Plan -- Cycle 46 Fixes

## Status: COMPLETE

## Findings to Address

### F1: C46-01 -- Sanitize `tagsString` before length check in `uploadImages` [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/images.ts` lines 58-68

**Current code (lines 58-68):**
```
const tagsString = formData.get('tags')?.toString() ?? '';

if (tagsString && tagsString.length > 1000) {
    return { error: t('tagsStringTooLong') };
}

const tagNames = tagsString
    ? tagsString.split(',').map(t => stripControlChars(t.trim()) ?? '').filter(t => t.length > 0 && isValidTagName(t))
    : [];

if (tagsString && tagNames.length !== tagsString.split(',').map(t => stripControlChars(t.trim()) ?? '').filter(Boolean).length) {
    return { error: t('invalidTagNames') };
}
```

**Fix:** Apply `stripControlChars` to `tagsString` before the length check. Then simplify line 68 to use `tagsString` directly instead of re-splitting/re-sanitizing.

**Implementation plan:**
1. Change line 58 to: `const tagsString = stripControlChars(formData.get('tags')?.toString() ?? '') ?? '';`
2. Simplify line 68: since `tagsString` is already sanitized, the validation comparison can use `tagsString.split(',').filter(t => t.trim().length > 0).length` instead of re-sanitizing each tag.

### F2: C46-02 -- Sanitize `query` before length check in `searchImagesAction` [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/public.ts` lines 26, 94

**Current code (lines 26, 94):**
```
if (!query || typeof query !== 'string' || query.length > 200) return [];
...
const safeQuery = stripControlChars(query.trim())?.slice(0, 200) ?? '';
```

**Fix:** Move `stripControlChars` before the length check so validation operates on the sanitized value.

**Implementation plan:**
1. After the `typeof query !== 'string'` check, sanitize immediately: `const sanitizedQuery = stripControlChars(query.trim()) ?? '';`
2. Replace `query.length > 200` with `sanitizedQuery.length > 200`
3. Replace line 94 with: `const safeQuery = sanitizedQuery.slice(0, 200);`
4. Update the `query.trim().length < 2` check to use `sanitizedQuery.length < 2`

## Progress Tracking

- [x] F1: Fix `tagsString` sanitization ordering in `uploadImages` — commit 00000003a
- [x] F2: Fix `query` sanitization ordering in `searchImagesAction` — commit 00000003a
- [x] Run gates (eslint, next build, vitest) — all pass
- [x] Deploy — per-cycle-success
