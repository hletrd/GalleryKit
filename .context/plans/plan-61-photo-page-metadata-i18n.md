# Plan 61 — Localize Photo Page Metadata (C15-01, C15-02, C15-03)

**Created:** 2026-04-19 (Cycle 15)
**Status:** DONE
**Severity:** MEDIUM (C15-01), LOW (C15-02, C15-03)

---

## Problem

Multiple public page `generateMetadata` functions and page bodies contain hardcoded English strings that appear in social media previews (OG/Twitter metadata). Since the app supports Korean and English, Korean users sharing links see English metadata, which is inconsistent with the bilingual design.

This is a continuation of the C14-03 fix (shared group page metadata) which was implemented in cycle 14. The photo page, shared photo page, topic page, and home page were not updated at that time.

---

## Affected Files

### C15-01: Photo detail page (`p/[id]/page.tsx`)
- Line 30: `title: 'Photo Not Found'`
- Line 38: `let displayTitle = 'Untitled'`
- Line 47: `` displayTitle = `Photo ${image.id}` ``
- Lines 58, 65, 82: `` description: image.description || `View photo by ${siteConfig.author} (${displayTitle})` ``
- Line 113: `'Untitled'`

### C15-02: Topic page (`[topic]/page.tsx`) + Home page (`page.tsx`)

**Topic page:**
- Line 23: `title: 'Not Found'`
- Line 24: `description: 'The page you are looking for does not exist.'`
- Lines 32-33: `'Browse ... photos in ... category'` / `'Photos in ... category'`

**Home page:**
- Lines 28-29: `'Home'` and `| Home`
- Line 32: `'Browse ... photos on ...'`
- Line 48: `'Latest Photo'`

### C15-03: Shared photo page (`s/[key]/page.tsx`)
- Line 20: `title: 'Photo Not Found'`
- Line 21: `description: 'This shared photo could not be found.'`
- Line 24: `'Shared Photo'`
- Lines 28-29: `` `View this photo on ${siteConfig.title}` ``

---

## Implementation Steps

### Step 1: Add translation keys to `en.json`

Under `photo` namespace (new):
```json
"notFoundTitle": "Photo Not Found",
"notFoundDescription": "This photo could not be found.",
"untitled": "Untitled",
"titleWithId": "Photo {id}",
"descriptionByAuthor": "View photo by {author}",
"descriptionByAuthorWithTitle": "View photo by {author} ({title})"
```

Under `topic` namespace (new):
```json
"notFoundTitle": "Not Found",
"notFoundDescription": "The page you are looking for does not exist.",
"browsePhotosWithTag": "Browse {tags} photos in {topic} category",
"photosInTopic": "Photos in {topic} category"
```

Under `home` namespace (add):
```json
"browsePhotosWithTag": "Browse {tags} photos on {site}",
"latestPhoto": "Latest Photo"
```

Under `shared` namespace (add):
```json
"ogNotFoundTitle": "Photo Not Found",
"ogNotFoundDescription": "This shared photo could not be found.",
"ogTitle": "Shared Photo",
"ogDescription": "View this photo on {site}"
```

### Step 2: Add translation keys to `ko.json`

Under `photo` namespace:
```json
"notFoundTitle": "사진을 찾을 수 없습니다",
"notFoundDescription": "이 사진을 찾을 수 없습니다.",
"untitled": "제목 없음",
"titleWithId": "사진 {id}",
"descriptionByAuthor": "{author}의 사진 보기",
"descriptionByAuthorWithTitle": "{author}의 사진 보기 ({title})"
```

Under `topic` namespace:
```json
"notFoundTitle": "찾을 수 없음",
"notFoundDescription": "요청하신 페이지를 찾을 수 없습니다.",
"browsePhotosWithTag": "{topic} 카테고리에서 {tags} 사진 찾아보기",
"photosInTopic": "{topic} 카테고리의 사진"
```

Under `home` namespace:
```json
"browsePhotosWithTag": "{site}에서 {tags} 사진 찾아보기",
"latestPhoto": "최신 사진"
```

Under `shared` namespace:
```json
"ogNotFoundTitle": "사진을 찾을 수 없습니다",
"ogNotFoundDescription": "이 공유된 사진을 찾을 수 없습니다.",
"ogTitle": "공유된 사진",
"ogDescription": "{site}에서 이 사진 보기"
```

### Step 3: Update `p/[id]/page.tsx` generateMetadata

- Add `const t = await getTranslations('photo');` at the start of `generateMetadata`
- Replace hardcoded strings with `t()` calls
- Also update the `'Untitled'` in the page body with `t('untitled')`

### Step 4: Update `[topic]/page.tsx` generateMetadata

- Add `const t = await getTranslations('topic');`
- Replace hardcoded strings

### Step 5: Update `page.tsx` (home) generateMetadata

- Add `const t = await getTranslations('home');`
- Replace hardcoded strings

### Step 6: Update `s/[key]/page.tsx` generateMetadata

- Add `const t = await getTranslations('shared');` (already exists for page body)
- Use `t()` in `generateMetadata` as well

### Step 7: Verify build

Run `npm run build --workspace=apps/web` and `npm test --workspace=apps/web`.

---

## Files Modified

- `apps/web/messages/en.json` — add OG metadata translation keys
- `apps/web/messages/ko.json` — add OG metadata translation keys
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — use `t()` for metadata strings
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` — use `t()` for metadata strings
- `apps/web/src/app/[locale]/(public)/page.tsx` — use `t()` for metadata strings
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — use `t()` for metadata strings

## Risk Assessment

- **Risk**: VERY LOW — Adding translation keys and replacing hardcoded strings. No logic changes.
- **Impact**: i18n consistency for social media previews across all public pages.
