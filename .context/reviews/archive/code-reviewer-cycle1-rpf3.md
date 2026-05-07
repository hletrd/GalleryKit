# code-reviewer — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Verify code-quality of the user-injected designer-v2 findings and surface any
adjacent code-quality issues hidden in the same files.

## Findings

### CR-1 (High, High confidence) — `LightboxTrigger` is `h-8 w-8` (32 px) below WCAG 2.5.5 floor

- **File:** `apps/web/src/components/lightbox.tsx:41`
- **Evidence:** `<Button variant="ghost" size="icon" onClick={onClick}
  className="h-8 w-8" ...>` — explicit override pulling the icon button below
  the 44 px floor. designer-v2 NF-2 confirms via DOM `{w:32, h:32}` at 1440 px
  and 390 px.
- **Failure scenario:** Mobile users have to repeat-tap to open the lightbox.
  This is the primary fullscreen interaction on the photo viewer, so
  miss-tap drives bounce.
- **Fix:** `className="h-11 w-11"` (matches the search trigger and Info/Back
  buttons that were already widened by F-3 / F-20).

### CR-2 (High, High confidence) — `tag_names` returns null in `getImagesLite`/`getImagesLitePage` correlated subquery

- **File:** `apps/web/src/lib/data.ts:324, 374` (the two `(SELECT GROUP_CONCAT
  ...)` correlated subqueries) and `apps/web/src/lib/data.ts:428` (admin
  variant — same pattern).
- **Evidence:** designer-v2 NF-3 captured RSC payload `tag_names: null` for
  every photo on `/en/tws`, including image 348 which has confirmed tags.
  The accessible-label generator `getConcisePhotoAltText` falls back to
  "Photo" / "Untitled" when `tag_names` is null. `getImages()` (line 398)
  uses LEFT JOIN + GROUP_CONCAT with Drizzle column references and works
  correctly; the lite variants use raw-SQL subquery with string aliases
  `it`, `t` which Drizzle is escaping or reordering, dropping the result
  silently.
- **Failure scenario:** Every screen-reader user gets identical
  "View photo: Untitled" labels for the entire masonry grid. F-18 ships the
  code path correctly but the data layer is silently null.
- **Fix:** Replace the correlated subquery with the same LEFT JOIN +
  `groupBy(images.id)` pattern used by `getImages()`, OR replace the raw
  string aliases with Drizzle column references, OR add a Drizzle
  `${imageTags.imageId}` style placeholder so the inner reference resolves
  the same way the outer one does. The JOIN approach is the safest because
  it unifies the two code paths and matches the working `getImages()`
  pattern.

### CR-3 (Medium, High confidence) — Admin login form submit + password toggle below 44 px

- **File:** `apps/web/src/app/[locale]/admin/login-form.tsx:84` (toggle
  `w-9 h-9`) and line 102 (submit `<Button type="submit" className="w-full">`
  inheriting default `h-9` = 36 px).
- **Evidence:** designer-v2 NF-1 DOM `submit_btn: {h:36}`, password toggle
  `{w:36, h:36}`. F-20 missed this surface because it only touched
  `photo-viewer.tsx`.
- **Failure scenario:** Mobile admin login: thumb miss-taps on the toggle
  while typing the password.
- **Fix:** `className="w-full h-11"` on the submit Button; `w-11 h-11` on the
  password toggle.

### CR-4 (Medium, High confidence) — Nav topic links 32 px tall (systematic miss)

- **File:** `apps/web/src/components/nav-client.tsx:119`
- **Evidence:** `className="...px-3 py-1.5..."` -> 6+6+~20 = 32 px. designer-v2
  NF-4 confirms via DOM `{h:32}` at 1440 px and 390 px.
- **Failure scenario:** Mobile users tapping between content categories
  (TWS / TXT) miss-tap because the row is 32 px and is sticky at the top edge
  of the viewport.
- **Fix:** Add `min-h-[44px]` to the className so existing `flex items-center`
  centers the text vertically without breaking the pill design.

### CR-5 (Low, High confidence) — Load More button 36 px tall

- **File:** `apps/web/src/components/load-more.tsx:102` —
  `<Button type="button" variant="outline" onClick={loadMore} disabled={loading}>`
  inherits default `h-9`.
- **Evidence:** designer-v2 NF-5 DOM `{h:36}` at 1440 px and 390 px.
- **Fix:** Add `className="h-11"` (or `className="h-11 px-6"` if the wider
  hit target reads better).

### CR-6 (Low, High confidence) — Site title link 28 px tall

- **File:** `apps/web/src/components/nav-client.tsx:78`
- **Evidence:** `<Link ... className="flex items-center space-x-2 shrink-0">`
  with no min-height. designer-v2 NF-6 DOM `{h:28}`.
- **Fix:** Add `min-h-[44px]` to the Link className.

### CR-7 (Medium, Medium confidence) — Desktop Info sidebar toggle is `size="sm"` (h-8 = 32 px)

- **File:** `apps/web/src/components/photo-viewer.tsx:314-328`
- **Evidence:** designer-v2 NF-2 DOM `{w:71, h:32}` at 1440 px (desktop
  `lg:flex` toggle). The `size="sm"` shadcn variant maps to `h-8` per
  `apps/web/src/components/ui/button.tsx`.
- **Failure scenario:** Hybrid touch users on iPad / Surface miss-tap the
  Info pin/unpin toggle.
- **Fix:** Drop `size="sm"` and use `className="gap-2 transition-all hidden
  lg:flex h-11"`.

## Cross-cutting note

The five touch-target findings (CR-1, CR-3, CR-4, CR-5, CR-6, CR-7) all
follow the same pattern: components rendered before the F-1/F-2/F-3
touch-target audit was global. A repository-wide grep
`grep -rn 'h-8 w-8\|size="sm"\|size="icon"' apps/web/src/components/` would
have caught all of them in one pass. Recommend adding such a grep to the
`apps/web/src/__tests__/` suite as a fixture-style test.
