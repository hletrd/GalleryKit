# Style Reviewer Deep Review — Cycle 1

## Inventory / Coverage

Reviewed the repo instructions and the review-relevant surface across the tracked repository, with emphasis on:
- Root docs and config: `README.md`, `CLAUDE.md`, `AGENTS.md`, root `package.json`
- App shell / UI / shared logic: `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/**`
- Supporting config and styling: `apps/web/src/app/[locale]/globals.css`, `apps/web/eslint.config.mjs`, `apps/web/tailwind.config.ts`, `apps/web/messages/**`
- Test surface for naming/consistency cues: `apps/web/src/__tests__/**`, `apps/web/e2e/**`

Final sweep focus areas: locale-switching consistency, shared config defaults, home-page metadata generation, search/tag input complexity, and global CSS organization.

## Findings

### 1. [Medium] The locale switcher hardcodes a two-locale flip instead of using the shared locale source of truth

**Files / regions**
- `apps/web/src/components/nav-client.tsx:45-63, 149-155`
- `apps/web/src/lib/constants.ts:1-4`

**Why this is a problem**
- `otherLocale` is derived with `locale === 'en' ? 'ko' : 'en'`, and the button label is built from the same binary assumption.
- The repo already exposes `LOCALES` and `DEFAULT_LOCALE` as the canonical locale list, but this component bypasses them.
- That makes the locale switcher the first place to drift if the locale set expands or changes order.

**Concrete failure scenario**
- A future release adds `ja` to `LOCALES` and translations.
- The navbar still toggles only between English and Korean, so the new locale is unreachable from the main shell and the cookie value can no longer reflect the supported set.
- The UI then silently advertises a locale model that no longer matches the rest of the app.

**Suggested fix**
- Build the next-locale choice from `LOCALES` rather than a hardcoded pair.
- Keep the display label in the same shared lookup so the button text and cookie value cannot diverge from the actual supported locales.

**Confidence**: High

### 2. [Medium] Default image sizes are duplicated in two formats, which makes the shared config easy to drift

**Files / regions**
- `apps/web/src/lib/gallery-config-shared.ts:38-44, 71-73`

**Why this is a problem**
- The module defines `DEFAULTS.image_sizes` as a comma-separated string and separately defines `DEFAULT_IMAGE_SIZES` as an array with the same values.
- The two representations are maintained independently even though they describe the same default configuration.
- This is a classic consistency trap: one side can change without the other, and the compiler will not catch it.

**Concrete failure scenario**
- Someone updates the array to add a new default output size for the renderer, but forgets to update the string default used by the admin settings form.
- Public pages and the admin UI then disagree about the default size set, leading to confusing previews and hard-to-trace “why is the default different here?” reports.

**Suggested fix**
- Derive one representation from the other in code, or centralize the default size list in a single constant and serialize from that source.
- Keep the shared module as the sole owner of the defaults so UI and server fall back to the same values.

**Confidence**: High

### 3. [Low] The homepage metadata builder repeats almost the same object shape in multiple branches

**Files / regions**
- `apps/web/src/app/[locale]/(public)/page.tsx:18-101`

**Why this is a problem**
- The function builds `title`/`description` once, then repeats them in two nearly identical metadata return shapes.
- The `openGraph` and `twitter` blocks are duplicated across the `seo.og_image_url` branch and the fallback-image branch.
- That makes the file harder to scan and increases the odds of one branch being updated while the other lags behind.

**Concrete failure scenario**
- A future style or SEO change adjusts the social-card dimensions, alt text, or title formatting in one branch.
- The other branch still emits the old shape, so the homepage metadata differs depending on whether a custom OG image exists.
- That inconsistency is hard to spot because the duplication hides the divergence inside a long function.

**Suggested fix**
- Extract a small helper that assembles the shared metadata payload once, then pass the branch-specific image list into it.
- Use property shorthand where possible so the file stays compact and easier to diff.

**Confidence**: High

### 4. [Low] The search overlay combines too many concerns in one component, and the result type is embedded inline

**Files / regions**
- `apps/web/src/components/search.tsx:20-33, 40-123, 142-259`

**Why this is a problem**
- The component owns debounce timing, request sequencing, keyboard shortcuts, body scroll locking, focus restoration, result rendering, and the overlay/dialog structure.
- The search-result shape is declared inline in the `useState(...)` call instead of a named interface or shared type.
- That makes the component harder to read and makes future response-shape changes easier to miss.

**Concrete failure scenario**
- A future search refactor adds a field or renames one in the action response.
- The component’s inline state type becomes the only place that knows the shape, so the edit has to be found inside a large function rather than at a named boundary.
- At the same time, any tweak to keyboard handling or focus management requires touching the same dense block, increasing the chance of regressions.

**Suggested fix**
- Extract a `SearchResult` interface and a few small helpers for topic-label formatting, request lifecycle, and overlay behavior.
- Keep the dialog rendering separate from the async/control-flow code so the component reads more like a composition of responsibilities.

**Confidence**: Medium

### 5. [Low] `globals.css` mixes layers, utilities, and component-specific rules in one flat file

**Files / regions**
- `apps/web/src/app/[locale]/globals.css:13-165`

**Why this is a problem**
- Base theme tokens, utility classes, animations, component-specific styles, and media queries are interleaved.
- The file also mixes multi-line blocks with compact one-line rules, which makes the cascade order harder to visually parse.
- Because the style layers are not grouped by concern, small future additions can accidentally win or lose in the cascade for reasons that are hard to notice in review.

**Concrete failure scenario**
- A developer adds a new utility or responsive tweak near the bottom of the file and assumes it only affects the intended selector.
- Because earlier unlayered rules and later media-query blocks share the same file, the new rule unexpectedly overrides a base variable or a utility used elsewhere.
- The bug shows up as a dark-mode or responsive regression that is painful to trace back to CSS ordering.

**Suggested fix**
- Group the stylesheet into clearly labeled sections: tokens, base rules, utilities, component helpers, responsive overrides.
- Keep the formatting style consistent within each section so a future reviewer can tell at a glance which rules are intentionally global and which are page-specific.

**Confidence**: Medium

## Final sweep

I rechecked the locale-switch logic, shared gallery defaults, homepage metadata generation, the search overlay, and the global stylesheet to ensure no style-relevant file was skipped. I did not find any additional maintainability or consistency issues that rose above the findings above.
