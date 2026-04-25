# Code Reviewer — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

General code quality, maintainability, idiomatic correctness.

**HEAD:** `8d351f5 fix(seo): emit hreflang alternates on topic and photo pages`
**Cycle:** 1/100
**Diff scope:** 11 UI/UX fix commits (`e3c1dd3..8d351f5`), 17 files, +237 / -47.

## Inventory of changed files

- `apps/web/messages/en.json`, `apps/web/messages/ko.json` — added `showPassword`, `hidePassword` keys
- `apps/web/src/__tests__/locale-path.test.ts` — updated OG-locale tests
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` — hreflang alternates
- `apps/web/src/app/[locale]/(public)/layout.tsx` — `tabIndex={-1}` on `<main>`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — hreflang alternates
- `apps/web/src/app/[locale]/admin/login-form.tsx` — visible labels + password toggle
- `apps/web/src/app/[locale]/globals.css` — `--muted-foreground` contrast bump + skeleton-shimmer
- `apps/web/src/app/[locale]/not-found.tsx` — full layout shell
- `apps/web/src/components/home-client.tsx` — 2xl masonry, underscore normalization
- `apps/web/src/components/image-zoom.tsx` — explicit outline focus indicator
- `apps/web/src/components/nav-client.tsx` — 44x44 mobile expand toggle
- `apps/web/src/components/photo-viewer.tsx` — mobile layout, 44px touch targets, skeleton-shimmer
- `apps/web/src/components/search.tsx` — 44x44 trigger + close
- `apps/web/src/components/tag-filter.tsx` — 44x44 pills, underscore display
- `apps/web/src/lib/locale-path.ts` — route-locale precedence in `getOpenGraphLocale`
- `apps/web/src/lib/photo-title.ts` — alt-text underscore normalization

## Findings

### CR1-LOW-01 — Underscore-normalization is duplicated across surfaces (LOW, High confidence)

**File/region:** `apps/web/src/components/home-client.tsx:122,160`, `apps/web/src/components/tag-filter.tsx:61`, `apps/web/src/lib/photo-title.ts:78`.

**Why a problem:** The "replace `_` with space" transform is implemented inline in four places (one helper, three callers). When `getPhotoDisplayTitleFromTagNames` is consumed elsewhere (e.g. JSON-LD `name` in `(public)/page.tsx:161` and `(public)/[topic]/page.tsx:188`), the consumer gets the *raw* underscore-bearing string. New consumers will silently inherit the un-normalized value.

**Failure scenario:** Tag-derived JSON-LD `name` fields advertise `"#Color_in_Music_Festival"` to Google's structured-data parser even though the visible UI shows the humanized version. Search-snippets display awkward underscored names; rich-result preview also shows the raw slug.

**Suggested fix:** Push the underscore-normalization into `getPhotoDisplayTitleFromTagNames` (or a new `humanizeTagName(name)` helper exported alongside) and call it from every surface. Single source of truth.

**Confidence:** High.

### CR1-LOW-02 — `home-client.tsx` double-applies underscore normalization (LOW, High confidence)

**File/region:** `apps/web/src/components/home-client.tsx:160`.

**Why a problem:** `getPhotoDisplayTitleFromTagNames(image, ...)` returns a hashtag-prefixed string like `#Seoul #Night`. The caller already redundantly chains `.replace(/_/g, ' ')`, but `getConcisePhotoAltText` is a sibling that already includes the same `.replace` step internally. The naming pattern (`displayTitle` vs. `altText`) hides this asymmetry.

**Failure scenario:** When a tag actually contains an `_` (e.g. `Light_Festival`), the *display title* shows `#Light Festival #Night` (hashtag with space inside) while the *alt text* shows `Light Festival, Night` — visually inconsistent labeling for the same photo.

**Suggested fix:** Move the normalization into `getPhotoDisplayTitleFromTagNames` so display title and alt text agree. Remove the inline `.replace` in home-client.

**Confidence:** High.

### CR1-LOW-03 — `getOpenGraphLocale` semantics changed; admin "OG locale" setting silently dead on supported routes (LOW, Medium confidence)

**File/region:** `apps/web/src/lib/locale-path.ts:57-69`.

**Why a problem:** The behavior change is correct (route locale must win), but the admin SEO settings page still surfaces the configured `seo.locale` to the user as if it had effect. A user who set `seo.locale = 'en_GB'` to advertise British English now silently has that override discarded for any `/en/...` or `/ko/...` route.

**Failure scenario:** An admin who explicitly chose `en_GB` (a code we *don't* recognize as an OG locale and which `normalizeOpenGraphLocale` already filters to `null`) sees no UI feedback that their value is ignored. The same is true for `en_US` set on a `/en/...` route, where the configured value is now ignored even though it's perfectly valid.

**Suggested fix:** Either (a) document in the SEO settings UI that the configured locale only takes effect for unsupported route locales, or (b) add a server-side warning/log when a configured value is overridden. Tests already cover the new precedence — UX/docs fix only.

**Confidence:** Medium.

### CR1-INFO-01 — `not-found.tsx` recreates the layout shell instead of composing it (informational)

**File/region:** `apps/web/src/app/[locale]/not-found.tsx:12-53`.

**Why informational:** Next.js 15+ `not-found.tsx` runs *outside* the segment's `layout.tsx`, so the duplication is unavoidable. The current implementation is consistent with the public layout. Worth a comment cross-referencing why duplication is correct, but not a defect.

**Suggested action:** None.

**Confidence:** High.

### CR1-INFO-02 — `hreflang` alternate-language map is duplicated across `(public)/[topic]/page.tsx` and `(public)/p/[id]/page.tsx` (informational)

**File/region:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:95-99`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:91-95`.

**Why informational:** The structure is identical (en/ko/x-default → `localizeUrl(seo.url, 'en'|'ko', path)`). A small helper `buildHreflangAlternates(seo.url, path)` would reduce repetition, but each page already owns its metadata generation pattern, and three lines is not worth a helper.

**Suggested action:** None unless a third surface (e.g. `g/[key]`) needs the same pattern. Defer.

**Confidence:** High.

## Cross-file checks

- **Search dialog X close** sized to 44x44 (`search.tsx:228`); the dialog is `inset-0` on mobile, so the increased button doesn't clip. Verified.
- **Mobile expand toggle** still has `md:hidden` so desktop layout unchanged. Verified.
- **`<main>` `tabIndex={-1}`** added to both `(public)/layout.tsx` and `not-found.tsx`. Other `<main>` instances: none. Skip-link target uniformly focusable. Verified.
- **`getOpenGraphLocale`** call sites: 6 (layout, page, [topic], p/[id], s/[key], g/[key]). All pass `(locale, seo.locale)`. Behavior is consistent across the surface. Verified.
- **i18n keys** `showPassword`, `hidePassword` present in both `en.json` and `ko.json`. No drift. Verified.

## Confidence

High overall. Two LOW findings (CR1-LOW-01, CR1-LOW-02) are real but cosmetic; only one (CR1-LOW-03) is a UX-feedback concern, not a code defect.

## Recommendation

Fold underscore normalization into `getPhotoDisplayTitleFromTagNames` for a single source of truth. CR1-LOW-03 can be deferred (out of scope for the UI fix wave; SEO admin docs).
