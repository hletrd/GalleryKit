# Critic — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

Adversarial: what's the strongest argument that any of these fixes are over-engineered, mis-scoped, or actively harmful? What did the wave miss?

**HEAD:** `8d351f5`
**Cycle:** 1/100
**Diff scope:** 11 UI/UX fix commits (`e3c1dd3..8d351f5`).

## Strongest critique of each fix

### F-1 — 44x44 tag-pill touch targets

**Critique:** The cycle 3 plan AGG3R-03 / C3R-RPL-03 set the floor at 24x24 (WCAG 2.5.8 AA) because that level was the explicit target. The new fix bumps to 44x44 (WCAG 2.5.5 AAA) with no documented policy change. This is a meaningful design shift:

1. **Vertical density loss:** A row of 8 tag pills at `min-h-[44px]` is now ~44px tall vs ~22px before. On mobile a topic with 12 tags now needs a full second row above the masonry grid. Above-the-fold photo count drops.
2. **Inconsistency with adjacent UI:** The Search dialog's *input field* (`h-8`) is now smaller than its X-close button (`h-11 w-11`).

**Verdict:** Fix is correct for AAA but the design hadn't agreed to AAA. Document the policy explicitly.

**Confidence:** Medium.

### F-4 / F-22 — not-found.tsx layout shell

**Critique:** Wires up `<Nav />` and `<Footer />` on every 404. `<Nav />` calls `getTopicsCached()` which goes to the DB. If a crawler hits 1000 nonexistent URLs, that's 1000 DB queries (each cached, but still 1000 cache lookups + cache-miss DB hits).

**Verdict:** Reasonable trade because cached paths are cheap. Worth flagging that 404 is now a heavier render for monitoring.

**Confidence:** Medium.

### F-5 — Underscore display normalization

**Critique:** The team chose to make `_` a "natural separator" in tag names. But:

1. The DB stores the slug as `color_in_music_festival` and the display `name` as the user-typed value. If a user *intentionally* types `Music_Festival_2024`, they cannot disambiguate it from `Music Festival 2024`. The transform is lossy.
2. The transform is applied in three call sites (home-client display title, home-client active-filter chip, tag-filter button label) but **not** in JSON-LD `name` (`(public)/[topic]/page.tsx:188`, `(public)/page.tsx:161`). Search-engine snippets see `#Music_Festival_2024` while the visible UI shows `#Music Festival 2024`.
3. Photo-viewer's `getPhotoDisplayTitle` (used on `/p/[id]`) does **not** call the underscore-aware path, so the photo viewer's `<h1 sr-only>` title is `IMG_0001.JPG`'s tag-derived value with raw underscores when the title falls back to tags.

**Verdict:** Move the normalization into the helper for consistency, or drop it entirely.

**Confidence:** High.

### F-6 / F-16 — `getOpenGraphLocale` route-locale precedence

**Critique:** Correct fix. But the admin "OG locale" setting is now only meaningful for unsupported route locales — undocumented contract change. The settings UI should signal this.

**Verdict:** Document later.

**Confidence:** Medium.

### F-7 — `<main tabIndex={-1}>` for skip link

**Critique:** `tabIndex={-1}` + `focus:outline-none` means a programmatically-focused `<main>` shows no visible focus indicator. The skip-link UX is fine because focus is moved silently for visual users (they expect to be at top of content). But any future code path that programmatically focuses `<main>` (e.g. error boundary recovery) will silently lose visible focus.

**Verdict:** Acceptable for skip link. Future focusing of `<main>` should override `outline-none` if needed.

**Confidence:** Medium.

### F-8 — image-zoom focus outline

**Critique:** Replacing `focus-visible:ring-*` with `focus-visible:outline-*` is fine. But the rest of the codebase (info-bottom-sheet, image-manager checkbox, Search input, upload-dropzone, scroll-area, switch, button, badge, textarea, input) **all still use `focus-visible:ring-*`**. The image-zoom is now visually inconsistent with everything else.

**Verdict:** Either roll back image-zoom to `focus-visible:ring-*` (and fix the `--ring` resolution at the source — possibly `--ring` is `0 0% 0% / 0` in some unbalanced theme path) or adopt outline-style globally. Pick one.

**Confidence:** High.

### F-9 — Hide shortcut-hint on touch devices

**Critique:** `hidden md:block` hides the keyboard hint at <768px. Bluetooth-keyboard-paired phones won't see the hint. Minor.

**Verdict:** Acceptable trade.

**Confidence:** High.

### F-10 — `min-h-[40vh] md:min-h-[500px]` photo container

**Critique:** On landscape mobile (`667 × 375`), 40vh ≈ 150px — too small. The CSS `@media (orientation: landscape) and (max-width: 767px)` has `.photo-viewer-image { max-height: 100vh }` but does not override the container's `min-h`. Container in landscape mobile is 150px tall, image clipped.

**Verdict:** Add a landscape-mobile `min-h` override.

**Confidence:** Medium.

### F-11 — `--muted-foreground: 240 3.8% 40%`

**Critique:** Lowering lightness from 46.1% to 40% increases contrast — good. But `text-muted-foreground` is used for inactive nav links (`nav-client.tsx:122`). Inactive nav links are now visually closer to active ones. Could regress visual hierarchy.

**Verdict:** Worth designer confirmation in light mode.

**Confidence:** Medium.

### F-12 / F-13 — Login form labels + password toggle

**Critique:** The `aria-pressed={showPassword}` plus dynamic `aria-label` may double-cue state in some screen readers ("Show password, pressed, button"). ARIA Authoring Practices generally recommends one channel per state attribute.

**Verdict:** Either drop `aria-pressed` and keep label-as-state, or keep `aria-pressed` and use a static label like `t('togglePasswordVisibility')`. Current state may double-announce.

**Confidence:** Medium — depends on AT verification.

### F-14 — 404 numeral opacity bump

**Critique:** Numeral is `aria-hidden="true"` so contrast is irrelevant for AT. For sighted users, the new visibility is helpful.

**Verdict:** Fine.

**Confidence:** High.

### F-15 — `2xl:columns-5`

**Critique:** See P1-LOW-02 in perf review. JS column count doesn't match.

**Verdict:** Misses the priority/lazy alignment.

**Confidence:** High.

### F-17 — hreflang alternates

**Critique:** The alternates only emit `en` and `ko`. If `LOCALES` ever grows the hard-coded map silently goes stale. The alternate-language map should iterate over `LOCALES`.

**Verdict:** Refactor to consume `LOCALES` for forward-compat.

**Confidence:** High.

### F-18 — alt-text underscore normalization

**Critique:** `getConcisePhotoAltText` now strips `^#+` and replaces `\s+#` with `, ` and `_` with space. This works for tag-derived alt text but also runs over the `image.title` path (when the title is a real string). If a user titled a photo `"Photo_2024"`, the alt text becomes `"Photo 2024"` — possibly unwanted.

**Verdict:** Edge-case-but-unlikely.

**Confidence:** Medium.

### F-23 — Skeleton shimmer

**Critique:** Adds an indefinite animation (see P1-LOW-01). Also: the shimmer fades `rgba(255,255,255,0.06)` over `bg-black/5 dark:bg-white/5` — in dark mode the shimmer is white-on-white-translucent, which renders as nearly invisible. The shimmer affordance only "shows loading" in light mode.

**Verdict:** Either drop dark-mode shimmer or use a theme-aware gradient.

**Confidence:** High.

## What the wave missed

- **`info-bottom-sheet.tsx` close button** still `p-2` (~24x24).
- **`image-manager.tsx`** checkbox `h-5 w-5` — admin-only, but UX gap.
- **`upload-dropzone.tsx`** still uses `focus-visible:ring-*`. Inconsistency with image-zoom's new outline approach.
- **The `<Footer />` `admin` link** in `footer.tsx:49` is `text-xs` — small interactive target.
- **JSON-LD `name`** in `(public)/page.tsx:161` and `(public)/[topic]/page.tsx:188` doesn't apply underscore normalization.

## Confidence

High that none of the fixes are *wrong*, but several have small gaps. The strongest signals: (a) underscore normalization scattered/inconsistent (also flagged by code-reviewer and architect), (b) column-count mismatch (also flagged by perf), (c) shimmer animation issues.

## Recommendation

Schedule a small follow-up addressing: (a) underscore-normalization consolidation, (b) column-count mirror in `useColumnCount`, (c) shimmer that respects load state, (d) hreflang generated from `LOCALES`.
