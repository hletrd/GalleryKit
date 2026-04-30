# Plan 54 — Topics & Tags i18n Gaps (C10-02, C10-03)

**Status:** DONE
**Severity:** MEDIUM (C10-02) + LOW (C10-03)
**Findings:** C10-02 (topics.ts catch-block hardcoded strings), C10-03 (getAdminTags 'Unauthorized' hardcoded)

---

## Problem

Two small i18n gaps remain in server actions:

1. `topics.ts` lines 90 and 177 have hardcoded `'Failed to create topic'` and `'Failed to update topic'` in catch blocks. All other topic errors use `t()`.
2. `tags.ts` line 18 has `'Unauthorized'` in `getAdminTags()`. All other functions in the same file use `t('unauthorized')`.

---

## Implementation Steps

### Step 1: Add translation keys to `en.json` under `serverActions`

```json
"failedToCreateTopic": "Could not create category",
"failedToUpdateTopic": "Could not update category"
```

### Step 2: Add translation keys to `ko.json` under `serverActions`

```json
"failedToCreateTopic": "카테고리를 만들 수 없습니다",
"failedToUpdateTopic": "카테고리를 수정할 수 없습니다"
```

### Step 3: Update `topics.ts` lines 90 and 177

- Line 90: Replace `'Failed to create topic'` with `t('failedToCreateTopic')`
- Line 177: Replace `'Failed to update topic'` with `t('failedToUpdateTopic')`

### Step 4: Update `tags.ts` `getAdminTags()`

- Add `const t = await getTranslations('serverActions');` at the top of the function
- Replace `'Unauthorized'` with `t('unauthorized')` (key already exists)

### Step 5: Verify build

Run `npm run build --workspace=apps/web` to ensure no compilation errors.

## Files Modified

- `apps/web/messages/en.json` — add 2 keys to `serverActions`
- `apps/web/messages/ko.json` — add 2 keys to `serverActions`
- `apps/web/src/app/actions/topics.ts` — replace 2 hardcoded strings with `t()` calls
- `apps/web/src/app/actions/tags.ts` — add `getTranslations` call to `getAdminTags()`, replace 1 hardcoded string

## Testing

- Create a topic with a non-MySQL error (e.g., DB connection issue) — should show localized "Could not create category"
- Update a topic with a non-MySQL error — should show localized "Could not update category"
- Call getAdminTags while not authenticated — should show localized "Not authorized"
- Verify Korean locale displays all messages correctly
