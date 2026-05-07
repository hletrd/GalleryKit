# Designer — Cycle 2 review-plan-fix loop (2026-04-25)

## Lens

Is the post-plan-301 UI consistent across the photo viewer surfaces, and does the masonry-density change make sense at all viewport widths?

## Findings

### DSGN2L-LOW-01 — Photo-viewer tag chip doesn't match the masonry-card tag rendering

- **Files:** `apps/web/src/components/photo-viewer.tsx:393-397`, `apps/web/src/components/info-bottom-sheet.tsx:241-245`
- **Severity / Confidence:** LOW / High
- **Why:** Visual inconsistency. Same data, two visual treatments depending on whether the user is on the masonry list or the viewer.
  - Masonry card → `#Music Festival`
  - Photo viewer chip (desktop) → `#Music_Festival`
  - Photo viewer chip (mobile bottom sheet) → `#Music_Festival`
- **User impact:** Cognitive load — same photo, same tag, different label depending on the surface. WCAG 3.2.4 ("Consistent identification") is the AAA-level criterion this would touch; AA is silent on visual treatment but consistency is a design-system invariant.
- **Suggested fix:** Wrap the chip text with `humanizeTagLabel(tag.name)` in both surfaces.

### DSGN2L-INFO-01 — Group view masonry stays at 4 columns at 2xl

- **File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:170`
- **Severity / Confidence:** INFO / Low
- The home/topic masonry was widened to 5 columns at the 2xl breakpoint (F-15 / AGG1L-LOW-02). The shared-group page kept 4 columns. Designer call:
  - Option A: keep the share-group at 4 (more thumbnail breathing room for a curated set).
  - Option B: mirror the public masonry to keep density consistent.
- **Action:** No change unless designer-stakeholder rules otherwise. Tracking only.

### DSGN2L-INFO-02 — Skeleton-shimmer animation continues to run forever

- **File:** `apps/web/src/app/[locale]/globals.css:88-106`
- **Severity / Confidence:** INFO / Low
- Already in plan-302 deferred (AGG1L-LOW-03). No new evidence to upgrade.

## Recommended cycle-2 implementation

Only **DSGN2L-LOW-01** warrants implementation work. The rest are tracking-only.
