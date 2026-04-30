# Debugger — Cycle 2 review-plan-fix loop (2026-04-25)

## Hypotheses tested

- **H1: Are there other tag-name humanization leaks beyond the photo-viewer?**

  Search results for `tag\.name` in components produced six matches; four of them are inside actions/state (admin tag-input, search filter logic) and don't render to user-visible label text. The two render paths that do are `photo-viewer.tsx:395` and `info-bottom-sheet.tsx:243`. Both are confirmed leaks.

- **H2: Is `useColumnCount` correct for the new 2xl breakpoint at all viewport widths?**

  Tested mentally: 1535px → returns 4 (xl); 1536px → returns 5 (2xl). Boundary correct. `requestAnimationFrame` debouncing means rapid resizes coalesce. No race condition.

- **H3: Does `buildHreflangAlternates` agree with the root layout's hardcoded map for the supported locales?**

  Helper output for `'/'`:
  ```
  { en: 'https://gallery.atik.kr/en', ko: 'https://gallery.atik.kr/ko', 'x-default': 'https://gallery.atik.kr/en' }
  ```

  Root layout output:
  ```
  { en: 'https://gallery.atik.kr/en', ko: 'https://gallery.atik.kr/ko', 'x-default': 'https://gallery.atik.kr' }
  ```

  Disagreement: `x-default` — helper points to `…/en`, layout points to `…` (no locale). Both are valid per Google's hreflang spec ("x-default may point to a non-locale-specific landing page"), but the inconsistency between the home page (which uses helper) and the rest of the site (which inherits the layout) means search engines will see `x-default → /en` for the home URL but `x-default → /` for everything else. Confirmed bug.

- **H4: Is the photo-viewer JSDoc claim "single source of truth" valid?**

  No. See H1. Six of seven surfaces use the helper; one (the chip render path) does not. The JSDoc on `humanizeTagLabel` says: "The single source of truth for the transform lives here so visible UI, alt text, and structured-data emitters cannot drift from each other." This is not yet true.

## Failure scenarios

1. Admin uploads a photo with tag slug `music_festival` (display name `Music_Festival`).
2. End user lands on `/en` masonry: card title `#Music Festival`.
3. End user clicks into `/en/p/123`: photo-viewer desktop sidebar chip says `#Music_Festival`.
4. End user is confused; the same tag has two visual forms.
5. SEO bot fetches `/en` (page-level `x-default → /en`), then fetches `/en/admin` (layout-level `x-default → /`). Bot may or may not de-duplicate.

Both failure modes are visible to real users. The `x-default` divergence is a smaller SEO concern; the chip-label divergence is a UX consistency concern.

## Recommendation

Fold both into a single cycle-2 fix plan with three mechanical edits (root layout, photo-viewer chip, info-bottom-sheet chip). All low risk; all under existing helper calls.
