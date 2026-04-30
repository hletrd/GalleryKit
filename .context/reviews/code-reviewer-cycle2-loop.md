# Code Reviewer — Cycle 2 review-plan-fix loop (2026-04-25)

## Run context

- **HEAD:** `707ea70 docs(plan): mark plan-301 as DONE`
- **Cycle:** 2/100
- **Diff scope:** plan-301 implementation (5 commits since cycle 1: `3dd50cd refactor photo-title`, `4026ffc useColumnCount mirror`, `21bedb8 hreflang LOCALES + home`, plus the docs commit). This review focuses on whether plan-301 actually closed AGG1L-LOW-01 / AGG1L-LOW-02 / AGG1L-LOW-04 across the entire codebase, not only the surfaces plan-301 explicitly listed.

## Inventory

- `apps/web/src/lib/photo-title.ts` (added `humanizeTagLabel`)
- `apps/web/src/lib/locale-path.ts` (added `buildHreflangAlternates`)
- `apps/web/src/components/home-client.tsx` (uses `humanizeTagLabel`, `useColumnCount` mirror)
- `apps/web/src/components/tag-filter.tsx` (uses `humanizeTagLabel`)
- `apps/web/src/app/[locale]/(public)/page.tsx` (uses `buildHreflangAlternates`)
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` (uses `buildHreflangAlternates`)
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (uses `buildHreflangAlternates`)
- `apps/web/src/app/[locale]/layout.tsx` (NOT using `buildHreflangAlternates`)
- `apps/web/src/components/photo-viewer.tsx` (renders `#{tag.name}` raw)
- `apps/web/src/components/info-bottom-sheet.tsx` (renders `#{tag.name}` raw)

## Findings

### CR2L-LOW-01 — `[locale]/layout.tsx` still has the inline hreflang map plan-301-C extracted

- **File:** `apps/web/src/app/[locale]/layout.tsx:28-34`
- **Severity / Confidence:** LOW / High
- **Why:** Plan-301-C extracted `buildHreflangAlternates(seo.url, '/')` to consolidate the hreflang map and make it forward-compatible when a new locale is added to `LOCALES`. The home, topic, and photo pages were updated, but the **root layout** still hardcodes `'en' / 'ko' / 'x-default'`. The comment in plan-301-C explicitly called out adding to a new locale should "automatically extend the alternate-language map at every consumer (no inline `{ en: ..., ko: ... }` literals to keep in sync)" — this consumer was missed.
- **Failure scenario:** Adding `ja` to `LOCALES` extends the public pages but the root layout's metadata still emits only `en/ko`, leading search engines to disagree across the site about which locales exist for the root URL. Also, `x-default: seo.url` here resolves to e.g. `https://gallery.atik.kr` (no locale prefix), while `buildHreflangAlternates(...)` resolves `x-default` to `https://gallery.atik.kr/en` — the two surfaces emit different `x-default` values for the same logical home URL.
- **Suggested fix:** Replace lines 29-33 with `languages: buildHreflangAlternates(seo.url, '/')`, dropping the explicit `'x-default': seo.url` (the helper already emits `x-default` pointing at `DEFAULT_LOCALE`). Add an import for `buildHreflangAlternates` (already exporting from `@/lib/locale-path`).

### CR2L-LOW-02 — `photo-viewer.tsx:395` and `info-bottom-sheet.tsx:243` render `#{tag.name}` raw, bypassing `humanizeTagLabel`

- **Files:**
  - `apps/web/src/components/photo-viewer.tsx:393-397` (desktop info sidebar tag chips)
  - `apps/web/src/components/info-bottom-sheet.tsx:241-245` (mobile bottom-sheet tag chips)
- **Severity / Confidence:** LOW / High
- **Why:** Plan-301-A intent: "single source of truth: `humanizeTagLabel`" so the visible UI, alt text, JSON-LD, and tag filter all show the same humanized label. The masonry card now reads `#Music Festival` (humanized), but the tag chip in the photo viewer's desktop sidebar and the bottom sheet still reads `#Music_Festival`. This is a direct re-introduction of the AGG1L-LOW-01 inconsistency — same tag, two different rendered forms depending on which surface the user is on.
- **Failure scenario:** A photo with tag slug `music_festival` (display name `Music_Festival`) shows:
  - Masonry card title: `#Music Festival` (humanized through `getPhotoDisplayTitleFromTagNames`)
  - Tag-filter pill: `Music Festival` (humanized through `humanizeTagLabel`)
  - **Photo viewer desktop sidebar chip: `#Music_Festival`** (raw)
  - **Photo viewer bottom-sheet chip: `#Music_Festival`** (raw)
- **Suggested fix:** Wrap the rendered name with `humanizeTagLabel(tag.name)` in both files. Add a corresponding visible-tag-chip integration test (component or snapshot) to lock the consolidation.

### CR2L-INFO-01 — Group-page masonry doesn't mirror the home-page 5-column 2xl breakpoint

- **File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:170`
- **Severity / Confidence:** LOW / Medium
- **Why:** Home masonry adopted `2xl:columns-5` for AGG1L-LOW-02 (LCP); group masonry stayed at `xl:columns-4`. Tracking decision is consistent with cycle-1 narrowing the priority work to public home/topic, but worth recording for designer review.
- **Failure scenario:** Wide screens (>=1536px) on a shared group view get four wider columns instead of five. Not strictly a regression, but the masonry density is intentionally tighter on the home/topic surfaces; share view falling out of sync is a user-visible inconsistency for admins who share group links.
- **Suggested fix:** Designer call. If "5 columns at 2xl" is the new universal masonry rule, update both. If it's home-only, leave as is and note in a follow-up doc.

## Cross-file interactions

- The `humanizeTagLabel` consolidation reaches the masonry, tag-filter, JSON-LD, and concise alt text. The photo-viewer info sidebar / bottom sheet chip render path is the only remaining consumer that bypasses the helper. Once those two are fixed the JSDoc claim "single source of truth" becomes literally true.
- The `buildHreflangAlternates` helper is now used on home/topic/photo. Root layout is the only remaining stale call site. Once it's switched, every metadata emitter agrees on what `x-default` resolves to.

## Confidence assessment

- CR2L-LOW-01: High — file inspected, helper signature matches `Metadata.alternates.languages`.
- CR2L-LOW-02: High — direct grep + visual inspection of source confirms.
- CR2L-INFO-01: Medium — could be intentional (smaller share-view density).
