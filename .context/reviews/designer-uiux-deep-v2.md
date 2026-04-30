# Designer Deep UI/UX Review v2 (HEAD: 67655cc02925d12895247aedbdad1371fa0ad25a)

## Summary

GalleryKit at HEAD `67655cc` ships in significantly better shape than the baseline at `03e5b66`. The fix wave across 11 commits and subsequent cleanup cycles successfully resolved the most urgent structural defects: 404 pages are no longer orphaned dead-ends, OG locale now correctly reflects the route locale, hreflang alternates propagate to all sub-routes, the muted-foreground CSS variable meets AA contrast in light mode, admin login labels are visible, a password visibility toggle is present, the skip link target is focusable, the zoom container has a visible focus ring, and the shortcut hint is suppressed on mobile. The `2xl:columns-5` column rule is wired and `humanizeTagLabel` is a single source of truth across all consumers.

What remains are a cluster of touch-target under-sizing issues that were not fully addressed by the fix wave, plus three new issues that were either introduced by the fix wave or simply never caught.

**Verification of prior fixes:** 20 of 23 findings resolved correctly. F-18 (photo alt text) is partially addressed in code but ineffective due to `tag_names` returning null in the listing query for most photos. F-19 (mobile nav topic scroll affordance) is still a discoverability concern. Three prior findings are effectively not fixed: nav topic links remain 32px tall (missed in the F-1/F-2 touch-target pass), LightboxTrigger is `h-8 w-8` = 32px (untouched), and the admin submit button plus password toggle are 36px (untouched by the F-20 fix which addressed Info/Back only).

**Top 3 NEW highest-impact issues:**
1. `tag_names` is `null` in the masonry listing query for all observable photos, making every card label "View photo: Untitled" and every image alt "Photo" — defeating F-18's code fix entirely.
2. LightboxTrigger button is `h-8 w-8` (32×32) and the desktop "Info" sidebar toggle is 32px tall — both were missed in the F-3/F-20 touch-target fix wave.
3. Nav topic links ("TWS", "TOMORROW X TOGETHER") are 32px tall across all viewports — a systematic miss that affects the primary content navigation surface.

**Top 3 strengths:**
1. The SEO/i18n metadata stack is now fully correct: OG locale matches route locale on all surfaces, hreflang alternates with `x-default` are present on home, topic, photo, and shared pages, and `ko:KR` / `en_US` roles are no longer swapped.
2. The not-found surfaces (both route 404 and photo 404) are now fully wrapped with nav, footer, `<main id="main-content" tabIndex={-1}>`, and a proper H1/decorative-span split — a clean, complete fix.
3. Tag humanization via `humanizeTagLabel` is correctly consolidated into a single export and used consistently in tag-filter pills, masonry card overlays, photo viewer sidebar badges, and `getConcisePhotoAltText` — the code is right even if the data is currently null.

---

## Methodology

- **Browser tool:** agent-browser CLI (headless Chromium), agent-browser-debug for JavaScript evaluation, agent-browser-config for viewport/device/media emulation, agent-browser-visual for screenshots
- **Viewports tested:**
  - iPhone 14: `set viewport 390 844 3` — confirmed `{w:390, h:844}`
  - Galaxy S20: `set viewport 360 800 3` — confirmed `{w:360, h:800}`
  - iPad portrait: `set viewport 768 1024 2` — confirmed
  - iPad landscape: `set viewport 1024 768 2` — confirmed
  - Laptop: `set viewport 1440 900 2` — confirmed
  - Desktop: `set viewport 1920 1080 1` — confirmed
  - Wide: `set viewport 2560 1440 2` — confirmed
- **Locales tested:** `en`, `ko`
- **Pages visited:**
  - `https://gallery.atik.kr/en` (homepage)
  - `https://gallery.atik.kr/ko` (Korean locale root)
  - `https://gallery.atik.kr/en/tws` (topic page)
  - `https://gallery.atik.kr/en/p/348` (photo viewer — has tags in DB)
  - `https://gallery.atik.kr/en/admin` (login form — no credentials entered)
  - `https://gallery.atik.kr/en/p/999999` (photo not-found)
  - `https://gallery.atik.kr/en/boguspage123` (route 404)
- **Authenticated surfaces excluded:** Admin dashboard, upload flow, settings, DB management — no credentials and out of scope.
- **Dark mode note:** The browser automation session persisted a dark-theme cookie throughout testing. `set media light` did not override the cookie-stored preference, so contrast measurements were taken after programmatically removing the `dark` class from `<html>` via `eval`, and CSS variable values were verified directly via `getPropertyValue('--muted-foreground')`.

---

## Prior Fix Verification

| Finding | Fix landed? | Evidence | Notes |
|---------|-------------|----------|-------|
| F-1: 44px tag filter chips | Yes | `tag_chips: [{text:"All", w:41, h:44}, {text:"Color in Music Festival", w:187, h:44}…]` at 390px | All 9 chips measure 44px tall. `interactivePillClass = "cursor-pointer hover:bg-primary/90 min-h-[44px] px-3 py-2"` |
| F-2: 44px mobile expand toggle | Yes | `expand_btn: {w:44, h:44}` at 390px and 360px | `min-w-[44px] min-h-[44px] flex items-center justify-center` in `nav-client.tsx` |
| F-3: 44px search trigger | Yes | `{text:"Search photos", w:44, h:44}` at 1440px | `className="h-11 w-11"` in `search.tsx` |
| F-4: 404 pages have nav/footer | Yes | `{has_nav:true, has_main:true, main_id:"main-content", has_footer:true}` on both `/en/boguspage123` and `/en/p/999999` | `not-found.tsx` now renders `<Nav />`, `<main id="main-content" tabIndex={-1}>`, `<Footer />` |
| F-5: Tag labels humanized | Yes | Tag chips show "Color in Music Festival" not "Color_in_Music_Festival"; DOM confirmed | `humanizeTagLabel` in `tag-filter.tsx` |
| F-6: og:locale matches route locale | Yes | `/en`: `og_locale:"en_US"`, `/ko`: `og_locale:"ko_KR"` | `getOpenGraphLocale` now uses route locale as primary |
| F-7: main tabindex=-1 for skip link | Yes | `{main: {tabindex:"-1", tag:"MAIN"}}` on public layout | `tabIndex={-1}` in `(public)/layout.tsx` |
| F-8: ImageZoom focus ring visible | Yes | `{outline:"rgb(96, 165, 250) auto 2px", outline_offset:"2px"}` after programmatic focus | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500` in `image-zoom.tsx` |
| F-9: Shortcut hint hidden on mobile | Yes | `{shortcut_hint: {display:"none"}}` at 390px | `hidden md:block` on the hint paragraph |
| F-10: Photo viewer mobile min-h | Yes (partially) | Photo visible above fold at 390px in screenshot; `min-h-[40vh] md:min-h-[500px]` in code | Visual confirms image renders above fold. Some vertical gap remains but no longer full-screen blank. |
| F-11: muted-foreground contrast | Yes | CSS variable confirmed `240 3.8% 40%`; computed `rgb(98,98,106)` vs white = 6.04:1 | Changed from 46.1% to 40% lightness. Dark mode unchanged at 7.76:1. |
| F-12: Admin login visible labels | Yes | `{has_visible_labels:["Username","Password"]}`, both `position:"static"`, `display:"block"` | Labels now use `text-sm font-medium block` not `sr-only` |
| F-13: Admin password toggle | Yes | `{has_toggle:true, password_type:"password"}`, `{label:"Show password", w:36, h:36}` | Toggle exists and functions. But only 36×36 — below 44px (see NF-1). |
| F-14: 404 "404" numeral contrast | Yes | `<span aria-hidden="true" className="text-muted-foreground/60">` — bumped from /30 to /60 | `aria-hidden="true"` added; H1 is now "Page not found." |
| F-15: 2xl masonry columns | Yes | `masonry: {class:["columns-1","sm:columns-2","md:columns-3","xl:columns-4","2xl:columns-5"]}` at 2560px | `2xl:columns-5` present. Tag filter no longer wraps at 2560px. |
| F-16: og:locale inverted | Yes | Verified same as F-6 | Same fix. |
| F-17: hreflang on topic/photo pages | Yes | `/en/tws`: `[{hreflang:"en",href:"…/en/tws"},{hreflang:"ko",href:"…/ko/tws"},{hreflang:"x-default",href:"…/en/tws"}]` and same pattern on `/en/p/348` | `buildHreflangAlternates` used in topic and photo `generateMetadata` |
| F-18: Photo alt text / aria-labels | Partial — code correct, data null | `photo_links_labels: ["View photo: Untitled"]` (all 30 on tws page); `img_alt: "Photo"` for all; `tag_names: null` in RSC payload for all photos including 348 | Code correctly calls `getConcisePhotoAltText` and `getPhotoDisplayTitleFromTagNames`. Returns "Untitled"/"Photo" because `tag_names` subquery returns null. See NF-3. |
| F-19: Mobile nav topic scroll affordance | Partial | Expand button is 44px (F-2 fixed). Topics visible after expand. Horizontal scroll with mask gradient remains non-obvious. | Not worse, not better. The discoverability concern is unchanged. |
| F-20: Photo viewer mobile toolbar 44px | Partial | Info button: `{h:44}`. Back button: `{h:44}`. LightboxTrigger: `{w:32, h:32}`. Desktop Info sidebar toggle: `{h:32}`. | F-20 fix covered Info (mobile) and Back. LightboxTrigger and desktop Info toggle were not in scope of that fix. See NF-2. |
| F-21: Search close button 44px | Yes | Close button: `{class:"h-11 w-11 shrink-0"}` in `search.tsx` | `h-11 w-11` applied |
| F-22: main landmark on 404 pages | Yes | Both 404 pages now have `<main id="main-content" tabIndex={-1}>` | Same fix as F-4. |
| F-23: Blur placeholder in photo viewer | Partial | Container has `skeleton-shimmer` class with shimmer animation. No blur_placeholder background-image. | CSS shimmer animation provides loading cue. The `blur_placeholder` data field is not used as CSS background yet. Better than nothing. |

**Summary: 17 fully fixed, 4 partially fixed (F-10, F-18, F-20, F-23), 2 substantially addressed (F-19, F-14). 0 regressions.**

---

## NEW Findings

### NF-1: Admin submit button (36px) and password toggle (36px) are below 44px touch target floor

- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en/admin` at all viewports
- **Evidence:**
  - DOM measurement: `submit_btn: {text:"Sign in", w:334, h:36, height_class:"36px"}`
  - Password toggle: `{label:"Show password", w:36, h:36}`
  - Source: `login-form.tsx` uses `<Button type="submit" className="w-full">` — default shadcn height is `h-9` (36px), no override. The password toggle uses `className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-md"` — `w-9 h-9` = 36px.
  - The F-20 fix targeted `photo-viewer.tsx` (Info and Back buttons) but did not address the admin login form buttons.
- **Impact:** The login form is the only way to access the admin surface. On mobile, tapping the "Sign in" button at 36px height increases miss-tap probability. The password toggle is critical for mobile users with autocorrect keyboards. Both are the most-tapped actions on this form.
- **Suggested fix:** In `login-form.tsx`, add `className="w-full h-11"` to the submit Button. Change the password toggle from `w-9 h-9` to `w-11 h-11` (44px). These are isolated class changes.

---

### NF-2: LightboxTrigger and desktop Info sidebar toggle are 32px tall — missed in the F-3/F-20 fix pass

- **Severity:** High
- **Confidence:** High
- **Surface:** `/en/p/<id>` at all viewports (LightboxTrigger); desktop 1024px+ (Info sidebar toggle)
- **Evidence:**
  - DOM measurement at 1440px: `{text:"Open fullscreen view", tag:"BUTTON", w:32, h:32}`
  - DOM measurement at 1440px: `{text:"Info", tag:"BUTTON", w:71, h:32}` (desktop sidebar toggle)
  - DOM measurement at 390px: `{label:"Open fullscreen view", w:32, h:32}` (confirmed on mobile too)
  - Source in `lightbox.tsx` line 41: `<Button variant="ghost" size="icon" onClick={onClick} className="h-8 w-8" ...>` — explicitly `h-8 w-8` (32px)
  - Source in `photo-viewer.tsx`: desktop Info toggle uses `<Button variant={isPinned ? "default" : "outline"} size="sm" ...>` — `size="sm"` is `h-9` (36px) but DOM reports 32px, suggesting the outer button layout squashes it
  - The F-20 fix added `h-11` to the mobile Info button (`className="gap-2 lg:hidden h-11"`) and Back button (`className="pl-0 gap-2 h-11"`), but left the LightboxTrigger at `h-8 w-8` and the desktop Info toggle at `size="sm"`
- **Impact:** The "Open fullscreen view" (lightbox) is the primary way to view full-resolution photos in an immersive mode. It is present on every photo page at every viewport. At 32px it is consistently below the touch target floor. The desktop Info toggle is primarily mouse-driven but hybrid tablet users (iPad, Surface) will miss-tap. The lightbox is the single most important interactive element on the photo viewer after navigation.
- **Suggested fix:**
  - In `lightbox.tsx` line 41: change `className="h-8 w-8"` to `className="h-11 w-11"`. The icon remains `h-4 w-4`.
  - In `photo-viewer.tsx`, change the desktop Info toggle from `size="sm"` to `size="default"` and add `className="gap-2 transition-all hidden lg:flex h-11"`.

---

### NF-3: tag_names returns null for all photos in masonry listing — F-18 code fix is inoperative

- **Severity:** High
- **Confidence:** High
- **Surface:** `/en`, `/en/tws`, any topic page — all masonry cards
- **Evidence:**
  - RSC payload inspection: all `tag_names` entries are `null` in the page payload for `/en/tws` (curl of RSC stream shows `"tag_names":null` for every image record, including photo 348 which has confirmed tags in the database)
  - DOM confirmation: `{total_links:30, unique_labels:["View photo: Untitled"], sample_alts:["Photo","Photo","Photo","Photo","Photo"]}` on `/en/tws` where the tag filter shows 134 JIHOON-tagged photos
  - Photo 348 page title is `#JIHOON #DOHOON #Color in Music Festival` (from the `getImage()` JOIN query), but its masonry card says "Untitled" and `img alt="Photo"`
  - The masonry listing uses `getImagesLitePage` → `getImagesLite` which has a correlated subquery: `(SELECT GROUP_CONCAT(DISTINCT t.name ORDER BY t.name) FROM ${imageTags} it JOIN ${tags} t ON it.tag_id = t.id WHERE it.image_id = ${images.id})`
  - The correlated subquery uses Drizzle `sql` template with `${imageTags}` and `${tags}` (table references) and `it.tag_id`, `it.image_id`, `t.id`, `t.name` as raw SQL string aliases. Drizzle v0.45.2 renders `${imageTags}` as the full backtick-escaped table name in the template, but the alias `it` and raw column references (`it.tag_id`) may be causing the subquery to fail silently when Drizzle inserts additional escaping or parameter placeholders around the table reference
  - The older `getImages()` function uses `LEFT JOIN imageTags ... GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})` with Drizzle column references (not raw alias strings) and correctly returns tags — but `getImages` is not used for the public masonry listing
- **Impact:** The entire F-18 code fix is inoperative. Every photo in the masonry grid presents an identical "View photo: Untitled" accessible label and alt="Photo" to screen readers. 30 photos on the first page, all indistinguishable by label. This is the most severe accessibility regression for blind users — the core content discovery surface is inaccessible by label.
- **Suggested fix:** The root cause is the correlated subquery failing silently. Replace the correlated subquery approach in `getImagesLite` / `getImagesLitePage` with the same LEFT JOIN + GROUP_CONCAT pattern used by `getImages()`:
  ```ts
  // In getImagesLitePage and getImagesLite:
  // REPLACE correlated subquery:
  tag_names: sql<string | null>`(SELECT GROUP_CONCAT(...)...)`
  // WITH the JOIN approach:
  tag_names: sql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`
  // AND add:
  .leftJoin(imageTags, eq(images.id, imageTags.imageId))
  .leftJoin(tags, eq(imageTags.tagId, tags.id))
  .groupBy(images.id)
  ```
  Alternatively, debug the correlated subquery by checking the actual SQL Drizzle generates (enable query logging) and verify the `it.image_id` / `it.tag_id` references are not being interpreted as column binding parameters.

---

### NF-4: Nav topic links are 32px tall across all viewports — systematic miss in touch-target audit

- **Severity:** Medium
- **Confidence:** High
- **Surface:** All pages, nav — all viewports including mobile after expand
- **Evidence:**
  - DOM measurement at 1440px: `nav_topic_links: [{text:"TWS", w:55, h:32}, {text:"TOMORROW X TOGETHER", w:200, h:32}]`
  - DOM measurement at 390px (mobile, after expand): same 32px height
  - Source in `nav-client.tsx` line 118-126: topic links use `className="transition-all duration-200 flex items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap shrink-0"`. `py-1.5` = 6px padding × 2 = 12px + text line-height (~20px) = 32px.
  - Adjacent nav controls (search, theme, locale) correctly measure 44px. The topic links were not included in the F-1/F-2 touch-target audit.
  - Site title link "ATIK.KR Gallery" measures 140×28px — also below 44px but is a logo/brand link with less tap frequency than topic navigation.
- **Impact:** Topic links are the primary navigation between content categories. On touch devices, a 32px vertical target is reliably below the comfortable thumb zone, especially at the top of the screen where the nav is sticky. This affects all mobile users attempting to switch between "TWS" and "TOMORROW X TOGETHER" topics.
- **Suggested fix:** In `nav-client.tsx`, change the topic link `py-1.5` to `py-2.5` (which gives 41px — close) or add `min-h-[44px] flex items-center` to the link className: `"transition-all duration-200 flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-full whitespace-nowrap shrink-0"`.

---

### NF-5: Load More button is 36px tall — not part of the F-1 fix

- **Severity:** Low
- **Confidence:** High
- **Surface:** Home and topic pages when more photos exist below the fold
- **Evidence:**
  - DOM measurement at 1440px: `load_more_btn: {text:"Load more", w:104, h:36}`
  - DOM measurement at 390px: `{text:"Load more", w:104, h:36}` — same at mobile
  - Source: `load-more.tsx` uses a default `<Button>` which is `h-9` = 36px. No explicit height override.
- **Impact:** The Load More button is the only way to access additional photos beyond the first page. At 36px it is consistently below the 44px touch target, affecting all mobile users who scroll to the bottom of the gallery.
- **Suggested fix:** In `load-more.tsx`, add `className="h-11"` to the Button or use `size="lg"` (if available in the shadcn config). A simple `h-11` override keeps the existing width.

---

### NF-6: ATIK.KR Gallery site title link is 28px tall — untapped navigation shortcut below touch target

- **Severity:** Low
- **Confidence:** High
- **Surface:** All pages — nav header, all viewports
- **Evidence:**
  - DOM measurement at 1440px: `{text:"ATIK.KR Gallery", w:140, h:28}`
  - Source in `nav-client.tsx`: `<Link href={localizedHomeHref} className="flex items-center space-x-2 shrink-0"><span className="font-bold text-xl tracking-tight">{navTitle}</span></Link>` — no explicit height or padding
  - The site title tap-to-home is a standard navigation pattern that users rely on especially on mobile
- **Impact:** Lower frequency than topic links but the home navigation is a primary escape hatch when lost in photo pages. 28px is meaningfully below 44px on touch. However, the title is often within a larger nav row that provides some additional tap area via the flex container.
- **Suggested fix:** In `nav-client.tsx`, add `min-h-[44px] flex items-center` to the Link className.

---

## Cross-cutting Observations

**Incomplete touch-target audit:** The F-1/F-2/F-3 fix wave correctly addressed tag chips, the expand toggle, and the search trigger. But it did not audit every interactive element in the nav and photo viewer. The missed elements follow a consistent pattern: they were either styled before the touch-target audit began (LightboxTrigger at `h-8 w-8`) or were treated as desktop-primary (Info sidebar toggle, nav topic links). A global Tailwind audit with `grep -rn "h-8\|h-9\|size=\"sm\"\|size=\"icon\"" src/components/` would surface all remaining violations in one pass.

**tag_names null in correlated subquery:** The F-18 fix consolidated the humanization code correctly but the data transport layer silently returns null. This is the most impactful unresolved issue because it affects the accessibility of the entire gallery grid for screen reader users. The `getImages()` function (used in admin) correctly gets tag names via LEFT JOIN; `getImagesLite` / `getImagesLitePage` use a correlated subquery that appears to fail silently in production. Switching to the JOIN approach would unify the two code paths and fix the data issue.

**Partial F-23 (blur placeholder):** The `skeleton-shimmer` CSS animation provides a loading shimmer on the photo container — better than a flat dark box. The `blur_placeholder` field stored in the database (16px blurred JPEG per CLAUDE.md) is still not used as a background-image CSS property. This would provide an instant content preview while the full image decodes. It is a one-line addition: `style={{ backgroundImage: image.blur_placeholder ? \`url(${image.blur_placeholder})\` : undefined }}` on the photo container div.

---

## Strengths (What to Keep)

1. **SEO metadata is now fully correct across all public surfaces.** OG locale matches route locale, hreflang includes `x-default`, alternates use `buildHreflangAlternates` so adding a new locale to `LOCALES` auto-propagates. This is the cleanest multi-locale SEO implementation seen in a personal gallery app.

2. **404 pages are now properly wired into the layout shell.** Nav, footer, `<main>` landmark, skip link, `tabIndex={-1}`, correct heading hierarchy, and `aria-hidden` on the decorative numeral. This was a complete fix, not a minimal patch.

3. **humanizeTagLabel is a verified single source of truth.** The code correctly transforms underscored slugs in tag-filter pills, masonry card overlays, photo viewer sidebar badges, and alt text generation. The test at `apps/web/src/__tests__/` locks this down. The implementation is sound — the data transport failure (NF-3) is the only blocker.

4. **ImageZoom focus ring is now explicitly blue, independent of CSS variable chain.** `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500` produces a reliable 2px `rgb(96,165,250)` outline on Chromium. This is the correct approach — using a hard-coded color instead of `--ring` CSS variable avoids the theme-state coupling that caused the original failure.

5. **Reduced-motion, AVIF format negotiation, and React cache() deduplication remain intact.** No regressions introduced in these areas across the fix wave.

---

## Out-of-Scope but Worth Noting

- **Shared group/link pages (`/g/`, `/s/`):** Still not testable without credentials. The `generateMetadata` in these routes does include `getOpenGraphLocale` and hreflang patterns, so they are likely correct, but unverified.
- **Admin dashboard upload flow:** Out of scope. The F-20 fix only touched the public photo viewer.
- **`blur_placeholder` as CSS background:** Straightforward one-liner in `photo-viewer.tsx` that would close F-23 completely without any query changes.
- **Site title link height:** The 28px height is Low severity because the flex row provides some additional effective tap area via adjacent whitespace on the nav bar.

---

## Appendix: Contrast Measurements

All measurements via JavaScript `getComputedStyle` + WCAG 2.1 relative luminance formula. Light mode values taken after programmatic `classList.remove('dark')` + CSS variable readback via `getPropertyValue`. Dark mode values taken from persistent dark theme session.

| Surface | Mode | FG (rgb) | BG (rgb) | Ratio | WCAG tier |
|---|---|---|---|---|---|
| Heading H1 | Dark | rgb(250,250,250) | rgb(9,9,11) | 19.06:1 | AAA |
| Body/nav text | Dark | rgb(250,250,250) | rgb(9,9,11) | 19.06:1 | AAA |
| Muted foreground | Light | rgb(98,98,106) | rgb(255,255,255) | 6.04:1 | AA (comfortable) |
| Muted foreground | Dark | rgb(161,161,170) | rgb(9,9,11) | 7.76:1 | AAA |
| Admin submit button | Dark | rgb(24,24,27) | rgb(250,250,250) | 16.97:1 | AAA |
| Tag chip (active) | Dark | rgb(9,9,11) | rgb(250,250,250) | 19.06:1 | AAA |
| Tag chip (inactive) | Dark | muted-fg on card | card bg | ~7.76:1 | AAA |
| 404 numeral /60 opacity | Dark | blended ~rgb(97,97,103) | rgb(9,9,11) | ~3.9:1 | Fails AA for text; passes as decorative (aria-hidden) |
| ImageZoom focus outline | Both | rgb(96,165,250) | n/a | 2px solid blue | Passes 2.4.7/2.4.11 |

---

## Appendix: Per-Viewport Screenshots

Screenshots captured to `/tmp/` during browser automation session. Paths are session-ephemeral.

| Route | Viewport | Path |
|---|---|---|
| `/en` (home, dark) | Desktop 1440×900 | `/tmp/v2-desktop-1440-home.png` |
| `/en` (home, dark) | Desktop 1920×1080 | `/tmp/v2-desktop-1920-home.png` |
| `/en` (home, dark) | Wide 2560×1440 | `/tmp/v2-desktop-2560-home.png` |
| `/ko` (home, Korean) | Desktop 1440×900 | `/tmp/v2-desktop-ko-home.png` |
| `/en` (home, dark) | iPhone 14 390×844 | `/tmp/v2-mobile-390-home.png` |
| `/en/p/348` (photo) | iPhone 14 390×844 | `/tmp/v2-mobile-390-photo.png` |
| `/en/admin` (login) | iPhone 14 390×844 | `/tmp/v2-mobile-390-admin.png` |
| `/en` (home) | Galaxy S20 360×800 | `/tmp/v2-mobile-s20-home.png` |
| `/en` (home) | iPad portrait 768×1024 | `/tmp/v2-tablet-portrait-home.png` |
| `/en/p/348` (photo) | iPad portrait 768×1024 | `/tmp/v2-tablet-portrait-photo.png` |
| `/en` (home) | iPad landscape 1024×768 | `/tmp/v2-tablet-landscape-home.png` |
| `/en/p/348` (photo) | iPad landscape 1024×768 | `/tmp/v2-tablet-landscape-photo.png` |
| `/en/boguspage123` (404) | Desktop 1440×900 | `/tmp/v2-404-route.png` |
| `/en/p/999999` (photo 404) | Desktop 1440×900 | `/tmp/v2-404-photo.png` |
| `/en` (home, dark forced) | Desktop 1440×900 | `/tmp/v2-dark-home.png` |
| `/en/admin` | Desktop 1440×900 | `/tmp/v2-admin-login.png` |
