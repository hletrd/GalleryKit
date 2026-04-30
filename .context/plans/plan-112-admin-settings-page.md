# Plan 112 — Admin Settings Page with Configurable Options (USER TODO #2)

**Created:** 2026-04-19
**Status:** PENDING
**Review findings:** UX-5-03 (finding #7), CQ-5-03 (finding #9), PERF-5-02, ARCH-5-02
**Priority:** HIGH

---

## Problem

There is no admin settings page. Image quality values, output sizes, queue concurrency, and other operational parameters are hardcoded. The `admin_settings` table exists but has no UI for gallery configuration.

## Architecture

### New Files

1. `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx` — Server component that loads settings
2. `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` — Client component with settings form
3. `apps/web/src/app/actions/settings.ts` — Server actions for reading/writing settings
4. `apps/web/src/lib/gallery-config.ts` — Centralized config module with admin_settings + env var fallbacks

### Modified Files

1. `apps/web/src/components/admin-nav.tsx` — Add Settings link
2. `apps/web/src/lib/process-image.ts` — Read quality/size config from gallery-config
3. `apps/web/src/lib/image-queue.ts` — Read queue concurrency from gallery-config
4. `apps/web/messages/en.json` — Add settings translations
5. `apps/web/messages/ko.json` — Add settings translations

## Settings Categories

### 1. Image Processing

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `image_quality_webp` | number | 90 | WebP quality (1-100) |
| `image_quality_avif` | number | 85 | AVIF quality (1-100) |
| `image_quality_jpeg` | number | 90 | JPEG quality (1-100) |
| `image_sizes` | string | "640,1536,2048,4096" | Comma-separated output widths |
| `queue_concurrency` | number | 2 | Image processing queue concurrency |

### 2. Gallery Display

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `grid_columns_desktop` | number | 4 | Columns on desktop (>=1280px) |
| `grid_columns_tablet` | number | 3 | Columns on tablet (>=768px) |
| `grid_columns_mobile` | number | 2 | Columns on mobile (>=640px) |
| `grid_gap` | number | 16 | Gap between grid items (px) |

### 3. Privacy

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `strip_gps_on_upload` | boolean | false | Strip GPS coordinates from uploaded images |
| `share_link_default_expiry` | number | 0 | Default share link expiry in days (0 = never) |

### 4. Upload Limits

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `max_file_size_mb` | number | 200 | Maximum upload file size in MB |
| `max_files_per_batch` | number | 100 | Maximum files per upload batch |

## Implementation Steps

### Step 1: Create `gallery-config.ts` config module

- Reads settings from `admin_settings` table with env var fallbacks
- Caches settings with React `cache()` for SSR dedup
- Provides typed getters for all config values

### Step 2: Create `actions/settings.ts` server actions

- `getAdminSettings()` — Read all settings (admin-only)
- `updateAdminSettings(settings: Record<string, string>)` — Batch update settings (admin-only, validated)
- Input validation with range checks for numeric settings

### Step 3: Create settings page and client component

- Form sections matching the categories above
- Number inputs with min/max validation
- Toggle switches for boolean settings
- Save button with optimistic UI feedback
- Success/error toasts

### Step 4: Add Settings nav link

- Add to `admin-nav.tsx` links array

### Step 5: Wire up `gallery-config.ts` to existing code

- `process-image.ts` reads quality from config instead of hardcoded values
- `image-queue.ts` reads concurrency from config
- `upload-limits.ts` reads limits from config

### Step 6: Add i18n strings

- Settings page labels, descriptions, validation messages

## Verification

- Settings page loads and displays current values
- Changing a value persists to `admin_settings` table
- Image processing uses configured quality values
- Queue concurrency reflects configured value
- All settings have proper validation and error handling
