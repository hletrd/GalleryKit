# Designer — Cycle 13

## Findings

### UX-13-01: Settings page `image_sizes` input lacks real-time validation feedback [LOW] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` lines 119-129
- **Description**: The `image_sizes` input has `pattern="[0-9, ]+"` but no visible validation feedback until the server rejects it. An admin could enter "640;1536;2048" (semicolon-separated) and only discover the error after clicking Save and waiting for the server response. The hint text says "Comma-separated pixel widths" but there's no client-side validation to catch common mistakes like using semicolons, spaces between numbers without commas, or duplicate values.
- **Fix**: Add client-side validation in `handleChange` for `image_sizes` that checks the format and shows an inline error message for invalid input (e.g., non-numeric values, zero or negative values, duplicate sizes). Alternatively, provide a more structured UI with individual size inputs and add/remove buttons.

### UX-13-02: Upload dropzone topic `<select>` uses native element inconsistent with shadcn Select used elsewhere [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/upload-dropzone.tsx` lines 223-232
- **Description**: The topic selector in the upload form uses a native `<select>` element with manual Tailwind classes, while the storage backend selector on the settings page uses shadcn's `<Select>` component. This creates visual inconsistency: the native `<select>` has a different dropdown style, focus ring, and dark mode behavior compared to the shadcn component. On macOS, the native select renders with system styling that doesn't match the rest of the admin UI.
- **Fix**: Replace the native `<select>` with shadcn's `<Select>` component for visual consistency.

### UX-13-03: Photo viewer histogram hardcoded to `_640.jpg` regardless of configured sizes [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/photo-viewer.tsx` line 500
- **Description**: The Histogram component fetches its image from `imageUrl(\`/uploads/jpeg/${image.filename_jpeg?.replace(/\.jpg$/i, '_640.jpg')}\`)`. If the admin changes `image_sizes` to not include 640, this URL will 404 and the histogram won't render. The histogram should use `findNearestImageSize(imageSizes, 640)` to find the closest configured size, just like the OG image route does.
- **Fix**: Use `findNearestImageSize(imageSizes, 640)` to determine the correct histogram source size, falling back to the smallest available size.

## Previously Deferred Items Still Present

- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety (confirmed still present)
