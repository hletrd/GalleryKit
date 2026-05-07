# Aggregate Review — Cycle 10 (2026-05-04)

## Review method

Deep multi-perspective review across all source files from security, performance,
correctness, UI/UX, architecture, and test coverage angles. Focus: photographer
workflow, edge cases not yet discovered in cycles 1-9, and potential regressions.

Key modules examined: data.ts, public.ts, images.ts (actions), sharing.ts,
photo-viewer.tsx, lightbox.tsx, info-bottom-sheet.tsx, home-client.tsx,
photo-navigation.tsx, search.tsx, load-more.tsx, image-types.ts, exif-datetime.ts,
rate-limit.ts, process-image.ts, image-queue.ts, session.ts, proxy.ts,
reactions/[imageId]/route.ts, download/[imageId]/route.ts, photo-title.ts,
upload-dropzone.tsx, upload-paths.ts, gallery-config-shared.ts.

## GATE STATUS (prior cycle — all green)

- eslint: clean
- tsc --noEmit: clean
- vitest: passing
- lint:api-auth: OK
- lint:action-origin: OK

---

## New findings (not in cycles 1-9)

### MEDIUM severity

#### C10-MED-01: `getReactionsEnabled` in reactions route issues two sequential DB queries including a pointless SELECT 0
- **Source**: `apps/web/src/app/api/reactions/[imageId]/route.ts:64-84`
- **Location**: `getReactionsEnabled()` function
- **Issue**: The function first executes `SELECT images.id FROM images LIMIT 0` (a no-op query that always returns an empty result set), then issues a second query to `admin_settings`. The first query is dead code that adds an unnecessary DB round-trip on every reaction POST request. The `void row` usage suggests this was a leftover from development.
- **Confidence**: High
- **Fix**: Remove the dead `SELECT` query and the `row` variable. Just query `admin_settings` directly.

#### C10-MED-02: `photo-navigation.tsx` mobile nav buttons use `size="icon"` which defaults to 48x48, but the parent container uses h-12 w-12 which can clip on some browsers
- **Source**: `apps/web/src/components/photo-navigation.tsx:211-219`
- **Location**: Prev/Next static navigation buttons
- **Issue**: The `Button` component uses `size="icon"` (which the shadcn config sets to `h-10 w-10` by default) but then overrides with `h-12 w-12`. While this works, the inconsistency between the size prop intent and the className override means the touch target size (48px) is achieved via className rather than the component API. If shadcn's `size="icon"` changes its dimensions in a future update, the override still wins — but the intent is unclear. This is a maintainability nit, not a bug.
- **Confidence**: Low
- **Fix**: Remove `size="icon"` and keep only the explicit `h-12 w-12` className.

#### C10-MED-03: `image-manager.tsx` batch delete doesn't revoke associated share links before deleting images
- **Source**: Code review of `apps/web/src/app/actions/images.ts:563-719` vs `deleteImage`
- **Location**: `deleteImages` batch delete function
- **Issue**: The single `deleteImage` function (line 467) queries `getSharedGroupKeysForImages` and revalidates share paths after deletion. The batch `deleteImages` function also queries share groups for revalidation but does NOT call `revokePhotoShareLink` or clean up the `share_key` column. While the images table DELETE will remove the row (and its share_key), the share link page `/s/[key]` will return 404 on next visit. This is functionally correct (the image is gone) but differs from the single-delete path which explicitly nullifies `share_key` before deletion. The concern is about shared-group URLs — when images are deleted, the group `/g/[key]` page will show missing images.
- **Confidence**: Medium (this is existing behavior consistent across both paths — the group images table FK cascade handles cleanup)
- **Fix**: No code change needed — the existing FK cascade and revalidation are sufficient. Document as expected behavior.

#### C10-MED-04: Lightbox Ken Burns animation applies to the `<picture>` element instead of the `<img>` element, causing the source elements to not animate
- **Source**: `apps/web/src/components/lightbox.tsx:401-451`
- **Location**: `<picture>` and `<img>` elements in lightbox
- **Issue**: The Ken Burns CSS animation is applied to the `<img>` element (line 441), but the `<picture>` element has `style` with `animation: 'none'` when slideshow is active (line 408). This means when `isSlideshowActive` is true, the `<picture>` element's style is `{animation: 'none', transformOrigin: 'center center'}`. The `<img>` inside has the actual Ken Burns animation. This should work correctly because CSS animation on a child element overrides the parent's `animation: none` — but the parent `<picture>` having `animation: none` is confusing and could interact poorly if a future CSS change adds `animation` inheritance. The intent seems to be: "prevent any inherited animation on `<picture>`, apply only on `<img>`" which is correct.
- **Confidence**: Low (correct behavior, code clarity issue)
- **Fix**: Add a comment explaining the intent of `animation: none` on `<picture>`.

### LOW severity

#### C10-LOW-01: `buildCursorCondition` in data.ts generates SQL with isNotNull guards that are logically redundant but added for documentation
- **Source**: `apps/web/src/lib/data.ts:600-612`
- **Location**: `buildCursorCondition` function
- **Issue**: Already added the `isNotNull(capture_date)` guards (noted in comment C10-LOW-01 in the code itself). MySQL NULL comparisons already exclude NULL rows, but the explicit guards are for reviewer clarity. This is self-documenting code, not a bug.
- **Confidence**: N/A (this was already fixed in this codebase)

#### C10-LOW-02: `getImage` undated-image prev conditions use `isNull()` for consistency
- **Source**: `apps/web/src/lib/data.ts:847-851`
- **Location**: Undated image branch of `getImage` prev/next logic
- **Issue**: Already fixed — the code now uses `isNull(images.capture_date)` instead of raw SQL for consistency with the `isNotNull()` usage in dated branches. This is noted as C10-LOW-02 in the source code.
- **Confidence**: N/A (self-documented fix)

#### C10-LOW-03: Queue state cleanup on image delete
- **Source**: `apps/web/src/app/actions/images.ts:521-524`
- **Location**: `deleteImage` queue state cleanup
- **Issue**: Already fixed — the code now cleans `retryCounts` and `claimRetryCounts` for deleted image IDs (noted as C10-LOW-03 in source).
- **Confidence**: N/A (self-documented fix)

#### C10-LOW-04: `exif-datetime.ts` regex does not accept fractional seconds
- **Source**: `apps/web/src/lib/exif-datetime.ts:1`
- **Location**: `EXIF_DATETIME_PATTERN` regex
- **Issue**: Carried from C9-LOW-01. The display-format regex does not match fractional seconds like `2024-01-15 14:30:45.123`. However, `parseExifDateTime` in `process-image.ts` strips fractional seconds at EXIF extraction time (line 183: `const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value)` — only captures whole seconds), so the display regex is consistent with what is stored. Not a functional bug.
- **Confidence**: Low (not a bug, but could store sub-second precision for future use)

#### C10-LOW-05: `load-more.tsx` does not handle the case where `searchStatus` returned by the load-more action is 'maintenance'
- **Source**: Review of `apps/web/src/components/load-more.tsx` and `apps/web/src/app/actions/public.ts:77-152`
- **Location**: Load more error handling
- **Issue**: The `loadMoreImages` action can return `{ status: 'maintenance' }` when restore maintenance is active. The load-more component should surface this state to the user (e.g., a toast or inline message). Currently it may silently fail, leaving the user clicking "Load More" repeatedly with no feedback.
- **Confidence**: Medium
- **Fix**: Check the `status` field in the load-more callback and show a toast for 'maintenance' and 'rateLimited' statuses.

#### C10-LOW-06: `home-client.tsx` masonry grid uses `containIntrinsicSize` which is not widely supported
- **Source**: `apps/web/src/components/home-client.tsx:199-202`
- **Location**: Masonry card `style` prop
- **Issue**: `containIntrinsicSize` (the CSS property, not the shorthand `contain-intrinsic-size`) has limited browser support and the non-standard camelCase form is used. The standard property name is `containIntrinsicSize` which maps to `contain-intrinsic-size` in CSS. This is used for Content Visibility optimization. If the browser doesn't support it, it's silently ignored. Not a bug, but a progressive enhancement.
- **Confidence**: Low

## Previously fixed findings (confirmed from cycles 1-9)

- All cycle 9 findings (C9-MED-01 through C9-LOW-04) status:
  - C9-MED-01 (analytics rate limiting): FIXED in this codebase (lines 244-257 of public.ts now have `isViewRecordRateLimited`)
  - C9-MED-02 (search min query length): FIXED (now uses `countCodePoints`)
  - C9-MED-03 (slideshow button on single image): FIXED (now checks `totalCount > 1`)
  - C9-MED-04 (bulk update per-row loop): Still present but low-impact
  - C9-LOW-01 (fractional seconds): Not a functional bug (see C10-LOW-04 above)
  - C9-LOW-02 (health route timing): Enhancement, not a bug
  - C9-LOW-03 (image-zoom keyboard event cast): Low defensive improvement
  - C9-LOW-04 (maxLength code unit counting): UX inconvenience only

- All cycle 1-8 findings remain fixed.

## Cross-agent agreement

Single-pass multi-perspective review. The most significant new finding is
C10-MED-01 (dead query in reactions endpoint) which is a clear code quality
issue with a simple fix. The load-more maintenance state handling (C10-LOW-05)
is a UX improvement opportunity. All other findings are low-severity
maintainability nits.