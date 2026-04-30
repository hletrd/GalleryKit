# Plan 60 — Localize Shared Group Page Metadata (C14-03)

**Status:** DONE
**Severity:** LOW
**Finding:** C14-03 (hardcoded English strings in shared group page metadata)

---

## Problem

The shared group page's `generateMetadata` function (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`) returns hardcoded English strings for title, description, and alt text in OpenGraph/Twitter card metadata. Since the app supports Korean and English, Korean users who share a group link will see English metadata in their social media previews.

Hardcoded strings:
- Line 22: `title: 'Shared Photos Not Found'`
- Line 23: `description: 'This shared collection could not be found.'`
- Lines 28, 34, 50: `title: 'Shared Photos'`
- Lines 29, 35, 51: `description: 'View ${group.images.length} shared photos'` / `'View ${group.images.length} shared photos from ${siteConfig.title}'`
- Line 44: `alt: 'Shared Photos'`

---

## Implementation Steps

### Step 1: Add translation keys for shared group metadata

File: `apps/web/messages/en.json` — add under `sharedGroup`:
```json
"ogTitle": "Shared Photos",
"ogDescription": "View {count} shared photos",
"ogDescriptionWithSite": "View {count} shared photos from {site}",
"notFoundTitle": "Shared Photos Not Found",
"notFoundDescription": "This shared collection could not be found.",
"ogAlt": "Shared Photos"
```

File: `apps/web/messages/ko.json` — add under `sharedGroup`:
```json
"ogTitle": "공유된 사진",
"ogDescription": "{count}장의 공유된 사진 보기",
"ogDescriptionWithSite": "{site}에서 {count}장의 공유된 사진 보기",
"notFoundTitle": "공유된 사진을 찾을 수 없습니다",
"notFoundDescription": "이 공유 컬렉션을 찾을 수 없습니다.",
"ogAlt": "공유된 사진"
```

### Step 2: Update generateMetadata to use translations

File: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`

In `generateMetadata`, add:
```typescript
const t = await getTranslations('sharedGroup');
```

Replace hardcoded strings with `t()` calls.

### Step 3: Verify build

Run `npm run build --workspace=apps/web` and `npm test --workspace=apps/web`.

---

## Files Modified

- `apps/web/messages/en.json` — add OG metadata translation keys
- `apps/web/messages/ko.json` — add OG metadata translation keys
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — use `t()` for metadata strings

## Risk Assessment

- **Risk**: VERY LOW — Adding translation keys and replacing hardcoded strings. No logic changes.
- **Impact**: i18n consistency for social media previews of shared group pages.
