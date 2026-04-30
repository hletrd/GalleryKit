# Plan 300 — Cycle 1 UI/UX Fixes (designer review)

## Source
`.context/reviews/designer-uiux-deep.md`, HEAD 03e5b66, 23 findings.

## Strategy
- Fix order: High → Medium → Low (per finding severity tag)
- Commit grouping: by component/feature, not by finding-ID. Many findings touch the same file (e.g. multiple findings on `tag-filter.tsx`); they should land in one commit each.
- Every commit: GPG-signed (`-S`), conventional + gitmoji, references finding IDs (F-1, F-2, ...) in the body.
- After each batch of related commits: re-run the affected gate(s) (lint/typecheck for code; vitest for unit tests; playwright for e2e; build last).
- After ALL fixes land and gates pass: run `npm run deploy`.

## Findings & disposition

### F-1: Touch targets on tag filter badges are 26px tall — fail WCAG 2.5.8
- **Severity:** High / Confidence: High
- **File(s):** `apps/web/src/components/tag-filter.tsx`
- **Concrete change:** Change `min-h-[24px] py-1` to `min-h-[44px] px-3 py-2`. Bump pill `interactivePillClass` so all tag pills clear the 44 px touch-target floor.
- **Verification:** Manual playwright/agent-browser measurement at iPhone 14 viewport — every pill `getBoundingClientRect().height` ≥ 44. Vitest snapshot if any.
- **Status:** PLANNED

### F-2: Mobile nav expand toggle is 32x32
- **Severity:** High / Confidence: High
- **File(s):** `apps/web/src/components/nav-client.tsx`
- **Concrete change:** Apply `min-w-[44px] min-h-[44px] flex items-center justify-center` to the expand button (line 84 area), matching the theme/locale pattern.
- **Verification:** agent-browser at 390x844, measure expand button — height & width both ≥ 44.
- **Status:** PLANNED

### F-3: Search button is 36x36 at desktop
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/components/search.tsx`
- **Concrete change:** Replace `className="h-9 w-9"` on the trigger button with `className="h-11 w-11"` (44px). Also bump the close-X button `h-8 w-8` to `h-11 w-11` (covers F-21).
- **Verification:** Playwright check at 1440x900 — search trigger 44x44.
- **Status:** PLANNED (also covers F-21)

### F-4: 404 and photo-not-found pages have no nav or footer
- **Severity:** High / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/not-found.tsx`
- **Concrete change:** Wrap not-found content in the Nav/Footer layout. The `[locale]/not-found.tsx` triggers from anywhere under `[locale]`; since the public layout that owns Nav/Footer is `(public)/layout.tsx` (a route group), `not-found.tsx` at the locale level does not inherit that layout. Fix: include `<Nav />`, `<main id="main-content" tabIndex={-1}>`, and `<Footer />` directly in the not-found page using the same shell as the public layout.
- **Verification:** agent-browser at `/en/p/999999` — page should expose `nav`, `main`, `footer` landmarks and the topic links.
- **Status:** PLANNED (also covers F-22 since wrapping in `<main>` adds the landmark)

### F-5: Tag labels display raw slug format
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/components/tag-filter.tsx`, plus any other tag rendering surface
- **Concrete change:** Display-format tag names by replacing `_` with space at render-time. Apply to the pill rendering and to the H1 echo on `home-client.tsx` where `displayTags` are joined. The slug stays canonical for URLs.
- **Verification:** agent-browser snapshot of `/en` — pill text contains spaces, not underscores.
- **Status:** PLANNED

### F-6 and F-16: `og:locale` is `ko_KR` on `/en/*` pages
- **Severity:** High / Confidence: High
- **File(s):** `apps/web/src/lib/locale-path.ts`, `apps/web/src/__tests__/locale-path.test.ts`
- **Concrete change:** `getOpenGraphLocale` should ALWAYS return based on the route locale; the `configuredLocale` (admin SEO setting) only applies when route locale is the same as the configured one. Practically: when route locale is recognized, return its mapped OG locale; only fall back to `configuredLocale` if route locale is unsupported. Update the unit test that expected the override to win — the override should be considered "default for the site" not "override per route".
- **Verification:** Updated vitest tests pass; agent-browser eval `og:locale` at `/en/*` returns `en_US`, at `/ko/*` returns `ko_KR`.
- **Status:** PLANNED

### F-7: Skip link target `<main>` has no `tabindex="-1"`
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/(public)/layout.tsx` (and not-found shell from F-4)
- **Concrete change:** Add `tabIndex={-1}` to `<main id="main-content">`.
- **Verification:** Playwright skip-link click moves focus into main; `document.activeElement.id === 'main-content'`.
- **Status:** PLANNED

### F-8: Zoom button focus ring is invisible
- **Severity:** High (a11y) / Confidence: High
- **File(s):** `apps/web/src/components/image-zoom.tsx`
- **Concrete change:** Replace the Tailwind `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on the zoom container with explicit outline utilities that don't depend on the `--ring` variable: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400`. Drop `focus-visible:outline-none` and `focus-visible:ring-offset-background`.
- **Verification:** Tab into photo viewer; zoom container has visible outline (`outline-color != rgba(0,0,0,0)`).
- **Status:** PLANNED

### F-9: Shortcut hint text shown on mobile
- **Severity:** Low / Confidence: High
- **File(s):** `apps/web/src/components/photo-viewer.tsx`
- **Concrete change:** Add `hidden md:block` to the shortcut hint paragraph (line ~246).
- **Verification:** Playwright at iPhone 14 viewport — hint not visible.
- **Status:** PLANNED

### F-10: Photo viewer empty space on mobile portrait
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/components/photo-viewer.tsx`
- **Concrete change:** Replace fixed `min-h-[500px]` on the photo container with a responsive `min-h-[40vh] md:min-h-[500px]`. Keep the existing `max-h-[80vh]` on the inner img.
- **Verification:** Playwright at iPhone 14 — container `min-h` shrinks; image visible above the fold.
- **Status:** PLANNED

### F-11: Muted foreground contrast marginal in light mode
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/globals.css`
- **Concrete change:** Shift `--muted-foreground` in `:root` from `240 3.8% 46.1%` to `240 3.8% 40%`. Dark mode untouched.
- **Verification:** Computed style of secondary text in light mode → contrast > 6:1.
- **Status:** PLANNED

### F-12: Admin login form labels are visually hidden
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/admin/login-form.tsx`
- **Concrete change:** Replace `sr-only` labels with visible `text-sm font-medium mb-1 block` labels above each input.
- **Verification:** Playwright at `/en/admin` — visible "Username" and "Password" text above respective inputs.
- **Status:** PLANNED

### F-13: Admin login no password visibility toggle
- **Severity:** Low / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/admin/login-form.tsx`, `messages/en.json`, `messages/ko.json`
- **Concrete change:** Add Eye/EyeOff Lucide toggle button; state via `useState`, `aria-label` switches between "Show password" and "Hide password" via i18n keys.
- **Verification:** Playwright — toggle changes input `type` between `password` and `text`.
- **Status:** PLANNED

### F-14: 404 heading low contrast in dark mode
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/not-found.tsx`
- **Concrete change:** Change `text-muted-foreground/30` to `text-muted-foreground/60` and add `aria-hidden="true"` to the `<h1>404</h1>` since it is decorative; promote the "Page not found." text to a real `<h1>` for semantic correctness, with sr-only-fallback if not.
- **Verification:** Computed alpha-blended contrast of 404 numeral ≥ 3:1 in dark mode.
- **Status:** PLANNED

### F-15: Wide viewport (2560px) tag filter wraps + only 4 columns
- **Severity:** Low / Confidence: High
- **File(s):** `apps/web/src/components/home-client.tsx`
- **Concrete change:** Add `2xl:columns-5` to the masonry grid (covers wider monitors). Tag-filter wrap is acceptable behavior; address only column count.
- **Verification:** agent-browser at 2560px — masonry has 5 columns.
- **Status:** PLANNED

### F-17: Hreflang alternates absent on topic & photo pages
- **Severity:** High (SEO) / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- **Concrete change:** In `generateMetadata`, set `alternates.languages` to map `en` and `ko` URLs (and `x-default`) for the same path.
- **Verification:** Playwright eval head — `link[rel=alternate][hreflang]` count ≥ 3 on `/en/<topic>`, `/en/p/<id>`.
- **Status:** PLANNED (shared/group sub-routes are noindexed — no canonical alternates needed there. Only apply to topic and photo routes per review scope.)

### F-18: Photo titles universally "Untitled"
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/components/home-client.tsx`, `apps/web/src/lib/photo-title.ts`
- **Concrete change:** Use `getPhotoDisplayTitleFromTagNames` for the `aria-label` even when the result reads "Untitled" — i.e., when there ARE tags, weave them into both the visible label and the alt. The current `displayTitle` already hashes tag names; ensure the `aria-label` reads e.g. "View photo: #SHINYU #JIHOON". Replace underscores with spaces at the same time. Update `getConcisePhotoAltText` to also drop underscores.
- **Verification:** agent-browser snapshot of homepage — multiple `link "View photo: ..."` labels with distinct content rather than identical "Untitled".
- **Status:** PLANNED

### F-19: Mobile nav topic links clipped behind mask gradient
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/components/nav-client.tsx`
- **Concrete change:** F-2's larger expand button already improves discoverability. No additional layout change required for this cycle. Add an `aria-label` hint that the nav scrolls horizontally.
- **Status:** PLANNED (subsumed by F-2 + minor aria adjustment)

### F-20: Photo viewer "Info" / Back buttons mobile too small
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/components/photo-viewer.tsx`
- **Concrete change:** Promote `size="sm"` mobile Info button to use `className="h-11"` and apply `h-11` to the Back button as well so both clear 44 px tall on touch surfaces.
- **Verification:** Playwright at iPhone 14 — both Buttons measure ≥ 44 px tall.
- **Status:** PLANNED

### F-21: Search dialog close button 32x32
- **Severity:** Low / Confidence: Medium
- **File(s):** `apps/web/src/components/search.tsx`
- **Concrete change:** Bump close button `h-8 w-8` to `h-11 w-11`.
- **Status:** PLANNED (combined with F-3 commit)

### F-22: `<main>` element missing from photo-not-found page
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/app/[locale]/not-found.tsx`
- **Concrete change:** Wrap content in `<main id="main-content" tabIndex={-1}>`. Combined with F-4.
- **Status:** PLANNED (rolled into F-4)

### F-23: Photo viewer no blur placeholder while image loads
- **Severity:** Medium / Confidence: High
- **File(s):** `apps/web/src/components/photo-viewer.tsx`
- **Concrete change:** Use `image.blur_placeholder` (if present in the data layer) as a CSS background on the photo container. Need to confirm the field is exposed via `selectFields` for public photo queries; if not, use a transparent-checker fallback or render a generic `bg-muted` skeleton with a subtle gradient. For minimum risk this cycle, render a smaller skeleton (animate-pulse `bg-muted`) on the inner div until the image loads. We already have `min-h-[40vh]` from F-10 so this avoids layout shift.
- **Verification:** Playwright cold-load — shimmer/pulse visible briefly then image fades in.
- **Status:** PLANNED — implement as a `bg-muted animate-pulse` skeleton overlay; do not depend on `blur_placeholder` since adding it to the public select path would be a privacy review.

## Deferrals
None. F-19 partially subsumed by F-2 (larger expand button addresses primary affordance).
