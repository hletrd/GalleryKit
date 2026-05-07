# Code Reviewer — Cycle 13

## Findings

### CR-13-01: `getGalleryConfig` parses `image_sizes` without `parseImageSizes` helper [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/lib/gallery-config.ts` line 77
- **Description**: `_getGalleryConfig()` manually parses `image_sizes` with `.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0)` instead of using the shared `parseImageSizes()` from `gallery-config-shared.ts`. The shared function sorts the result (`parsed.sort((a, b) => a - b)`), which is important for correct `<source srcSet>` ordering and `deleteImageVariants` behavior. The `gallery-config.ts` version does NOT sort, meaning sizes could be in arbitrary order depending on how the admin entered them (e.g., "4096,640,2048,1536"), which would break `processImageFormats` where `sizes[sizes.length - 1]` is expected to be the largest size.
- **Failure scenario**: Admin enters sizes "4096,640,2048,1536" — the base filename gets linked to `4096` (last in array but NOT necessarily largest). The masonry grid srcSet uses `imageSizes[0]` and `imageSizes[1]` assuming they're the smallest sizes, but they'd be `4096` and `640` — wrong images loaded.
- **Fix**: Use `parseImageSizes()` from `gallery-config-shared.ts` instead of inline parsing.

### CR-13-02: `processImageFormats` assumes `sizes` array is sorted ascending [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/lib/process-image.ts` lines 351-386
- **Description**: `processImageFormats` uses `sizes[sizes.length - 1]` to identify the "largest configured size" for the base filename link (line 377). If the array is unsorted (which it will be if admin enters sizes out of order and `getGalleryConfig` doesn't sort), the wrong size becomes the base file. Additionally, `home-client.tsx` assumes `imageSizes[0]` is the smallest and `imageSizes[1]` is the second smallest (line 251-252). This is a data flow correctness issue.
- **Fix**: Sort sizes ascending inside `processImageFormats` at the start, or ensure all callers pass sorted arrays.

### CR-13-03: Upload dropzone `select` element missing accessible styling for dark mode [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/upload-dropzone.tsx` line 226
- **Description**: The `<select>` element for topic selection uses custom CSS classes but hardcodes `bg-background` which may not properly render the dropdown options in dark mode on all browsers. More importantly, the `<label>` element uses `htmlFor="upload-topic"` correctly, but the `<select>` doesn't have `aria-label` as a fallback (the `htmlFor`/`id` pair is sufficient for WCAG but `aria-label` is a good practice for AT when the visual label is far from the control).
- **Fix**: Ensure dark mode styling works for the native `<select>` dropdown. Consider using shadcn's Select component for consistency with the rest of the admin UI.

### CR-13-04: `seo-client.tsx` casts `SeoSettings` to `Record<string, string>` with `as unknown as` [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` line 41
- **Description**: `updateSeoSettings(settings as unknown as Record<string, string>)` uses a double cast to bypass TypeScript's type system. This is a code smell — if `SeoSettings` gains a non-string field, this cast would silently corrupt the data. The proper fix is to make `updateSeoSettings` accept the actual `SeoSettings` type or use a proper mapping function.
- **Fix**: Define `updateSeoSettings` to accept `SeoSettings` directly, or use `Object.fromEntries(Object.entries(settings))` instead of the double cast.

### CR-13-05: `handleUpload` in upload-dropzone uses stale `files` closure reference [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/upload-dropzone.tsx` lines 100-196
- **Description**: The `handleUpload` async function captures `files` from the outer closure at the time of invocation. Inside the function, `const queue = [...files]` is used, and later `setFiles(prev => prev.filter(f => !files.includes(f)))` references the same stale `files` array. If files are added or removed between when `handleUpload` starts and when it finishes, the cleanup logic at line 180 might not correctly identify which files were in the original upload batch. This is mitigated by the fact that `uploading` state disables the dropzone, so new files can't be added during upload.
- **Fix**: This is low risk since the UI disables uploads during processing. No immediate fix needed, but documenting the invariant would help.

## Previously Deferred Items Still Present

- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU (confirmed still present in `apps/web/src/app/actions/images.ts` lines 36-46)
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety (confirmed still present)
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory (confirmed still present)
- ARCH-38-03: `data.ts` is a god module (confirmed still present at 714 lines)
