# Debugger — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

Bug hunt: latent runtime errors, edge cases, ordering bugs.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Hypotheses considered

### H1 — Could the new `getOpenGraphLocale` precedence break a legacy admin who set `seo.locale = 'en_US'`?

**Test:** With `locale='en'` (route) and `configuredLocale='en_US'`, `isSupportedLocale('en')` is true → returns `OPEN_GRAPH_LOCALE_BY_LOCALE.en` = `'en_US'`. Same value as before. With `locale='ko'` and `configuredLocale='en_US'`, returns `'ko_KR'` (route wins). Previous behavior returned `'en_US'`.

**Impact:** Admins who explicitly set `en_US` to override Korean routes lose that override. **Documented as F-6/F-16 — intentional fix.** Not a bug.

### H2 — Could `not-found.tsx`'s call to `<Nav />` throw if DB is down?

**Test:** `<Nav />` calls `getTopicsCached`, `getSeoSettings`, `getGalleryConfig` which catch DB failures and return defaults (verified in cycle 8 sitemap fix `7bb8690`). The 404 page should render even with DB unreachable, just with empty topics.

**Caveat:** `<Footer />` calls `getLocale()` and `getTranslations('footer')`. These are next-intl calls and are not DB-dependent. Should not throw.

**Verdict:** Safe.

### H3 — Could the password toggle button submit the form?

**Test:** `<button type="button">` at `login-form.tsx:82`. **Not a submit button.** Confirmed.

### H4 — Could the `aria-pressed` value confuse some screen readers when paired with a dynamic `aria-label`?

**Test:** NVDA + Chrome announce both: "Show password, button, not pressed" when `showPassword=false`, then "Hide password, button, pressed" after toggle. Some users report this is verbose; others find it clear.

**Verdict:** Not a bug, possibly a UX polish opportunity (S1-LOW-02 / F-12-13 critique).

### H5 — Could `tabIndex={-1}` on `<main>` interfere with focus ordering when JS-disabled?

**Test:** With JS disabled, the skip link's `href="#main-content"` triggers fragment navigation. Browser scrolls to `<main>`. Focus is moved to `<main>` (per WHATWG focus-fixup since 2017). `tabIndex={-1}` is just a no-op when JS is off.

**Verdict:** Safe.

### H6 — Could `2xl:columns-5` cause the masonry grid to render with 5 columns but `containIntrinsicSize` placeholder calculated for 4?

**Test:** `containIntrinsicSize: auto ${Math.round(300 * image.height / image.width)}px` is per-card, height-only. The width is determined by CSS `columns-N`. Adding a 5th column means each card is narrower, so the actual rendered height is `(narrower_width * height / width)`. The intrinsic-size placeholder may be slightly off (300px reference instead of true card width), but `content-visibility: auto` is tolerant of intrinsic-size mismatches.

**Verdict:** Cosmetic CLS only. Not a bug.

### H7 — Could `min-h-[40vh] md:min-h-[500px]` clip the photo on landscape mobile?

**Test:** On `667 × 375` landscape mobile, `40vh = 150px`. Photo with `max-height: 100vh` (from existing CSS rule at `globals.css:118-121`) is constrained to fit, so the image shows but the container is **smaller than the image**. `overflow-hidden` clips the rest.

Wait — let me re-check. The container is `min-h-[40vh]` which is *minimum*, not maximum. Auto-height (default) lets it grow to fit. The container has no `max-height`, only `min-height`. So the image at `max-height: 100vh` will set the container height to ~100vh. **No clipping.**

**Verdict:** Safe. Critic's F-10 critique is wrong on this specific point — but the *intent* (40vh as a minimum) may still be too small *visually as a placeholder* before the image loads. Cosmetic concern only.

### H8 — Could the password toggle show the password and the user navigate away with it visible?

**Test:** `useState` is component-scoped. Navigating away unmounts the component, state is destroyed. New mount: `showPassword = false`. **No leak.**

But the **autocomplete suggestion** (`autoComplete="current-password"`) on a `type="text"` field — does the browser store the value differently? Some browsers will *not* offer to save a password if the field is `type="text"` at submit. The submit happens via `formAction`, and at submit time `type` is whatever the user last set.

**Verdict:** A user who submits with password visible may not get prompted to save the password. Minor UX issue, not a bug.

## Findings

**Zero new MEDIUM or HIGH findings.**

### LOW

- **D1-LOW-01** — Submitting the login form with `showPassword=true` may suppress the browser's "Save password" prompt because the field is `type="text"` at submit. Consider auto-resetting `showPassword=false` on form submit. **Confidence: Medium.**
- **D1-LOW-02** — `containIntrinsicSize` on home-client cards still uses a `300` reference width even though 2xl renders cards narrower. Visual CLS may shift slightly on first paint at 2xl breakpoint. **Confidence: Low.**

## Confidence

High that no MEDIUM/HIGH bugs exist in the diff.

## Recommendation

D1-LOW-01 is a small UX polish (maintain the saved-password prompt). Defer or fold into a future cycle.
