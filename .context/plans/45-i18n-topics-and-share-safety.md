# Plan 45 — i18n Hardcoded Strings in Topics + Share Link Safety

**Created:** 2026-04-19 (Cycle 7)
**Status:** Done

## Findings Addressed

- C7-05 (LOW): Hardcoded English strings in `topics.ts` that should use `t()` for i18n consistency
- C7-01 (LOW): `createPhotoShareLink` retry loop does not check image existence on re-fetch

## Implementation

### Part A: i18n Hardcoded Strings

#### File: `apps/web/src/app/actions/topics.ts`

Replace hardcoded English strings with `t()` calls:

1. Line 49: `'This slug is reserved for an application route'` → `t('reservedRouteSegment')`
2. Line 57: `'Topic slug already conflicts with an existing topic route'` → `t('slugConflictsWithRoute')`
3. Line 116: `'This slug is reserved for an application route'` → `t('reservedRouteSegment')`
4. Line 123: `'Topic slug already conflicts with an existing topic route'` → `t('slugConflictsWithRoute')`
5. Line 227: `'This alias is reserved for an application route'` → `t('reservedRouteSegment')`

Note: `createTopic` does not currently call `getTranslations()` — need to add `const t = await getTranslations('serverActions');` at the top of the function.

#### File: `apps/web/messages/en.json`

Add to `serverActions` section:
```json
"reservedRouteSegment": "This slug is reserved for an application route",
"slugConflictsWithRoute": "This slug already conflicts with an existing topic route"
```

#### File: `apps/web/messages/ko.json`

Add to `serverActions` section:
```json
"reservedRouteSegment": "이 슬러그는 애플리케이션 경로로 예약되어 있습니다",
"slugConflictsWithRoute": "이 슬러그는 이미 기존 카테고리 경로와 충돌합니다"
```

### Part B: Share Link Image Existence Check

#### File: `apps/web/src/app/actions/sharing.ts`

In `createPhotoShareLink`, after `affectedRows === 0` (line 81), the re-fetch at line 87 should also check for image existence:

Current:
```ts
// Another request may have set it — re-fetch
const [refreshedImage] = await db.select({ share_key: images.share_key })
    .from(images)
    .where(eq(images.id, imageId));

if (refreshedImage?.share_key) {
    return { success: true, key: refreshedImage.share_key };
}

retries++;
```

Change to:
```ts
// Another request may have set it — or image may have been deleted
const [refreshedImage] = await db.select({ id: images.id, share_key: images.share_key })
    .from(images)
    .where(eq(images.id, imageId));

if (!refreshedImage) {
    return { error: 'Image not found' };
}

if (refreshedImage.share_key) {
    return { success: true, key: refreshedImage.share_key };
}

retries++;
```

## Verification

- Build passes (`npm run build`)
- Topic CRUD operations display localized error messages in both en/ko
- Share link creation returns "Image not found" if image is deleted mid-retry
