# Plan 116 — Cycle 9 R2 Fixes

**Created:** 2026-04-19 (Cycle 9 R2)
**Status:** IN PROGRESS

---

## Issue Inventory

All findings from the cycle 9 R2 review must be either scheduled below or deferred.

### Scheduled for Implementation

| ID | Finding | Severity | Fix Summary |
|----|---------|----------|-------------|
| C9-01 | `switchStorageBackend` disposes old backend before verifying new one | MEDIUM | Move dispose after successful init |
| C9-02 | `processImageFormats` uses hardcoded quality/size values | MEDIUM | Wire `getGalleryConfig()` into pipeline; document limitations for image_sizes |
| C9-03 | `gallery-config.ts` duplicates DEFAULTS | LOW | Import from shared module |
| C9-04 | Settings page missing `force-dynamic` | LOW | Add `export const dynamic = 'force-dynamic'` |
| C9-05 | `g/[key]/page.tsx` inconsistent `.replace()` | LOW | Use `/\.webp$/i` regex |
| C9-06 | Storage switch leaks internal error details | LOW | Return generic message, log server-side |
| C9-07 | SEO page missing back button | LOW | Add back button matching settings page |
| C9-08 | Image sizes input no client-side validation | LOW | Add `pattern` attribute |

### Deferred

| ID | Finding | Severity | Reason | Exit Criterion |
|----|---------|----------|--------|----------------|
| (none new) | — | — | — | — |

---

## Implementation Steps

### Step 1: Fix `switchStorageBackend` dispose-before-init (C9-01)
- **File:** `apps/web/src/lib/storage/index.ts`
- **Change:** Move the `state.backend.dispose()` call from before new backend creation to after successful initialization. Only dispose the old backend if the new one is confirmed working.
- **Verification:** If init fails, old backend should still be usable.

### Step 2: Wire quality settings into `processImageFormats` (C9-02 partial)
- **Files:** `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`
- **Change:** Read quality settings from `getGalleryConfig()` and pass them to `processImageFormats()`. Update the function signature to accept quality parameters. Add `imageSizes` parameter too but note that changing image sizes only affects future uploads — the frontend still uses hardcoded sizes for srcSet generation.
- **Note:** `queue_concurrency` (C9R2-04) is deferred — changing PQueue concurrency at runtime requires careful testing. Add a comment noting the setting is stored but not yet applied to the live queue.

### Step 3: Remove duplicate DEFAULTS in `gallery-config.ts` (C9-03)
- **File:** `apps/web/src/lib/gallery-config.ts`
- **Change:** Import `getSettingDefaults` from `gallery-config-shared.ts` and use it instead of the duplicated `DEFAULTS` object.

### Step 4: Add `force-dynamic` to settings page (C9-04)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- **Change:** Add `export const dynamic = 'force-dynamic';`

### Step 5: Fix inconsistent `.replace()` in `g/[key]/page.tsx` (C9-05)
- **File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- **Change:** Change `.replace('.webp', '_1536.webp')` to `.replace(/\.webp$/i, '_1536.webp')`

### Step 6: Sanitize storage switch error message (C9-06)
- **File:** `apps/web/src/app/actions/settings.ts`
- **Change:** Log the full error with `console.error` but return a generic message to the client. Remove the `${message}` interpolation from the user-facing error string.

### Step 7: Add back button to SEO page (C9-07)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- **Change:** Add a back button with ChevronLeft icon and link to `/admin/dashboard`, matching the settings page pattern.

### Step 8: Add `pattern` attribute to image sizes input (C9-08)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- **Change:** Add `pattern="[0-9, ]+"` to the image sizes input element.

---

## Progress Tracking

- [x] Step 1: C9-01 — switchStorageBackend dispose fix
- [x] Step 2: C9-02 — Wire quality settings
- [x] Step 3: C9-03 — Remove duplicate DEFAULTS
- [x] Step 4: C9-04 — Add force-dynamic to settings page
- [x] Step 5: C9-05 — Fix .replace() in g/[key]
- [x] Step 6: C9-06 — Sanitize storage error message
- [x] Step 7: C9-07 — SEO page back button
- [x] Step 8: C9-08 — Image sizes pattern validation
- [x] GATES: eslint, next build, vitest, tsc --noEmit
- [x] DEPLOY
