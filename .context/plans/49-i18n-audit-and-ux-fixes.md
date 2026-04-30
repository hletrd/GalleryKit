# Plan 49 — i18n Remaining Hardcoded Strings, Audit Log Fix, UX Inconsistencies

**Created:** 2026-04-19 (Cycle 8)
**Status:** Done

## Findings Addressed

- C8-05 (LOW): Audit log in `deleteImage` fires even on race-deleted images
- C8-06 (LOW): Shared group page uses raw `←` instead of ArrowLeft icon + i18n
- C8-09 (LOW): Delete-user dialog uses wrong translation key `db.dangerZoneDesc`
- C8-11 (LOW): `createTopic` has remaining hardcoded English error strings
- C8-12 (LOW): `updateTopic` has hardcoded error string on ER_DUP_ENTRY

## Implementation

### Part A: Audit Log Conditional in deleteImage

#### File: `apps/web/src/app/actions/images.ts`

Move the audit log after the image existence check (line 271). Currently the audit fires at line 309 unconditionally:

Current:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'image_delete', 'image', String(id), undefined, {}).catch(console.debug);

return { success: true };
```

The `image` variable is already checked on line 271 (`if (!image) return { error: 'Image not found' };`), so the audit log is already effectively guarded. However, the `getCurrentUser()` call and audit log happen after the DB delete. Move them before the DB transaction so the audit captures the event even if the DB delete succeeds:

Actually, re-examining: the audit log placement is fine functionally (image is guaranteed to exist at that point due to the earlier check). The issue is minor — it fires even if the file cleanup fails. The current placement is acceptable. Downgrading this to "no change needed" since the image existence check already prevents the described scenario.

### Part B: Shared Group Page Arrow Fix

#### File: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`

Line 119 — replace raw arrow with icon + i18n:

Current:
```tsx
← {siteConfig.nav_title || siteConfig.title || 'GalleryKit'}
```

Change to:
```tsx
<ArrowLeft className="h-4 w-4" /> {t('viewGallery')}
```

Note: `ArrowLeft` is already imported. Need to add `const t = await getTranslations('shared');` if not already available. It IS already available at line 68 (`const t = await getTranslations('sharedGroup');`). The `viewGallery` key exists in the `shared` namespace but the page uses `sharedGroup`. Need to either:
1. Use `sharedGroup.viewGallery` (add new key), or
2. Import `getTranslations('shared')` as well

Best approach: Add `viewGallery` key to the `sharedGroup` namespace since that's what the page already uses.

#### File: `apps/web/messages/en.json`

Add to `sharedGroup` section:
```json
"viewGallery": "View Gallery"
```

#### File: `apps/web/messages/ko.json`

Add to `sharedGroup` section:
```json
"viewGallery": "갤러리 보기"
```

### Part C: Delete-User Dialog Wrong Translation Key

#### File: `apps/web/src/components/admin-user-manager.tsx`

Line 145 — replace `db.dangerZoneDesc` with a user-specific key:

Current:
```tsx
<AlertDialogDescription>{t('db.dangerZoneDesc')}</AlertDialogDescription>
```

Change to:
```tsx
<AlertDialogDescription>{t('users.deleteConfirmDesc')}</AlertDialogDescription>
```

#### File: `apps/web/messages/en.json`

Add to `users` section:
```json
"deleteConfirmDesc": "This action cannot be undone. The user's sessions will be terminated immediately."
```

#### File: `apps/web/messages/ko.json`

Add to `users` section:
```json
"deleteConfirmDesc": "이 작업은 되돌릴 수 없습니다. 해당 사용자의 세션이 즉시 종료됩니다."
```

### Part D: createTopic Remaining Hardcoded Strings

#### File: `apps/web/src/app/actions/topics.ts`

Replace hardcoded English strings with `t()` calls:

1. Line 40: `'Label and Slug are required'` → `t('labelSlugRequired')`
   Note: This key already exists — `updateTopic` uses it at line 107.

2. Line 47: `'Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.'` → `t('invalidSlugFormat')`
   Note: This key already exists — `updateTopic` uses it at line 114.

3. Line 53: `'Label is too long (max 100 characters)'` → `t('labelTooLong')`

4. Line 87: `'Topic slug or alias already exists'` → `t('slugOrAliasExists')`

#### File: `apps/web/messages/en.json`

Add to `serverActions` section:
```json
"labelTooLong": "Label is too long (max 100 characters)",
"slugOrAliasExists": "Topic slug or alias already exists"
```

#### File: `apps/web/messages/ko.json`

Add to `serverActions` section:
```json
"labelTooLong": "라벨이 너무 깁니다 (최대 100자)",
"slugOrAliasExists": "카테고리 슬러그 또는 별칭이 이미 존재합니다"
```

### Part E: updateTopic Hardcoded Error String

#### File: `apps/web/src/app/actions/topics.ts`

Line 174: `'Topic slug already exists'` → `t('slugAlreadyExists')`

#### File: `apps/web/messages/en.json`

Add to `serverActions` section:
```json
"slugAlreadyExists": "Topic slug already exists"
```

#### File: `apps/web/messages/ko.json`

Add to `serverActions` section:
```json
"slugAlreadyExists": "카테고리 슬러그가 이미 존재합니다"
```

## Verification

- Build passes (`npm run build`)
- Shared group page shows ArrowLeft icon + translated text instead of raw `←`
- Delete user dialog shows user-specific message instead of DB restore message
- Topic create/update error messages appear in both English and Korean
