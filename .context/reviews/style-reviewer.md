# Style Reviewer Report — Cycle 1

## Scope, inventory, and verification

**Role:** style, consistency, copy, i18n, theming, Tailwind/design-system, CSS architecture, component API, and UX polish review.

**Constraint followed:** I did not edit application code. This file is the only intended change.

**Relevant style/UI/copy/i18n inventory examined:**

- **Design/config/theme:** `apps/web/components.json`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/src/app/[locale]/globals.css`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`.
- **Copy/i18n/locale helpers:** `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/i18n/request.ts`, `apps/web/src/lib/constants.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/photo-title.ts`, `apps/web/src/lib/tag-records.ts`, `apps/web/src/lib/utils.ts`.
- **App shell and route UI:** every `*.tsx` under `apps/web/src/app/**`, including localized public pages, admin pages, loading/error/not-found shells, `global-error.tsx`, icons, manifest-adjacent UI, and the OG image route.
- **Components:** every `*.tsx` under `apps/web/src/components/**`, including public gallery components, viewer/lightbox/bottom-sheet controls, admin managers, upload/search/tag components, and all `components/ui/*` primitives.
- **Style/UX guard tests:** `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/e2e/nav-visual-check.spec.ts`, `apps/web/e2e/public.spec.ts`, `apps/web/e2e/admin.spec.ts`.

**Verification run:** `npm run test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts` — passed, 1 file / 8 tests.

## Findings

### 1. [Medium] Filtered page metadata and OG cards show raw tag slugs instead of the display tag labels

- **Status:** confirmed
- **Confidence:** High
- **Files / regions:**
  - `apps/web/src/app/[locale]/(public)/page.tsx:37-43`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:67-73`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:79-86`
  - `apps/web/src/app/api/og/route.tsx:80-86,182-195`
  - Contrast: `apps/web/src/components/home-client.tsx:138-146`, `apps/web/src/lib/photo-title.ts:28-30`, `apps/web/src/lib/tag-records.ts:5-12`

**Issue:** The visible UI maps selected tag slugs back to tag names and passes them through `humanizeTagLabel`, but metadata uses `tagSlugs` directly. The generated topic OG image also receives `tags=tagSlugs.join(',')`, and `/api/og` renders those incoming values as `#{tag}`. Because `getTagSlug()` lowercases and converts spaces/underscores to hyphens, SEO titles/descriptions/social cards can expose strings such as `#music-festival` while the page chip/card text shows the friendlier tag label.

**User failure scenario:** A Korean user filters a topic by a tag named “Music Festival” and shares the URL. The page UI presents the tag naturally, but the browser title, meta description, and social preview show `#music-festival` / `music-festival`, making the shared card look machine-generated and less localized.

**Suggested fix:** Derive `tagLabels` from `allTags.find(t => t.slug === slug)?.name`, apply `humanizeTagLabel` as fallback, and use those labels in metadata and OG alt text. For the generated OG image, either pass display names in a separate query parameter or let the OG route resolve slugs to tag records before rendering.

---

### 2. [Medium] The design-system defaults still encode sub-44px interactive targets

- **Status:** confirmed
- **Confidence:** High
- **Files / regions:**
  - `apps/web/src/components/ui/button.tsx:23-29`
  - `apps/web/src/components/ui/input.tsx:10-13`
  - `apps/web/src/components/ui/select.tsx:27-40`
  - `apps/web/src/components/ui/switch.tsx:13-24`
  - `apps/web/src/__tests__/touch-target-audit.test.ts:81-191,193-261`
  - Example consumers: `apps/web/src/components/image-manager.tsx:287-333,461-467`, `apps/web/src/components/admin-user-manager.tsx:91-96,153-161`, `apps/web/src/components/admin-header.tsx:21-25`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:76-84`

**Issue:** The primitive APIs default to compact controls: `Button` default is `h-9`, `sm` is `h-8`, `lg` is `h-10`, icon sizes are `size-8` through `size-10`; `Input` is `h-9`; `SelectTrigger` is `h-9` / `h-8`; `Switch` is `h-6 w-11`. The audit documents many historical exemptions rather than eliminating the design-system source. That means future components inherit undersized touch targets unless every caller remembers to override them.

**User failure scenario:** An admin opens the dashboard on a tablet or phone and repeatedly misses edit/delete/logout/share controls because several controls render at 32-40px. A later contributor also adds a new default `Button` without an override, sees the audit exemptions nearby, and assumes the compact sizing is acceptable.

**Suggested fix:** Add an explicit touch-safe sizing tier (`default`/`touch` at `h-11 min-w-11`) and make compact sizes opt-in (`compact-sm`, `desktop-sm`, or similar). Then migrate primary and admin controls to the touch-safe tier, keeping the audit as a regression guard with fewer documented exceptions. If admin remains desktop-only, document that product decision in the component API and admin layout rather than relying on repeated exemptions.

---

### 3. [Medium] Custom public/admin controls bypass the touch-target guard with tiny hit areas

- **Status:** confirmed
- **Confidence:** High
- **Files / selectors / regions:**
  - `apps/web/src/components/tag-input.tsx:169-176` (`button.min-h-6.min-w-6` remove chip)
  - `apps/web/src/components/tag-input.tsx:219-240` (`role="option"` rows with `py-1.5`)
  - `apps/web/src/components/info-bottom-sheet.tsx:181-203` (drag-handle button)
  - `apps/web/src/components/info-bottom-sheet.tsx:207-214` (`button.p-2` close control)
  - `apps/web/src/components/histogram.tsx:293-300,320-326` (`button.px-1`, `button.py-0.5`)
  - Related audit patterns: `apps/web/src/__tests__/touch-target-audit.test.ts:193-261`

**Issue:** The existing audit focuses on shadcn `Button` and literal `h-8/h-9/h-10` patterns. Several custom interactive controls still render much smaller hit areas: tag-remove buttons are 24px, suggestion rows are short, the bottom-sheet close button is roughly 32px plus icon, and histogram toggles are text-sized.

**User failure scenario:** On mobile, a user opens the photo info sheet and tries to close it with the top-right icon, but the tappable area is much smaller than the expected 44px. In admin, a tag chip remove button is easy to miss and can remove the wrong adjacent item when tags wrap.

**Suggested fix:** Keep the visible glyphs small if desired, but set the interactive box to `min-h-11 min-w-11` or equivalent. Add audit coverage for custom controls that use `min-h-6`, `min-w-6`, text-only `button` elements with only `px-*`, and icon buttons sized via padding rather than explicit dimensions.

---

### 4. [Low] The database backup guard leaks hardcoded English into localized admin copy

- **Status:** confirmed
- **Confidence:** High
- **Files / regions:**
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:33-41`
  - `apps/web/messages/en.json:14-40`
  - `apps/web/messages/ko.json:14-40`

**Issue:** The invalid-download-url path builds a toast with a localized prefix and a hardcoded English suffix: `Invalid download URL`. The `db` message namespace has localized backup/restore/export success and failure strings, but no key for this specific guard message.

**User failure scenario:** A Korean admin hits the invalid backup URL guard and sees `백업에 실패했습니다: Invalid download URL`, which mixes languages in an error toast at the exact moment the user needs clear recovery guidance.

**Suggested fix:** Add a `db.invalidDownloadUrl` key to both locale files and use `toast.error(t('invalidDownloadUrl'))` or a fully localized composite string. Avoid concatenating untranslated literals onto translated messages.

---

### 5. [Low] Loading/search/upload copy mixes ASCII `...` and Unicode ellipsis `…`

- **Status:** confirmed
- **Confidence:** High
- **Files / regions:**
  - `apps/web/messages/en.json:19,29,33,51,122,126,145,147,170,183,199,218,242,276,280,309,505,515,534`
  - `apps/web/messages/ko.json:19,29,33,51,122,126,145,147,170,183,199,218,242,276,280,309,505,515,534`

**Issue:** Some user-facing strings use three ASCII periods while nearby loading states use a single Unicode ellipsis. This appears across both locales, including DB processing, upload progress, login submission, search, common loading, photo loading, and settings save copy.

**User failure scenario:** A user moves through upload, search, and photo loading states and sees visually inconsistent punctuation. Screen readers and braille displays may also announce/present the two forms differently, creating subtle UX inconsistency.

**Suggested fix:** Pick one convention for this product, preferably the single ellipsis glyph for prose/loading states, and normalize both locale files. Add a lightweight copy lint/grep check so new strings follow the chosen convention.

---

### 6. [Low] Global CSS mixes component hooks with dead/stale selectors

- **Status:** confirmed
- **Confidence:** High
- **Files / selectors / regions:**
  - `apps/web/src/app/[locale]/globals.css:117-146`
  - `apps/web/src/app/[locale]/globals.css:148-158`
  - Usage check: `apps/web/src/components/photo-viewer.tsx:268,294,305,321,406`
  - Dead selector: `.masonry-grid` at `apps/web/src/app/[locale]/globals.css:136-138`

**Issue:** `globals.css` contains app-wide tokens/utilities plus component-specific orientation overrides for `.photo-viewer-*` and `.masonry-grid`. The `.photo-viewer-*` hooks are used, but `.masonry-grid` is not used by the current source; the public grid is built with Tailwind column classes in `home-client.tsx`, not `.masonry-grid`.

**User failure scenario:** A future maintainer changes gallery layout expecting the landscape `.masonry-grid` override to apply, but it is dead CSS. Conversely, photo-viewer layout behavior is controlled partly in component classNames and partly in a distant global media query, making responsive regressions harder to trace.

**Suggested fix:** Remove the dead `.masonry-grid` rule. Move component-specific responsive rules into component classNames or a clearly labeled `@layer components` section. Add a periodic grep/lint for unused global selectors so this file stays intentional.

---

### 7. [Low] `components.json` points shadcn tooling at a non-existent global CSS file

- **Status:** confirmed
- **Confidence:** High
- **Files / regions:**
  - `apps/web/components.json:6-10`
  - `apps/web/src/app/[locale]/layout.tsx:1-3`

**Issue:** The shadcn config says Tailwind CSS lives at `src/app/globals.css`, but the actual global stylesheet imported by the app is `src/app/[locale]/globals.css`. Tooling that reads `components.json` can write tokens/components to the wrong path or create a duplicate stylesheet.

**User failure scenario:** A developer runs a component generator or update command and it patches/creates `src/app/globals.css`. The app still imports `[locale]/globals.css`, so the generated styles do not load, or a duplicate global file later confuses reviews and theming work.

**Suggested fix:** Align `components.json` with the real stylesheet path, or move the global stylesheet to `src/app/globals.css` and import it from a stable non-locale layout if the framework setup allows it. Document the chosen path so future UI tooling does not drift again.

---

### 8. [Low] Photo-card overlay text relies on weak translucent gradients over arbitrary images

- **Status:** likely
- **Confidence:** Medium
- **Files / regions:**
  - `apps/web/src/components/home-client.tsx:255-266`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:193-200`

**Issue:** Public gallery cards place white title/topic text over image content using `from-black/65` or `from-black/60` gradients that fade to transparent. The subtitle uses `text-white/80`. Because the underlying photo content is arbitrary, bright skies/snow/studio backgrounds can reduce contrast, especially on mobile where the overlay is always at the top.

**User failure scenario:** A visitor browses a masonry page on a phone and the top of a bright image sits under the title overlay. The title and topic become hard to read, so the user cannot distinguish images without opening each one.

**Suggested fix:** Strengthen and sustain the scrim (`from-black/80 via-black/45 to-transparent` or a fixed caption backing), add a subtle text shadow, or reserve a caption area. Verify with bright-image visual fixtures in the existing public/nav visual checks.

---

### 9. [Low] Fatal global error theming only checks the hydrated `.dark` class

- **Status:** risk
- **Confidence:** Medium
- **Files / regions:**
  - `apps/web/src/app/global-error.tsx:45-63`
  - `apps/web/src/app/[locale]/layout.tsx:103-115`

**Issue:** `global-error.tsx` determines dark mode only by checking `document.documentElement.classList.contains('dark')`. The normal app tree sets theme through `ThemeProvider`, but the global error boundary can replace that tree during fatal failures. If the class is missing or not hydrated yet, the fallback shell renders as light even for users whose system preference is dark.

**User failure scenario:** A dark-mode user hits a fatal boot error before the app theme provider has applied the class. The emergency error shell flashes or stays in light mode, which looks broken and undermines trust in the recovery UI.

**Suggested fix:** Fall back to `window.matchMedia('(prefers-color-scheme: dark)')` when the class is absent, and/or inline the minimal `color-scheme` and CSS variable setup needed by the global error shell.

## Final missed-issues sweep

- Re-ran the touch-target guard; it passed, but the review above separates “test currently passes” from “design-system and custom-control defaults still encode risky compact targets.”
- Grepped for hardcoded English-like TSX strings. The remaining visible candidates were non-user-facing framework props such as `placeholder="blur"` and acceptable technical placeholders such as `en_US`; the confirmed user-facing leak is the DB toast in Finding 4.
- Grepped compact Tailwind sizing classes (`h-8/h-9/h-10`, `size-8/9/10`, `min-h-6`, `p-2`, `py-0.5`, `py-1.5`) across `src/app` and `src/components`; findings are captured in Findings 2 and 3. Decorative spinners/badges and non-interactive image placeholders were not counted as touch-target failures.
- Checked global CSS selectors against source usage; `.photo-viewer-*` hooks are used, `.masonry-grid` is stale/dead in current app source.
- Confirmed skipped files: generated/build/dependency output (`node_modules`, `.next`, coverage), binary assets/fonts/images, drizzle migrations, database/storage/security-only modules, previous review archives, and server/action files without user-facing copy or UI styling. Style-impacting helper modules (`constants`, locale pathing, gallery config, tag records, photo-title) were included.

## Counts by severity

- Critical: 0
- High: 0
- Medium: 3
- Low: 6
- Total findings: 9
