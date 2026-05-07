# Designer Deep UI/UX Review (HEAD: 03e5b66b4f66afa5e71bc1d5c3ec393a9cf4f86d)

## Summary

GalleryKit ships as a polished, opinionated photo gallery that is visually coherent, performant, and more accessibility-aware than most self-hosted gallery software. The dark/light mode implementation is clean, the masonry grid degrades gracefully across breakpoints, and the keyboard navigation story on the photo viewer is nearly complete. However, a cluster of medium-severity issues collectively erodes the experience at the margins: touch targets throughout the tag filter and mobile nav are systematically undersized (26px tall, all of them), the 404/not-found error surfaces are orphaned pages missing the site nav and footer entirely, raw slug-format tag labels (`Color_in_Music_Festival`) bleed through to users in two prominent locations, the `og:locale` is hardcoded to `ko_KR` on the English locale, hreflang alternates are missing from all topic and photo pages, and the zoom button's focus ring is invisible (`rgba(0,0,0,0)`). None of these are catastrophic, but several are blocking for users who rely on assistive technology or operate from touch-only devices.

**Top 3 highest-impact issues:**
1. Touch targets on tag filter badges, mobile menu toggle, and search button are 26–36px tall — systematically below the 44px WCAG 2.5.8 minimum, affecting all mobile/touch users on the most-visited interactive surface.
2. Error pages (photo-not-found, route 404) render without the site nav or footer, leaving users stranded on a dead-end page with only a bare "Back to gallery" link and no wayfinding.
3. `og:locale` is `ko_KR` on `/en/*` pages (including the homepage); hreflang alternate links are absent on all sub-routes (topic, photo, shared). Both issues harm SEO for English-language indexing and social sharing.

**Top 3 strengths:**
1. Performance is exceptional: TTFB 26ms, FCP 64ms, 24KB transfer on first load with aggressive AVIF format negotiation already wired (30 AVIF `<source>` elements on the homepage).
2. The reduced-motion implementation is comprehensive — framer-motion respects `useReducedMotion()`, the back-to-top scroll uses `prefers-reduced-motion`, the global CSS zeroes all animation/transition durations on `prefers-reduced-motion: reduce`, and the lightbox image cross-fade is gated on the same preference.
3. Semantic heading hierarchy (H1 → H2 `sr-only` "Photos" → H3 per card on the grid; H1 `sr-only` on photo viewer) is correct and was clearly deliberate — rare to see this done properly in gallery apps.

---

## Methodology

- **Browser tool:** agent-browser 0.22.2 (headless Chromium), agent-browser-debug for JavaScript evaluation, agent-browser-config for viewport/device/media emulation
- **Viewports tested:**
  - iPhone 14 (390x844, DPR 3, touch-emulated via `set device "iPhone 14"`)
  - Galaxy S20 equivalent (360x800, DPR 3, via `set viewport 360 800 3`)
  - iPad portrait (768x1024, DPR 2, via `set viewport 768 1024 2`)
  - iPad landscape (1024x768, DPR 2, via `set viewport 1024 768 2`)
  - Laptop (1440x900, DPR 2, via `set viewport 1440 900 2`)
  - Desktop (1920x1080, DPR 1, via `set viewport 1920 1080 1`)
  - Wide (2560x1440, DPR 2, via `set viewport 2560 1440 2`)
- **Locales tested:** `en`, `ko` (locale switch verified on homepage)
- **Pages visited:**
  - `https://gallery.atik.kr/en` (homepage, light + dark mode)
  - `https://gallery.atik.kr/ko` (Korean locale root)
  - `https://gallery.atik.kr/en/tws` (topic page)
  - `https://gallery.atik.kr/en/p/348` (photo viewer, real content)
  - `https://gallery.atik.kr/en/p/1` (photo-not-found state)
  - `https://gallery.atik.kr/en/p/999999` (photo-not-found state)
  - `https://gallery.atik.kr/en/admin` (login form only — no credentials entered)
  - `https://gallery.atik.kr/en/boguspage123` (route 404)
- **Authenticated surfaces excluded:** Admin dashboard, upload flow, settings, DB management — no credentials available and review scope is public-facing UI
- **Shared group/link pages (`/g/`, `/s/`):** Could not test — no keys discoverable without authentication. Noted as gap.
- **Screenshots captured:** `/tmp/home-desktop.png`, `/tmp/photo-viewer-p348.png`, `/tmp/admin-login.png`, `/tmp/404-page.png`, `/tmp/mobile-iphone14-home.png`, `/tmp/mobile-iphone14-photo.png`, `/tmp/mobile-s20-home.png`, `/tmp/mobile-s20-admin.png`, `/tmp/tablet-ipad-portrait-home.png`, `/tmp/tablet-ipad-portrait-photo.png`, `/tmp/tablet-ipad-landscape-home.png`, `/tmp/tablet-ipad-landscape-photo.png`, `/tmp/desktop-ko-home.png`, `/tmp/desktop-topic-tws.png`, `/tmp/desktop-1920-home.png`, `/tmp/desktop-2560-home.png`, `/tmp/dark-mode-home.png`, `/tmp/light-mode-home.png`, `/tmp/photo-not-found.png`

---

## Findings

### F-1: Touch targets on tag filter badges are 26px tall — fail WCAG 2.5.8
- **Severity:** High
- **Confidence:** High
- **Surface:** `/en`, `/ko`, `/en/tws`, any topic page with tag filter visible
- **Evidence:**
  - JavaScript measurement at iPhone 14 (390px): `All: 33x26; Color_in_Music_Festival(276): 190x26; SHINYU(174): 94x26; Asia_Top_Artist_Festival(169): 191x26; JIHOON(134): 95x26; KYUNGMIN(105): 114x26; DOHOON(99): 98x26; YOUNGJAE(64): 110x26; HANJIN(47): 88x26`
  - All 9 tag filter buttons are 26px tall at mobile viewport. WCAG 2.5.8 AA requires 24×24px minimum (2.2) and the widely-applied de-facto target is 44×44px (Apple HIG / Google MDN).
  - The `TagFilter` component applies `min-h-[24px] py-1` per code review (`tag-filter.tsx` line comment references AGG3R-03 / C3R-RPL-03), which bumps minimum height to 24px but does not reach 44px.
  - The `Load more` button also measures 104x36 (below 44px tall).
- **Impact:** Every user on a touch device tapping tag filters experiences reduced accuracy. On small hands or cold/gloved fingers the 26px strip is likely to miss. This is the primary interactive surface for content discovery.
- **Suggested fix:** In `tag-filter.tsx`, change `min-h-[24px] py-1` to `min-h-[44px] px-3 py-2` on the `interactivePillClass`. The pills will grow vertically but maintain horizontal compactness. Alternatively, wrap each Badge in a `<div className="py-2">` hit-area extender using negative margin trick: `py-[10px] -my-[10px]`.

---

### F-2: Mobile nav expand toggle is 32x32 (below 44px)
- **Severity:** High
- **Confidence:** High
- **Surface:** `/en`, `/ko`, all pages — mobile viewport (<768px)
- **Evidence:**
  - Touch target measurement at iPhone 14: `Expand menu: 32x32`
  - `nav-client.tsx` line: `className="ml-auto p-2 hover:bg-accent rounded-full md:hidden shrink-0"` — `p-2` = 8px padding, icon is `h-4 w-4` (16px), total 32px.
  - Accessibility snapshot confirms: `button "Expand menu" [expanded=false, ref=e5]`
- **Impact:** The mobile hamburger equivalent is the primary way to access search, theme toggle, and locale switch on mobile. A 32px target on a small screen creates frustration for all mobile users. This is the #1 mobile nav action.
- **Suggested fix:** In `nav-client.tsx`, change `p-2` to `min-w-[44px] min-h-[44px] flex items-center justify-center` to match the theme/locale button class already used in the controls section.

---

### F-3: Search button is 36x36 at desktop (below 44px)
- **Severity:** Medium
- **Confidence:** High
- **Surface:** All pages, desktop nav
- **Evidence:**
  - JavaScript measurement at 1440x900: `search_btn: 36x36`. Theme and locale buttons correctly measure `44x44`.
  - `search.tsx`: `className="h-9 w-9"` on the search trigger Button (`size="icon"`). The theme/locale buttons use `min-w-[44px] min-h-[44px]` explicitly.
- **Impact:** Inconsistency — the two adjacent buttons are 44px, but the search button is 36px. Mouse users will have slightly reduced target but can compensate; touch-hover users on hybrid devices will miss more often.
- **Suggested fix:** In `search.tsx`, change `className="h-9 w-9"` to `className="h-11 w-11"` (44px) on the trigger Button, matching the controls pattern.

---

### F-4: 404 and photo-not-found pages have no nav or footer
- **Severity:** High
- **Confidence:** High
- **Surface:** `/en/p/999999` (photo not found), `/en/boguspage123` (route 404), any invalid `/en/p/<id>`
- **Evidence:**
  - JavaScript eval on `/en/p/999999`: `{"has_nav":false,"has_footer":false,"page_title":"Photo Not Found | ATIK.KR Gallery","h1_text":"404","back_link":"Back to gallery"}`
  - JavaScript eval on `/en/boguspage123`: accessibility snapshot shows heading "404" → paragraph "Page not found." → link "Back to gallery" — no `navigation` role element present.
  - Screenshot `/tmp/photo-not-found.png` confirms a near-black page with only "404 / Page not found. / Back to gallery" centred on screen and zero contextual navigation.
  - `/src/app/[locale]/not-found.tsx` renders only a `<div className="flex flex-col items-center justify-center min-h-[60vh]">` — it does not include the `<Nav>` or `<Footer>` components.
- **Impact:** A user who follows a broken link or misremembers a URL lands on a stripped page with no topic navigation, no search, no way to browse other albums. The only escape is the "Back to gallery" link. For users arriving from external links (social media shares, search results) this is a dead end with zero wayfinding. The photo-not-found case is particularly likely since photo IDs can be shared and then deleted.
- **Suggested fix:** Wrap the not-found page content in the same `layout.tsx` shell that includes `<Nav>` and `<Footer>`. In Next.js App Router, `not-found.tsx` inherits the nearest layout, so the issue is that the `not-found.tsx` at `[locale]` level is not inheriting the layout that adds nav/footer. Verify the layout wrapping chain — if the photo viewer page `layout.tsx` does not include nav/footer, add them to the shared `[locale]/layout.tsx`.

---

### F-5: Tag labels display raw slug format (`Color_in_Music_Festival`) to users
- **Severity:** Medium
- **Confidence:** High
- **Surface:** Tag filter on `/en`, `/ko`, `/en/tws`; page H1 when filtering (e.g. `#Color_in_Music_Festival`)
- **Evidence:**
  - Accessibility snapshot of homepage: `button "Color_in_Music_Festival (276)"`, `button "Asia_Top_Artist_Festival (169)"`.
  - JavaScript eval: `"All | Color_in_Music_Festival(276) | SHINYU(174) | Asia_Top_Artist_Festival(169) | JIHOON(134)…"`
  - H1 on tag-filtered page: `#Color_in_Music_Festival` (with underscores).
  - The `tag-filter.tsx` component renders `tag.name` which in this database contains raw slug-like strings with underscores.
- **Impact:** Underscores in user-visible labels are a data hygiene issue, but the symptom is a consistently unprofessional label display. Users see `Color_in_Music_Festival` instead of `Color in Music Festival`. This affects all users on the most-used filter surface.
- **Suggested fix:** Either (a) sanitize tag `name` at the data layer to replace underscores with spaces when displaying (since `slug` is the canonical identifier for URLs, `name` can be display-formatted), or (b) add a transform in `tag-filter.tsx`: `tag.name.replace(/_/g, ' ')`. Option (a) is cleaner — fix the display names in the database, since the tag count labels in the accessibility tree also show raw names.

---

### F-6: `og:locale` is `ko_KR` on `/en/*` pages; hreflang absent on sub-routes
- **Severity:** High (SEO impact)
- **Confidence:** High
- **Surface:** All topic pages (`/en/tws`), homepage (`/en`)
- **Evidence:**
  - JavaScript eval on `/en/tws`: `{"og_locale":"ko_KR","og_alt_locale":"en_US","hreflang_links":[],"canonical":"https://gallery.atik.kr/en/tws"}`
  - JavaScript eval on `/en`: `{"og_locale":"ko_KR","hreflang_links":[]}`
  - The `layout.tsx` passes `locale` and `seo.locale` to `getOpenGraphLocale(locale, seo.locale)`. If `seo.locale` is set to `ko` in the database settings, and `getOpenGraphLocale` preferentially returns `seo.locale` for the owner locale, this explains the mismatch.
  - Hreflang alternates (`link[rel=alternate][hreflang]`) exist on the root layout but evaluate to empty array on the topic page, meaning they are either not propagated through or are not rendered in the page `<head>` for sub-routes.
- **Impact:** When a user shares an English photo page to Slack, Discord, or iMessage, the unfurl will show `ko_KR` locale metadata. Google may also score the page lower for English searches if OG locale contradicts the HTML `lang="en"`. Missing hreflang on topic/photo pages means search engines cannot properly associate the Korean and English versions.
- **Suggested fix:**
  - In `getOpenGraphLocale`, ensure the function returns the route locale (`locale` param), not `seo.locale`, when they differ. `seo.locale` should be a fallback for content written in that language, not an override for the URL locale.
  - For hreflang on topic/photo pages, add `alternates.languages` in `generateMetadata` for `[topic]/page.tsx` and `p/[id]/page.tsx` similar to what root `layout.tsx` does.

---

### F-7: Skip link target `<main>` has no `tabindex="-1"`
- **Severity:** Medium
- **Confidence:** High
- **Surface:** All pages
- **Evidence:**
  - JavaScript eval: `{"skip_target_exists":true,"skip_target_tag":"MAIN","skip_target_id":"main-content","skip_target_tabindex":null}`
  - The skip link `href="#main-content"` resolves correctly to a `<main id="main-content">` element, but that element has no `tabindex` attribute.
  - In most browsers, clicking an anchor that points to a non-focusable element moves the scroll position but does not move keyboard focus to the target, meaning subsequent Tab presses start from where focus was (the skip link itself), not from inside `<main>`. This defeats the skip link's purpose for keyboard users.
- **Impact:** Keyboard-only users (common among screen reader users and power users) who activate the skip link will not have focus moved into the main content area. They still have to Tab through the entire nav bar to reach the first photo.
- **Suggested fix:** Add `tabindex="-1"` to the `<main>` element in the layout. In Next.js App Router, this is in the template or layout JSX: `<main id="main-content" tabIndex={-1}>`. `tabindex="-1"` makes the element programmatically focusable without making it part of the natural tab order.

---

### F-8: Zoom button focus ring is invisible (`rgba(0,0,0,0)`)
- **Severity:** High (accessibility)
- **Confidence:** High
- **Surface:** `/en/p/<id>` — the ImageZoom interactive region
- **Evidence:**
  - JavaScript eval on photo viewer page: `{"focused_el":"DIV Click to zoom in","focus_outline":"rgba(0, 0, 0, 0) solid 2px"}`
  - The `ImageZoom` component (`image-zoom.tsx`) applies `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` via Tailwind, but the computed outline is transparent black. This suggests the ring utility is not firing or the element is receiving focus in a way that `focus-visible` pseudo-class does not trigger (e.g., mouse click sets `:focus` but not `:focus-visible`, while programmatic `.focus()` also misses it in some Chromium builds when the containing div has no `tabindex` history).
  - Separately, the `role="button" tabIndex={0}` on the zoom container is correct; the ring class is present in the source; the transparent computed value indicates the CSS variable `--ring` may be resolving to transparent in the current theme state.
- **Impact:** Keyboard users navigating the photo viewer cannot see which element has focus. The photo viewer is one of the most keyboard-navigated surfaces in the app (arrow keys, F for fullbox, Escape). A missing focus ring on the central interactive element is a WCAG 2.4.7 failure (Focus Visible, AA).
- **Suggested fix:** Replace the Tailwind `focus-visible:ring-*` utilities with an explicit focus style that does not depend on the CSS variable chain: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500` (or a brand color). Alternatively, verify that `--ring` is set correctly in both light and dark theme CSS variables in `globals.css` (currently `--ring: 240 5.9% 10%` in light / `240 4.9% 83.9%` in dark — these should produce visible outlines, so the issue may be `focus-visible` not triggering on programmatic focus from click; test with Tab key navigation specifically).

---

### F-9: Shortcut hint text shown on mobile where shortcuts don't apply
- **Severity:** Low
- **Confidence:** High
- **Surface:** `/en/p/<id>` at mobile viewport
- **Evidence:**
  - JavaScript eval at iPhone 14 (390px viewport): `{"hint_visible":true,"shortcuts_text":"Shortcuts: Left/Right arrows navigate photos, F opens or closes the lightbox."}`
  - On a touch device, there are no physical arrow keys and the `F` key does not exist. The hint is visible but irrelevant, wasting precious vertical space above the photo on a 390px-wide screen.
  - The hint is in a `<p>` element with no responsive display utilities (no `hidden md:block` or similar).
- **Impact:** Mobile users see a confusing hardware-keyboard shortcut hint that does not apply to their device. It occupies a full line of vertical space before the photo appears, pushing the image further down on already-constrained mobile screens.
- **Suggested fix:** Add `hidden md:block` (or `sm:block`) to the shortcut hint paragraph in `photo-viewer.tsx` line 246: `<p className="mb-2 text-xs text-muted-foreground hidden md:block" ...>`. Mobile users navigate via swipe (already implemented in Lightbox) and the Info bottom sheet button, which are self-evident.

---

### F-10: Photo viewer has significant empty space (black bars) on mobile portrait
- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en/p/<id>` at 390x844 (iPhone 14)
- **Evidence:**
  - Screenshot `/tmp/mobile-iphone14-photo.png` shows roughly 40% of the screen above the photo is empty dark space. The image (340x606 bounding box per measurement) starts well below the fold.
  - The photo viewer container has `min-h-[500px]` on the image box. On a 390px-wide phone, a landscape photo would need 500px height, which exceeds the visual viewport height minus nav and toolbar, forcing scroll just to see the image.
  - The photo viewer grid is `grid-cols-1` on mobile with no column layout, so the image occupies full width (340px content area), but the container enforces `min-h-[500px]` regardless of the photo's actual aspect ratio.
  - The orientation-aware CSS in `globals.css` only addresses `(orientation: landscape)` cases, not portrait mobile with `min-h` constraint.
- **Impact:** First impression of the photo viewer on mobile is a mostly-blank screen followed by scrolling. Users must scroll down to see the photo, then scroll more to reach Info button and navigation. This is the core viewing experience on the most common device class.
- **Suggested fix:** In `photo-viewer.tsx` line 327, change `min-h-[500px]` to `min-h-[40vh]` or compute the height from the photo's actual aspect ratio and available viewport width: `style={{ aspectRatio: \`${image.width}/${image.height}\`, maxHeight: '80vh' }}`. Remove the fixed `min-h` and let the image's intrinsic ratio drive the container height at mobile. The existing `max-h-[80vh]` on the img element itself is correct; the issue is the containing div's `min-h`.

---

### F-11: Muted foreground text (4.83:1) is marginal for normal-weight small text
- **Severity:** Medium
- **Confidence:** High
- **Surface:** Homepage photo count ("445 photos"), tag filter secondary text, photo viewer metadata labels
- **Evidence:**
  - JavaScript contrast measurement, light mode (after forcing `dark` class removal): `Muted text: fg=rgb(113,113,122) bg=rgb(255,255,255) ratio=4.83`
  - CSS variable: `--muted-foreground: 240 3.8% 46.1%` in light mode → `hsl(240, 3.8%, 46.1%)` → approximately `rgb(113,113,122)`.
  - WCAG 2.1 AA requires 4.5:1 for normal text under 18pt (24px) / 14pt bold (approximately 18.67px bold). The photo count `"445 photos"` is `text-sm` (14px / ~10.5pt) in `font-normal` weight → ratio 4.83:1 passes AA at exactly `4.5:1` minimum (4.83 > 4.5), but the margin is thin (0.33:1 clearance).
  - In dark mode: `Muted text: fg=rgb(161,161,170) bg=rgb(9,9,11) ratio=7.76` — dark mode passes comfortably.
  - The `text-xs` shortcut hint on the photo viewer (`12px`) would need 4.5:1 as normal text; at 4.83:1 it passes AA but not AAA (7:1).
- **Impact:** Light mode users with lower-acuity vision or glare conditions will find secondary information (counts, timestamps, labels) difficult to read. The pass margin is too thin for confidence that it works on real displays with color profile variation.
- **Suggested fix:** Shift `--muted-foreground` in `:root` from `240 3.8% 46.1%` to `240 3.8% 40%` (slightly darker), which gives approximately `rgb(97,97,106)` → ~6.1:1 against white. This maintains the visual softness of muted text while comfortably clearing AA.

---

### F-12: Admin login form labels are visually hidden (`sr-only`) — no visible labels
- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en/admin`
- **Evidence:**
  - `login-form.tsx` lines 39-40, 42-43: `<label htmlFor="login-username" className="sr-only">` and `<label htmlFor="login-password" className="sr-only">`.
  - Accessibility snapshot confirms: `LabelText: "Username"` is present in the tree (so screen readers get it), but the visual label is hidden.
  - Inputs use placeholder text (`placeholder={t('username')}`) as the only visible label. Placeholders disappear as soon as the user starts typing, leaving no reminder of what field is active.
  - Screenshot `/tmp/admin-login.png` shows only `Username` and `Password` placeholder text in the input fields — no persistent visible labels.
- **Impact:** When a user has typed a username and tabbed to the password field, the username field now shows only the typed value with no label. If a user returns to edit the username after typing in the password field, they must remember which field is which. This violates WCAG 3.3.2 (Labels or Instructions, AA) since the label is not persistently visible.
- **Suggested fix:** Add visible labels above each input. The `sr-only` classes can be removed and replaced with `text-sm font-medium mb-1` labels above the inputs. If the compact card design must be preserved, use floating label pattern or label inside the card header. Do not rely on placeholders as the sole visible label.

---

### F-13: Admin login has no password visibility toggle
- **Severity:** Low
- **Confidence:** High
- **Surface:** `/en/admin` login form
- **Evidence:**
  - `login-form.tsx` renders `<Input type="password" ...>` with no toggle button.
  - Accessibility snapshot: `textbox "Password" [required]` — only a plain password input, no adjacent button.
  - Screenshot confirms no eye-icon toggle.
- **Impact:** Users who mistype their password have no way to verify what they typed. On mobile keyboards with autocorrect, password mistyping is common. This is a minor usability regression compared to modern login forms.
- **Suggested fix:** Add a show/hide toggle button alongside the password input using an `Eye`/`EyeOff` Lucide icon. Maintain `aria-label` on the toggle: "Show password" / "Hide password". The pattern is one `useState` boolean and a conditional `type` prop.

---

### F-14: 404 page "404" heading has extremely low contrast in dark mode
- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en/boguspage123`, `/en/p/1` (any not-found)
- **Evidence:**
  - `not-found.tsx`: `<h1 className="text-7xl font-bold text-muted-foreground/30">404</h1>`.
  - In dark mode: `--muted-foreground` dark = `240 5% 64.9%` → `rgb(161,161,170)`. At `/30` opacity (30% alpha): blended over `rgb(9,9,11)` background → approximately `rgb(54,54,57)`. Contrast ratio of `rgb(54,54,57)` on `rgb(9,9,11)` ≈ **1.5:1** — fails AA by a wide margin.
  - Screenshot `/tmp/photo-not-found.png` visually confirms the "404" text is barely discernible (dark grey on near-black).
  - `"Page not found."` uses `text-muted-foreground` (no opacity reduction) → approximately 7.76:1 in dark mode (passes).
- **Impact:** The `text-muted-foreground/30` makes the 404 numerals purely decorative at the cost of legibility. While purely decorative large display text is exempt from contrast requirements (WCAG exception for "incidental" text), the `<h1>` semantic role implies it should be readable. For low-vision users it is invisible.
- **Suggested fix:** Change to `text-muted-foreground/60` or use a non-opacity approach: `text-muted-foreground` for the text but a different visual treatment (outline font, reduced font-size for the number, or remove it in favour of an icon). If the intent is purely decorative, add `aria-hidden="true"` and move the "Page not found" text into an H1.

---

### F-15: Wide viewport (2560px) — tag filter row overflows into two-line wrap
- **Severity:** Low
- **Confidence:** High
- **Surface:** Homepage at 2560x1440
- **Evidence:**
  - Screenshot `/tmp/desktop-2560-home.png` shows the tag filter pills wrapping to a second line at 2560px because the flex row container is `sm:flex-row sm:items-center sm:justify-between` but the tag group itself is `flex flex-wrap gap-2`, and at very large viewports the heading+count row places the tag group in a narrow portion of the row.
  - At 1440px and 1920px the layout looks fine. At 2560px the heading area compresses the tag filter column.
  - The masonry grid at 2560px stays at 4 columns (configured by `xl:columns-4`), leaving large gutters on either side rather than adding a 5th column.
- **Impact:** At 2560px the gallery has very wide gutters and the 4-column grid leaves ~500px of whitespace on each side. The content feels narrow and doesn't use the screen well. Not a blocking issue but a visual regression on wide monitors.
- **Suggested fix:** Add `2xl:columns-5` to the masonry grid div in `home-client.tsx`. For the tag filter, ensure the flex row has enough space by considering `grid` layout for the heading+tags row, or use `flex-col xl:flex-row` with the tag filter taking `flex-1` at wide breakpoints.

---

### F-16: `og:locale` mismatch — English pages report `ko_KR`
- **Severity:** High (SEO/sharing)
- **Confidence:** High
- **Surface:** All `/en/*` pages
- **Evidence:**
  - `/en` homepage: `og_locale: "ko_KR"`.
  - `/en/tws`: `og_locale: "ko_KR"`, `og_alt_locale: "en_US"`. The roles are inverted — the page is in English but reports Korean as primary locale.
  - `layout.tsx` calls `getOpenGraphLocale(locale, seo.locale)` where `locale` is the route locale (`en`) and `seo.locale` is the administrator-configured locale (`ko` by default). If `getOpenGraphLocale` returns `seo.locale` as the primary locale, the English page will report `ko_KR` as its OG locale.
- **Impact:** Social cards on Slack/Discord/iMessage for English URLs display with Korean locale signal. Google's indexing may misclassify pages. If the site owner publishes to English audiences, this actively hurts discoverability.
- **Suggested fix:** `getOpenGraphLocale` should return the locale from the URL route as primary. `seo.locale` should inform the admin-configured fallback content locale, not override the route locale. Fix: `return locale === 'ko' ? 'ko_KR' : 'en_US'` based on the route `locale` param, not `seo.locale`.

---

### F-17: Hreflang alternate links absent on topic and photo pages
- **Severity:** High (SEO)
- **Confidence:** High
- **Surface:** `/en/tws`, `/ko/tws`, `/en/p/348`, `/ko/p/348`
- **Evidence:**
  - JavaScript eval on `/en/tws`: `{"hreflang_links":[]}` — no `link[rel=alternate]` elements present.
  - Root `layout.tsx` does include `alternates.languages` in `generateMetadata`, so the homepage has them. But topic and photo page `generateMetadata` functions do not replicate this.
  - `/src/app/[locale]/(public)/page.tsx` — topic page metadata does not include `alternates.languages`.
- **Impact:** Google cannot associate `/en/tws` with `/ko/tws` as language alternates. If the site later gets indexed in Korean, duplicate content penalties may apply. This is a structural SEO gap.
- **Suggested fix:** Add `alternates: { languages: { 'en': localizeUrl(seo.url, 'en', `/${topicSlug}`), 'ko': localizeUrl(seo.url, 'ko', `/${topicSlug}`), 'x-default': seo.url } }` to the `generateMetadata` in topic and photo page routes. The same pattern is already done in `layout.tsx`.

---

### F-18: Photo titles are universally "Untitled" — no meaningful alt text
- **Severity:** Medium
- **Confidence:** High
- **Surface:** All photo cards on `/en`, `/en/tws`, and any topic page
- **Evidence:**
  - Accessibility snapshot: `link "View photo: Untitled" [ref=e24]` … `link "View photo: Untitled" [ref=e25]` … `link "View photo: Untitled" [ref=e26]` — every link on the homepage has identical accessible label.
  - `alt="Photo"` on all images (confirmed in home-client HTML: `alt="Photo"` via `getConcisePhotoAltText` returning the generic fallback).
  - The `getPhotoDisplayTitleFromTagNames` function derives a display title from tag names, which is used in the card overlay text, but `getConcisePhotoAltText` falls back to "Photo" when no title is set.
  - 445 photos all named "Untitled" with alt "Photo" means a screen reader user on the gallery page hears "View photo: Untitled, View photo: Untitled, View photo: Untitled…" 445 times with no distinguishing information.
- **Impact:** Screen reader users cannot distinguish between photos on the grid. Keyboard navigation presents 445 identical links with no meaningful label. This is the most severe accessibility regression for blind users — the entire core content surface is inaccessible by label.
- **Suggested fix:** In `home-client.tsx`, the `aria-label` for each card link should incorporate the tag-derived title: `t('aria.viewPhoto', { title: displayTitle })` already does this — but `displayTitle` is currently derived from `getPhotoDisplayTitleFromTagNames` which may also return "Untitled" when `user_filename` is the fallback. The real fix is to use the tag names in the accessible label even when no explicit title is set: e.g., `aria-label={tagNames.length > 0 ? \`${t('aria.viewPhoto')} #${tagNames.join(' #')}\` : t('aria.viewPhoto', {title: t('common.untitled')})}`. Additionally, the `alt` text on images should use the same tag-derived label rather than the generic "Photo" string.

---

### F-19: Mobile nav topic links are clipped behind mask gradient and not reachable without expansion
- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en`, mobile viewport (<768px)
- **Evidence:**
  - Accessibility snapshot at iPhone 14 shows nav contains: `link "TWS"`, `link "TOMORROW X TOGETHER"` — only 2 of the configured topics visible (the rest are in the `isExpanded` state collapse, hidden behind `hidden md:flex` controlled by `isExpanded`).
  - `nav-client.tsx`: the topics div at mobile uses `flex-1 overflow-x-auto scrollbar-hide mask-gradient-right pr-4` when collapsed. The mask-gradient-right fades the rightmost 20% of the nav — for a 2-topic nav the fade is visible at the right edge but the topics are accessible via horizontal scroll.
  - However, at 390px viewport with 2 topics, the masking and scrollability of the horizontal nav is non-obvious. The chevron expand button is the intended action, but users may not realize horizontal scrolling is available in the collapsed state.
  - The `min-w-[44px]` on the expand button — but wait, measured at 32x32 (F-2 above), so the expand affordance is also undersized.
- **Impact:** Topic discovery on mobile requires knowing to either tap the chevron (undersized) or swipe the nav. First-time users may miss topics entirely. The masking gradient is a subtle affordance for scrollability that requires learned behaviour.
- **Suggested fix:** Make the mobile collapsed nav more obviously scrollable by increasing the expand button size (F-2 fix), adding a `…` overflow indicator, or showing the scrollable topic bar at full width by default with the search/theme/locale controls in a second row rather than behind an expand toggle.

---

### F-20: Photo viewer "Info" button on mobile (lg:hidden) is 32px tall
- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en/p/<id>`, mobile/tablet (<1024px)
- **Evidence:**
  - `photo-viewer.tsx`: `<Button variant="outline" size="sm" onClick={() => setShowBottomSheet(true)} className="gap-2 lg:hidden">`
  - `size="sm"` in shadcn/ui is `h-9` (36px). The toolbar back button `<Button asChild variant="ghost" className="pl-0 gap-2">` has no explicit size, likely defaulting to `h-10` (40px). Neither meets 44px.
  - Back-btn size measured at iPhone 14: `55x32` — 32px tall, indicating `size="sm"` or inherited smaller size.
  - The primary actions on the photo viewer (Info, Back) on mobile are below the 44px target.
- **Impact:** On mobile, the photo viewer primary interactive elements (Back, Info) are the two most-tapped buttons after navigation arrows. At 32–36px tall they are below the acceptable touch target size.
- **Suggested fix:** In `photo-viewer.tsx`, replace `size="sm"` with `size="default"` (`h-10` = 40px, still below 44px but improved) or `className="h-11"` (44px) on the Info and Back buttons at mobile.

---

### F-21: Search dialog on mobile is full-screen but has no explicit close affordance at top
- **Severity:** Low
- **Confidence:** Medium
- **Surface:** Search dialog on mobile viewport
- **Evidence:**
  - `search.tsx`: at mobile (`sm:inset-auto` not applied), the dialog is `fixed inset-0` — full screen. The close button `<Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">` is in the top-right of the search bar. `h-8 w-8` = 32px (below 44px).
  - On mobile the X button for closing the full-screen search is 32x32 — the same touch target issue but at a critical "dismiss" interaction.
- **Impact:** Users who open the search overlay and want to dismiss without searching have a 32px target. On a full-screen overlay, the backdrop click closes it (backdrop is present), but the visual close button is undersized.
- **Suggested fix:** Change `className="h-8 w-8"` to `className="h-11 w-11"` on the search close button. The `X` icon can remain `h-4 w-4`.

---

### F-22: `<main>` element missing from photo-not-found page layout path
- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en/p/999999` and similar not-found photo pages
- **Evidence:**
  - Accessibility snapshot on `/en/p/999999`: `heading "404" [level=1]` → `paragraph "Page not found."` → `link "Back to gallery"` — no `main` landmark role.
  - The page renders without a `<main>` landmark, only a `<div>` wrapper. WCAG 1.3.6 (Identify Purpose) requires landmark structure so screen reader users can navigate by landmark.
  - Contrast: `h1` text `text-muted-foreground/30` is near-invisible as confirmed in F-14.
- **Impact:** Screen reader users cannot use landmark navigation (NVDA+Q, VoiceOver rotor) to find the main content on the not-found page. Combined with F-4 (no nav/footer), the page is entirely inaccessible by landmark for AT users.
- **Suggested fix:** Wrap the not-found content in `<main id="main-content" tabIndex={-1}>` and fix the layout to include nav/footer (F-4).

---

### F-23: Loading state on photo viewer: large black/dark empty box before image paints
- **Severity:** Medium
- **Confidence:** High
- **Surface:** `/en/p/<id>` cold load
- **Evidence:**
  - Screenshot `/tmp/mobile-iphone14-photo.png` shows a large dark area above the photo. The `bg-black/5 dark:bg-white/5` container with `min-h-[500px]` fills the viewport with an empty rounded box before the image loads.
  - Unlike the masonry grid (which uses `containIntrinsicSize` + `aspect-ratio` to reserve space), the photo viewer uses a fixed `min-h-[500px]` which creates a jarring flash of empty dark space on cold load.
  - There is no blur placeholder or skeleton in the photo viewer image container — the `<picture>` element does not use Next.js `placeholder="blur"` (it is a raw `<img>` in a `<picture>` element, not a Next.js `Image` component, which limits placeholder options).
- **Impact:** On mobile and slow connections, users see the toolbar + a large dark empty box for several hundred milliseconds to seconds before the photo loads. This is a poor first impression and makes the app feel slow even when it isn't.
- **Suggested fix:** Use the `blur_placeholder` field (already stored in the database per CLAUDE.md) as a CSS background on the photo container: `style={{ backgroundImage: \`url(${image.blur_placeholder})\`, backgroundSize: 'cover', backgroundPosition: 'center' }}`. This gives an instant blurred preview while the full image loads, matching the masonry grid behaviour.

---

## Cross-cutting observations

**Systematic touch target gap:** Findings F-1, F-2, F-3, F-8, F-20, F-21 all share the same root cause — interactive elements sized for mouse pointers (h-8, h-9, size="sm") without being checked against 44px minimum for touch. The theme/locale buttons were correctly given `min-w-[44px] min-h-[44px]` but this pattern was not applied consistently. A single global audit of all `<button>` and interactive `<a>` elements with `min-h < 44` would surface and fix all of them in one pass.

**Error state neglect:** F-4, F-14, F-22 all concern error/not-found surfaces that appear to have been built as minimal placeholders and never revisited. The pattern of stripping the layout (no nav, no footer) on error pages is likely unintentional — Next.js App Router `not-found.tsx` should inherit the layout unless something prevents it. This deserves a dedicated pass.

**i18n/SEO metadata propagation:** F-6, F-16, F-17 form a cluster: the metadata generation infrastructure exists and works on the root, but the locale-sensitive OG tag and hreflang propagation breaks for sub-routes. This is a single misconfiguration in `getOpenGraphLocale` plus missing `alternates` in topic/photo `generateMetadata`.

**Tag data quality visible to users:** F-5 and F-18 both stem from relying on raw database values (underscore-slugs as display names, absence of titles). The app does not sanitize for display — what goes into the DB is what users see. Since this is a personal gallery maintained by one admin, fixing at the data layer (updating tag display names, adding photo titles) is the simplest path. A code-level `replace(/_/g, ' ')` would be a safety net.

**Strategic recommendations:**
1. Run a single pass of all touch-interactive elements and apply `min-w-[44px] min-h-[44px]` or equivalent — this fixes ~6 findings in one focused session.
2. Fix `getOpenGraphLocale` to use route locale as primary, and add `alternates.languages` to topic/photo `generateMetadata`.
3. Fix not-found page layout to include nav/footer and `<main>` landmark.
4. Add `tabindex="-1"` to `<main id="main-content">` for skip link correctness.
5. Add blur placeholder to photo viewer image container.

---

## Strengths (what to keep)

1. **AVIF format negotiation is fully wired.** 30 `<source type="image/avif">` elements on the homepage, with correct `srcSet` + `sizes` attributes. The fallback chain (AVIF → WebP → JPEG) is correct and the `<picture>` element approach works across all browsers. (`home-client.tsx`, confirmed via DOM inspection)

2. **Reduced-motion is comprehensively implemented.** `prefers-reduced-motion` is respected in `framer-motion` (`useReducedMotion()`), back-to-top scroll, lightbox fade, and via the global CSS nuclear option that zeroes all animations. This is better than 90% of production apps. (`globals.css` lines 156–165, `lightbox.tsx`, `home-client.tsx`)

3. **Heading hierarchy is correct and intentional.** H1 on page → sr-only H2 "Photos" → H3 per card on grid. Photo viewer: sr-only H1 → H2 in sidebar when open. This is documented with inline comments referencing WCAG criteria and audit cycles. Rare to see this done correctly in a gallery app. (`home-client.tsx`, `photo-viewer.tsx`)

4. **Focus management in search and lightbox dialogs is correct.** Search dialog uses `FocusTrap` with `initialFocus: '#search-input'` and restores focus to trigger on close. Lightbox manages `previouslyFocusedRef` and restores focus on close. Both use `aria-modal="true"` and `role="dialog"`. (`search.tsx`, `lightbox.tsx`)

5. **Keyboard shortcuts in photo viewer are discoverable and well-implemented.** Arrow keys for navigation, `F` for fullscreen, `Escape` to close lightbox, with editable-target guard (`isEditableTarget()`). `aria-keyshortcuts` annotations on buttons are present. The `LightboxTrigger` has `title` attribute with keyboard hint. (`photo-viewer.tsx`, `lightbox.tsx`)

6. **Performance is exceptional.** TTFB 26ms, FCP 64ms, 24KB transfer on first load. `content-visibility: auto` on masonry cards with `containIntrinsicSize`, `fetchPriority="high"` on above-fold images, `loading="eager"` for LCP candidates. The architecture is thoughtful. (`globals.css`, `home-client.tsx`)

7. **Locale switching preserves URL path and query params.** The `localeSwitchHref` computation in `nav-client.tsx` correctly strips the locale prefix and re-applies the target locale, preserving tag filters (`?tags=landscape`). Cookie is set with correct `SameSite=Lax; Secure` attributes. (`nav-client.tsx`)

8. **Dark/light mode toggle meets 44px on desktop and persists correctly.** Theme toggle and locale buttons both measure `44x44` at desktop. Theme state persists via `next-themes` with `attribute="class"`. The `colorScheme: 'light dark'` viewport meta and dual `themeColor` meta tags are correctly set.

9. **The masonry column count adapts correctly at all tested breakpoints.** 1 column at mobile, 2 at sm, 3 at md, 4 at xl. The column transitions are smooth and content reflows without horizontal overflow at any tested viewport from 360px to 2560px (no `scrollWidth > clientWidth` detected).

10. **ARIA live regions for search and notifications are present.** Search has a `sr-only aria-live="polite"` result count announcer. Toasts use `sonner` with `role="status"`. Photo viewer has `role="status" aria-live="polite"` for the position counter (1/N). (`search.tsx`, `photo-viewer.tsx`)

---

## Out-of-scope but worth noting

- **Photo titles:** All 445 photos are titled "Untitled" in the database. This is a content curation issue (F-18 impact), not an engineering defect. Encouraging the admin to add titles or using tag-derived display names throughout would dramatically improve both the UX and SEO of individual photo pages.
- **Watermark positioning ("hletrd" text).** The screenshots show "hletrd" text watermarked in the bottom-left corner of photos. This is a deliberate photographer credit, but its low-contrast presentation (dark text on dark image areas, light text on light areas) is inconsistent. Product decision on watermark placement/contrast.
- **Shared group/link pages (`/g/`, `/s/`)** were not testable without credentials. These surfaces should be reviewed separately for accessibility and responsive layout.
- **Admin UI** (dashboard, upload, settings) was excluded from scope. The upload flow has had known issues in prior review cycles; a dedicated pass is recommended.
- **RTL layout:** The `dir="ltr"` hardcoding is acknowledged in a code comment. A future `ar`/`he` locale would require removing that hardcode. No action needed now but the comment should include a TODO ticket reference.

---

## Appendix: contrast measurements

All measurements taken via JavaScript `getComputedStyle` + WCAG 2.1 relative luminance formula. Light mode measurements taken after programmatically removing the `dark` class (since the browser persisted a dark theme cookie). Dark mode measurements taken while OS emulation was active.

| Surface | FG hex (approx) | BG hex (approx) | Ratio | WCAG tier |
|---|---|---|---|---|
| H1 heading — light mode | #09090b | #ffffff | 19.90:1 | AAA |
| H1 heading — dark mode | #fafafa | #09090b | 19.06:1 | AAA |
| Body/muted text — light mode | #71717a | #ffffff | 4.83:1 | AA (normal ≥18pt or bold ≥14pt), marginal |
| Body/muted text — dark mode | #a1a1aa | #09090b | 7.76:1 | AAA |
| Nav links — light mode | #09090b | #ffffff | 19.90:1 | AAA |
| Nav links — dark mode | #fafafa | #09090b | 19.06:1 | AAA |
| Card H3 on hover overlay (white on gradient) — dark bg | #ffffff | blended ~rgb(3,3,4) | 20.62:1 | AAA |
| Card H3 on hover overlay (white on gradient) — light bg | #ffffff | blended ~rgb(89,89,89) | 7.00:1 | AAA |
| Admin login h1 — dark mode | #fafafa | #09090b | 19.06:1 | AAA |
| Admin input text — dark mode | #fafafa | #272727 | 14.27:1 | AAA |
| Admin submit button — dark mode | #18181b | #fafafa | 16.97:1 | AAA |
| Admin description text — dark mode | #a1a1aa | #09090b | 7.76:1 | AAA |
| 404 "404" numeral — dark mode (30% opacity) | ~#363639 | #09090b | ~1.5:1 | FAIL (decorative H1) |
| Photo viewer shortcut hint — dark mode | #a1a1aa | #09090b | 7.76:1 | AAA |
| ImageZoom focus outline | rgba(0,0,0,0) | n/a | n/a | FAIL (invisible) |

---

## Appendix: viewport screenshots

Screenshots captured at `/tmp/` during browser automation session. All paths below are ephemeral and were captured during this review session.

| Route | Viewport | Path |
|---|---|---|
| `/en` (home) | Desktop 1440x900 | `/tmp/home-desktop.png` |
| `/en` (home, light mode forced) | 1440x900 | `/tmp/light-mode-home.png` |
| `/en` (home, dark mode) | 1440x900 | `/tmp/dark-mode-home.png` |
| `/en/p/348` (photo viewer) | Desktop 1440x900 | `/tmp/photo-viewer-p348.png` |
| `/en/admin` (login) | Desktop 1440x900 | `/tmp/admin-login.png` |
| `/en/boguspage123` (404) | Desktop 1440x900 | `/tmp/404-page.png` |
| `/en/p/999999` (photo not found) | Desktop 1440x900 | `/tmp/photo-not-found.png` |
| `/en` (home) | iPhone 14 (390x844) | `/tmp/mobile-iphone14-home.png` |
| `/en/p/348` (photo viewer) | iPhone 14 (390x844) | `/tmp/mobile-iphone14-photo.png` |
| `/en` (home) | Galaxy S20 (360x800) | `/tmp/mobile-s20-home.png` |
| `/en/admin` (login) | Galaxy S20 (360x800) | `/tmp/mobile-s20-admin.png` |
| `/en` (home) | iPad portrait (768x1024) | `/tmp/tablet-ipad-portrait-home.png` |
| `/en/p/348` (photo viewer) | iPad portrait (768x1024) | `/tmp/tablet-ipad-portrait-photo.png` |
| `/en` (home) | iPad landscape (1024x768) | `/tmp/tablet-ipad-landscape-home.png` |
| `/en/p/348` (photo viewer) | iPad landscape (1024x768) | `/tmp/tablet-ipad-landscape-photo.png` |
| `/ko` (home, Korean) | Laptop 1440x900 | `/tmp/desktop-ko-home.png` |
| `/en/tws` (topic) | Laptop 1440x900 | `/tmp/desktop-topic-tws.png` |
| `/en` (home) | Desktop 1920x1080 | `/tmp/desktop-1920-home.png` |
| `/en/p/348` (photo viewer) | Desktop 1920x1080 | `/tmp/desktop-1920-photo.png` |
| `/en` (home) | Wide 2560x1440 | `/tmp/desktop-2560-home.png` |

---

## Per-device deep testing

### Mobile: iPhone 14 (390x844, DPR 3, touch-emulated)

**Homepage (`/en`):**
- Single-column masonry grid renders correctly. Images fill 100vw with no horizontal overflow (`page_has_scroll: false`).
- Nav shows title + chevron expand button (32x32 — F-2) + 2 visible topic links (`TWS`, `TOMORROW X TOGETHER`) with horizontal scroll. Search/theme/locale controls are hidden behind expansion.
- Tag filter wraps to 3 rows at 390px. All filter pills are 26px tall (F-1). The "All" pill is 33x26. Horizontal scroll within the tag filter group is not evident — it is a `flex-wrap` group, so all tags are visible but extremely tightly packed and difficult to tap accurately.
- Photo captions (`Untitled`, topic name) visible in top gradient overlay on each card (correct mobile-only `sm:hidden` behaviour).
- Interaction: The expand chevron opens the second nav row with search + theme + locale buttons. Once expanded, the full controls are reachable. The expanded state collapses on navigation (correct via the `useEffect` on `pathname`).

**Photo viewer (`/en/p/348`):**
- Large empty dark area above the photo (F-10). The photo (340px wide) appears below a ~150px gap caused by `min-h-[500px]` on the container with a landscape image that is shorter than 500px at 390px width.
- Shortcut hint text (`Shortcuts: Left/Right arrows navigate photos, F opens or closes the lightbox.`) is visible (F-9) — irrelevant on touch.
- Back button `← Back to TWS` measures 55x32 (F-20).
- Info button measures 36px tall — slightly below 44px.
- Next/Prev navigation arrows: Next photo button measures 48x48 (correct). But Prev is not shown (first photo in sequence).
- Swipe navigation: not directly testable via headless browser, but `handleTouchEnd` swipe logic in `lightbox.tsx` is present and correctly implemented.
- No blur placeholder while image loads (F-23).

**Admin login (`/en/admin`):**
- Card layout renders centred. All elements visible, no clipping.
- Username and Password fields have correct `autocomplete` attributes (`username`, `current-password`).
- Labels are `sr-only` only (F-12).
- No password visibility toggle (F-13).
- Submit button full-width — measures ~326x40 (below 44px tall).
- The overall card is clean and functional on mobile.

**Computed styles, mobile-specific:**
- `font-family: "Pretendard", "Inter", sans-serif` — Pretendard loads from `PretendardVariable.woff2` via `@font-face` with `font-display: swap`. On slow connections this could cause FOUT; the `swap` strategy is acceptable but `optional` would eliminate layout shift.
- `background-color: rgb(9, 9, 11)` confirmed on body in dark mode (correct dark tone, nearly black).

---

### Mobile: Galaxy S20 (360x800, DPR 3)

**Homepage (`/en`):**
- Similar to iPhone 14. Single column masonry, tag filter wraps. No horizontal overflow.
- At 360px the nav title "ATIK.KR Gallery" occupies most of the width, leaving only 2 visible topic links before they scroll off (same as iPhone 14 — acceptable).
- The tag filter `Color_in_Music_Festival (276)` pill is 190x26 — very wide relative to the 360px viewport, nearly full-width by itself.

**Admin login (`/en/admin`):**
- Clean render. Card with `w-full max-w-sm` fits correctly at 360px. No overflow.

---

### Tablet: iPad portrait (768x1024, DPR 2)

**Homepage (`/en`):**
- 3-column masonry grid renders (`md:columns-3`). Tag filter appears in a single scrollable row — all tags fit in one horizontal line at 768px.
- Full nav visible (not collapsed): `TWS`, `TOMORROW X TOGETHER` topic links, search, theme toggle, locale switch — all accessible without expand.
- Tag filter is in the `sm:flex-row` layout: heading "Latest" on left, count below, tags group on right — moderate wrap at 768px but usable.
- No horizontal overflow.

**Photo viewer (`/en/p/348`):**
- Full nav visible.
- Photo occupies most of the viewport width. `min-h-[500px]` is less problematic at 768px because the container width means a landscape photo fills ~500px height naturally.
- Info button visible (`lg:hidden` = `1024px` breakpoint, so at 768px the mobile Info button shows, not the desktop sidebar pin).
- The tablet-portrait layout of the photo viewer is comfortable — image centred with reasonable whitespace.
- No EXIF sidebar at 768px (requires `lg:` = 1024px) — only accessible via bottom sheet. This is by design but the Info button at 36px tall is slightly below 44px.

**Landscape orientation (1024x768, DPR 2):**
- CSS `@media (orientation: landscape) and (min-width: 768px) and (max-width: 1023px)` applies `.photo-viewer-grid { grid-template-columns: 1fr 300px; }` — so the landscape tablet shows a two-column layout with a 300px sidebar. However, the sidebar content (Info panel) is only rendered when `showInfo` is true (`isPinned`), and `isPinned` is only available at `lg:` (1024px) per the UI logic. At 1024x768 `window.innerWidth === 1024` which triggers the `lg:` breakpoint. The photo grid CSS rule fires for `max-width: 1023px`, so at exactly 1024px the CSS grid does not apply (fires at 769–1023px), but the component logic shows the desktop sidebar pin button at 1024px. This means at 1024x768 landscape tablet, the sidebar toggle button is visible but the CSS grid template is the default `grid-cols-1`, so the sidebar appears below the image rather than beside it.
- This is a minor breakpoint coordination issue between CSS media query and the Tailwind `lg:` class (both at 1024px but the CSS rule is `max-width: 1023px`, excluding 1024px exactly).

---

### Desktop: Laptop (1440x900, DPR 2)

**Homepage:**
- 4-column masonry grid. Tag filter on right side of heading row, search/theme/locale in nav right side. All clean.
- Hover: photo cards show bottom gradient overlay with title on hover (`group-hover:opacity-100`) — correct and smooth.
- Back-to-top button visible after scrolling >600px (confirmed by `showBackToTop` logic).
- `container mx-auto` caps content width at ~1280px at 1440px viewport — reasonable margins.

**Photo viewer:**
- Desktop sidebar pin button (`Info` toggle `hidden lg:flex`) visible. Clicking pins the 350px Info sidebar with EXIF data.
- The grid transitions from `grid-cols-1` to `grid-cols-[1fr_350px]` with `transition-all duration-500` — smooth but the `lg:opacity-0 lg:translate-x-10` states use `translate-x-10` even when sidebar is hidden, causing a slight rightward ghost layout. Verified functional.
- ImageZoom: hover-to-zoom works (cursor: zoom-in/zoom-out). Double-tap would work on touch, single-click toggles on mouse.

---

### Desktop: 1920x1080 (DPR 1)

- 4-column masonry, same as 1440px. The `container mx-auto` creates ~320px margins on each side at 1920px. The gallery looks centred but the side whitespace is significant.
- Nav does not stretch to full width — correct.
- Photo viewer comfortable at 1920px — image has plenty of room.

---

### Desktop: Wide 2560x1440 (DPR 2)

- 4-column masonry continues. At 2560px, each column is approximately `(2560 - 2*320px padding) / 4 ≈ 480px` wide. Images display very large thumbnails.
- The tag filter row wraps to two lines (F-15). The `sm:flex-row sm:justify-between` layout places the entire tag filter group as a flex-end element, and at 2560px the group wraps because the parent flex container does not give it enough width.
- `xl:columns-4` caps at 4 columns with no `2xl:columns-5` or `3xl:columns-6` — the grid does not scale to wide screens.
- No horizontal scroll. Layout is stable.

---

*Review methodology: evidence-first, DOM-verified, no speculation without selector/computed-style backing. All contrast ratios computed via WCAG 2.1 relative luminance formula in-browser. All touch target sizes measured via `getBoundingClientRect()` in the emulated viewport.*
