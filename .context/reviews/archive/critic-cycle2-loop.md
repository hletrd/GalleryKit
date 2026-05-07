# Critic — Cycle 2 review-plan-fix loop (2026-04-25)

## Brief

Be skeptical. Did plan-301 actually achieve its DOD, or did it leave consumers behind?

## Findings

### C2L-01 — Plan-301-A's "single source of truth" claim is not yet true

- **Files:**
  - `apps/web/src/components/photo-viewer.tsx:395`
  - `apps/web/src/components/info-bottom-sheet.tsx:243`
- **Severity / Confidence:** LOW / High
- **The claim:** Plan-301-A: "Single source of truth: `humanizeTagLabel` in `photo-title.ts`. All four callers consume the helper."
- **Reality:** Two **additional** consumers (photo-viewer info sidebar and bottom-sheet tag chips) render `#{tag.name}` raw. The plan's caller inventory was incomplete. The "all four" was wrong; there are six surfaces touching `tag.name`.
- **Why this matters:** A user opening a photo with tag `Music_Festival`:
  - Sees `#Music Festival` on the masonry card.
  - Clicks into the photo viewer.
  - Sees `#Music_Festival` on the desktop info-sidebar chip and the mobile bottom-sheet chip.
  - The exact "scattered, drifty" failure mode AGG1L-LOW-01 was supposed to close.
- **Recommendation:** Open a follow-up plan that wraps `humanizeTagLabel(tag.name)` in both surfaces. Bonus: add a vitest assertion that scans rendered output of the desktop sidebar / bottom sheet for `_` in tag-chip text content.

### C2L-02 — Plan-301-C similarly missed the root layout

- **File:** `apps/web/src/app/[locale]/layout.tsx:28-34`
- **Severity / Confidence:** LOW / High
- **The claim:** Plan-301-C DOD: "Forward-compat: adding a new locale to `LOCALES` automatically adds it to alternates."
- **Reality:** Root layout still has the inline `{ en, ko, x-default }` map; adding a new locale would extend the public pages but not the root metadata.
- **Recommendation:** Migrate the root layout to `buildHreflangAlternates(seo.url, '/')`. The helper already exists and tests the right shape.

### C2L-03 — `tag-filter.tsx` `displayName = humanizeTagLabel` is technically a no-op alias

- **File:** `apps/web/src/components/tag-filter.tsx:63`
- **Severity / Confidence:** INFO / High
- The local `displayName = humanizeTagLabel` rename is harmless but adds a layer of indirection that could trip up readers. A direct call `{humanizeTagLabel(tag.name)}` at the use site would be slightly more explicit.
- **Recommendation:** Cosmetic; defer.

## Defended decisions (no follow-up)

- 2xl masonry density (5 columns at 1536+) — designer call landed, holding.
- Skeleton-shimmer animation-never-stops — debuking note in plan-302; no perf evidence yet.
- 44x44 floor on public surfaces — appropriate for AAA target.

## Bottom line

Plan-301's refactors are *almost* complete. The two missed consumers (photo-viewer sidebar, info-bottom-sheet, root layout) leave the "single source of truth" promise unfulfilled. These are mechanical follow-ups, not architectural rework.
