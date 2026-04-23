# Debugger — Cycle 13

## Findings

### DBG-13-01: `gallery-config.ts` `imageSizes` unsorted — breaks `processImageFormats` base-file selection [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/lib/gallery-config.ts` line 77, `apps/web/src/lib/process-image.ts` line 377
- **Description**: Same root cause as CR-13-01/CR-13-02 but from the bug-surface angle. `processImageFormats` has a critical invariant: `sizes[sizes.length - 1]` must be the largest size, because that size's output becomes the base (un-suffixed) filename via hard-link. If `getGalleryConfig` returns unsorted sizes (e.g., `[2048, 640, 4096, 1536]`), then `sizes[sizes.length - 1]` = `1536` — not the largest — and the base file would be a 1536px variant instead of the intended largest size. Downstream, `deleteImageVariants` defaults to `DEFAULT_OUTPUT_SIZES` which IS sorted, so deletion would work, but the base file served for fallback would be wrong.
- **Concrete failure**: Admin enters "2048,640,4096,1536" in settings. The `filename.webp` base file becomes the 1536px variant. When a browser that doesn't support `<source>` / `<picture>` (or a bot) loads `filename.webp`, it gets a low-res image instead of the full-res one. The `home-client.tsx` grid also loads wrong sizes because it assumes `imageSizes[0]` is smallest.
- **Fix**: Use `parseImageSizes()` from `gallery-config-shared.ts` in `gallery-config.ts`, which sorts the result ascending. Additionally, add a defensive `.sort((a, b) => a - b)` at the top of `processImageFormats`.

### DBG-13-02: `settings-client.tsx` `image_sizes` pattern validation allows spaces but server strips them differently [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/admin/(protected)/settings/settings-client.tsx` line 127, `apps/web/src/lib/gallery-config-shared.ts` line 59
- **Description**: The client-side `<Input>` for image sizes has `pattern="[0-9, ]+"` which allows spaces. The server-side validator `image_sizes` in `gallery-config-shared.ts` splits on comma and trims each part: `v.split(',').map(s => Number(s.trim()))`. This works correctly. However, the `pattern` attribute on the input doesn't actually prevent form submission with invalid values — it only shows a browser validation tooltip. Since the actual validation is server-side, this is fine, but the pattern regex could be tightened to `[0-9]+(,[0-9]+)*` to provide better client-side feedback.
- **Fix**: Tighten the HTML pattern to not allow leading/trailing spaces or spaces between numbers, since the server trims anyway.

### DBG-13-03: `createGroupShareLink` insertId coercion may overflow for very large IDs [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/sharing.ts` lines 192-193
- **Description**: `const groupId = Number(result.insertId)` converts the MySQL insertId to a JavaScript number. MySQL BIGINT UNSIGNED can be up to 2^64-1, which exceeds JavaScript's `Number.MAX_SAFE_INTEGER` (2^53-1). The existing `Number.isFinite(groupId) && groupId <= 0` check would pass for values between 2^53 and 2^56 (which are finite but lose precision), potentially causing the wrong `groupId` to be used in the `sharedGroupImages` insert. In practice, auto-increment IDs won't reach this range, and the table uses regular INT, so this is theoretical.
- **Fix**: No immediate fix needed. The `sharedGroups` table uses INT (not BIGINT), so auto-increment values are capped at 2^31-1, well within safe integer range.
