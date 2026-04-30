# Plan 110 — Cycle 4 Review Fixes + SEO/OG Admin Configuration

**Source:** Cycle 4 deep review (`cycle4-comprehensive-review.md`, `_aggregate-cycle4.md`)
**Created:** 2026-04-19

---

## Tasks

### Task 1: Admin-configurable SEO/OG settings [C4-01] + [C4-08]

**Files:** `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/layout.tsx`, new admin page, all `generateMetadata()` functions
**Severity:** HIGH | **Confidence:** HIGH
**User-injected TODO:** "Prepare for more SEO and open graph optimizations, showing title and descriptions. Make SEO / open graph configurable from admin page."

**Implementation:**

1. **Add SEO settings to `admin_settings` table** — seed with default values from `site-config.json`:
   - `seo_title` (site title for `<title>` and OG)
   - `seo_description` (site description for meta and OG)
   - `seo_og_image_url` (custom OG image URL override, optional)
   - `seo_author` (author name for JSON-LD and OG)
   - `seo_nav_title` (nav bar title)
   - `seo_locale` (OG locale, e.g., `en_US`)

2. **Create `getSeoSettings()` data accessor** in `data.ts`:
   - Reads from `admin_settings` table
   - Falls back to `site-config.json` values if DB rows are missing or empty
   - Uses React `cache()` for SSR deduplication
   - Returns a typed object matching the existing site-config shape

3. **Convert root layout from static `metadata` to `generateMetadata()`** [C4-08]:
   - Replace `export const metadata: Metadata = {...}` with `export async function generateMetadata()`
   - Read dynamic SEO settings via `getSeoSettings()`
   - Preserve all existing metadata fields (viewport stays as separate export)

4. **Update all `generateMetadata()` functions** to read from `getSeoSettings()`:
   - `apps/web/src/app/[locale]/(public)/page.tsx` (homepage)
   - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` (topic)
   - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (photo)
   - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` (shared photo)
   - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` (shared group)

5. **Add admin SEO settings page** at `/admin/seo`:
   - Form with fields for title, description, OG image URL, author, nav title, locale
   - Save to `admin_settings` table via a new `updateSeoSettings()` server action
   - Protected by admin auth (existing layout guard)
   - Add nav link in admin sidebar

6. **Add `updateSeoSettings` server action** in a new `apps/web/src/app/actions/seo.ts`:
   - Validates all inputs (length limits, URL format for OG image)
   - Uses `INSERT ... ON DUPLICATE KEY UPDATE` pattern for upsert
   - Revalidates all public pages after save
   - Audit log entry

7. **Seed script** — add SEO defaults to `admin_settings` during init if not present

**Status:** pending

---

### Task 2: Fix homepage OG image to use sized variant [C4-02]

**File:** `apps/web/src/app/[locale]/(public)/page.tsx` lines 45-52
**Severity:** MEDIUM | **Confidence:** HIGH

**Current code:**
```tsx
url: `${BASE_URL}/uploads/jpeg/${latestImage.filename_jpeg}`,
```

**Fix:** Use the `_1536.jpg` sized variant:
```tsx
url: `${BASE_URL}/uploads/jpeg/${latestImage.filename_jpeg.replace(/\.jpg$/i, '_1536.jpg')}`,
```

**Steps:**
1. Replace the OG image URL to use `_1536.jpg`
2. Also update the alt text to use the proper title logic (matching photo page pattern)

**Status:** pending

---

### Task 3: Fix shared photo/group OG images to use JPEG sized variant [C4-03]

**Files:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` line 39, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` lines 41, 53
**Severity:** MEDIUM | **Confidence:** MEDIUM

**Current code:** Uses `_2048.webp` for OG images.

**Fix:** Replace with `_1536.jpg` for widest crawler compatibility:
- `s/[key]/page.tsx`: Change `_2048.webp` to `_1536.jpg` in both `openGraph.images` and `twitter.images`
- `g/[key]/page.tsx`: Same change in both OG and Twitter image URLs

**Steps:**
1. Update shared photo page OG/Twitter image URLs from `_2048.webp` to `_1536.jpg`
2. Update shared group page OG/Twitter image URLs from `_2048.webp` to `_1536.jpg`

**Status:** pending

---

### Task 4: Fix `og:type` on shared photo page [C4-04]

**File:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` line 44
**Severity:** LOW | **Confidence:** HIGH

**Fix:** Change `type: 'website'` to `type: 'article'` and add `publishedTime`:
```tsx
type: 'article',
publishedTime: image.capture_date?.toString(),
```

**Status:** pending

---

### Task 5: Add `og:locale:alternate` to root layout OG config [C4-05]

**File:** `apps/web/src/app/[locale]/layout.tsx`
**Severity:** LOW | **Confidence:** MEDIUM

**Fix:** Add alternate locale info to the openGraph config in the root layout's `generateMetadata()`:
```tsx
openGraph: {
  // ... existing fields
  locale: seoSettings.locale || 'en_US',
  alternateLocale: ['ko_KR', 'en_US'],
},
```

**Status:** pending

---

### Task 6: Fix `home-client.tsx` eslint-disable with justification or ref guard [C4-06]

**File:** `apps/web/src/components/home-client.tsx` line 158
**Severity:** LOW | **Confidence:** HIGH

**Fix:** Add a justification comment matching the `info-bottom-sheet.tsx` pattern. The `setAllImages(images)` is intentional prop-driven state sync (same as info-bottom-sheet). Since the `images` prop changes on every topic/filter change and `setAllImages` must always fire, the ref guard used in info-bottom-sheet isn't appropriate here. Add the same eslint-disable with justification comment:

```tsx
// eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop-driven state sync: resetting gallery state when the images prop changes (topic/filter change) is a valid React pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
setAllImages(images);
```

**Status:** pending

---

### Task 7: Encode `tags` param in topic OG image URL [C4-07]

**File:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` line 51
**Severity:** LOW | **Confidence:** MEDIUM

**Current code:**
```tsx
url: `${BASE_URL}/api/og?topic=${topicData.slug}&tags=${tagSlugs.join(',')}`,
```

**Fix:**
```tsx
url: `${BASE_URL}/api/og?topic=${encodeURIComponent(topicData.slug)}&tags=${encodeURIComponent(tagSlugs.join(','))}`,
```

**Status:** pending

---

### Task 8: Fix `robots.ts` to use `BASE_URL` from constants [C4-09]

**File:** `apps/web/src/app/robots.ts` line 21
**Severity:** LOW | **Confidence:** MEDIUM

**Fix:** Import `BASE_URL` from `@/lib/constants` and remove the inline `process.env.BASE_URL || siteConfig.url` derivation.

**Status:** pending

---

### Task 9: Fix upload dropzone tag label accessibility [C4-10]

**File:** `apps/web/src/components/upload-dropzone.tsx` lines 235-244
**Severity:** MEDIUM | **Confidence:** HIGH

**Current code:** `<label htmlFor="upload-tags">` associated with `<div id="upload-tags">`.

**Fix:** Replace `htmlFor`/`id` on div with `aria-labelledby` pattern:
1. Change the label to use an `id` attribute instead of `htmlFor`: `<span id="upload-tags-label" className="text-sm font-medium">{t('upload.tags')}</span>`
2. Change the div wrapper to use `role="group"` with `aria-labelledby="upload-tags-label"`
3. Remove `id="upload-tags"` from the div

**Status:** pending

---

## Not In Scope (Deferred)

No new items deferred this cycle — all 10 findings are scheduled for implementation.

Carried-forward deferred items remain in their respective plan files:
- `105-deferred-cycle38.md`
- `107-deferred-cycle39.md`
- And all earlier deferred-item plans (see `.context/plans/` directory)

---

## Progress Tracking

| Task | Status | Commit |
|-------|--------|--------|
| Task 1: Admin SEO settings | pending | |
| Task 2: Homepage OG image | pending | |
| Task 3: Shared OG images | pending | |
| Task 4: Shared photo og:type | pending | |
| Task 5: og:locale:alternate | pending | |
| Task 6: home-client eslint-disable | pending | |
| Task 7: Topic OG tags encoding | pending | |
| Task 8: robots.ts BASE_URL | pending | |
| Task 9: Upload tag label a11y | pending | |
