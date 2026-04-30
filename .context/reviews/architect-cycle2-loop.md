# Architect — Cycle 2 review-plan-fix loop (2026-04-25)

## Architectural lens

The architectural goal landed in plan-301 was a single-source-of-truth pattern for two cross-cutting concerns: tag-label humanization and locale alternates emission. This review checks whether the abstraction holds at every consumer.

## Findings

### A2L-LOW-01 — Alternate-language emission has two different consumer patterns

- **Files:**
  - `apps/web/src/app/[locale]/layout.tsx:28-34` — inline `{ en, ko, x-default }` map (NOT using `buildHreflangAlternates`)
  - `apps/web/src/app/[locale]/(public)/page.tsx:50` (uses helper)
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:97` (uses helper)
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:93` (uses helper)
- **Severity / Confidence:** LOW / High
- **Why:** Architectural inconsistency — plan-301-C established the helper as the authoritative way to emit hreflang alternates, but the root layout (the most-inherited metadata emitter) still uses the inline map. The two patterns also disagree on `x-default`: the helper resolves to `localizeUrl(seo.url, DEFAULT_LOCALE, '/')` (i.e., `…/en`), while the root layout uses bare `seo.url` (no locale). Two surfaces → two `x-default`s.
- **Suggested fix:** Migrate root layout to `buildHreflangAlternates(seo.url, '/')` so the helper truly is the only call site. This also makes `LOCALES`-driven forward compatibility extend everywhere.

### A2L-LOW-02 — Tag-name humanization has two consumer patterns

- **Files:**
  - `apps/web/src/lib/photo-title.ts:28` (`humanizeTagLabel` defined)
  - `apps/web/src/components/tag-filter.tsx:63,98` (uses helper)
  - `apps/web/src/components/home-client.tsx:132` (uses helper)
  - `apps/web/src/lib/photo-title.ts:38,49` (uses helper inside `getPhotoDisplayTitle`)
  - `apps/web/src/components/photo-viewer.tsx:395` (raw `tag.name`)
  - `apps/web/src/components/info-bottom-sheet.tsx:243` (raw `tag.name`)
- **Severity / Confidence:** LOW / High
- **Why:** Same architectural break as A2L-LOW-01. Plan-301-A's stated DOD: "Single source of truth: `humanizeTagLabel`. All four callers consume the helper." The plan called out four surfaces; the photo-viewer info sidebar and bottom-sheet chips are a fifth and sixth surface that were missed.
- **Suggested fix:** Apply `humanizeTagLabel` to both `<Badge key={tag.slug}>#{tag.name}</Badge>` chips. Add a quick assertion in a component test or vitest helper that any rendered tag name with `_` becomes a space.

## Cross-cutting note

Both findings have the same root cause: plan-301 defined the helper but inventory of call sites only covered the public masonry and tag-filter. A "find every consumer" pass at the end of plan-301 (e.g., grep `tag\.name` and `'en'`/`'ko'` literals) would have caught both. Recommend folding that audit step into future "consolidation" plans.

## Confidence

High on both findings — direct grep confirmed.
