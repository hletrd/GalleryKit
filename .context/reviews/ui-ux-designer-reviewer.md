# UI/UX Designer Reviewer - Cycle 7/100

Role: `ui-ux-designer-reviewer` custom reviewer, adapted from the registered BurstPick prompt to GalleryKit's Next.js web photo-gallery/admin product. Scope: PROMPT 1 reviewer-style UI/UX/design-system critique focused on public photo browsing, photographer-facing filter clarity, navigation state, accessibility semantics, responsive behavior, admin surfaces, i18n, and existing design-system guardrails.

No fixes implemented. No commit, push, or deploy performed. Review is against current HEAD `17124135`.

## Executive Summary

GalleryKit's current UI is generally disciplined for a photo gallery: 44 px touch targets are broadly enforced, public photo surfaces have keyboard shortcuts and reduced-motion handling, and prior mobile/color/detail issues appear closed. The biggest current interaction failure is tag-filter state honesty: a URL containing only invalid tag slugs renders the unfiltered gallery while every filter chip, including `All`, reports inactive. Design quality score: 7/10 for the public gallery, with the score capped by this state-visibility bug because filter state is a primary trust contract for browsing.

## Context Loaded

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md` (installed prompt; project-local `.codex/agents/ui-ux-designer-reviewer.md` does not exist)
- Agent-browser skills: core navigation, query, visual, interact, wait, debug, config
- Relevant `.context/plans/README.md` and previous `.context/reviews/ui-ux-designer-reviewer.md`
- Current cycle sibling review notifications already written under `.context/reviews/`

The installed reviewer prompt is authored for BurstPick/SwiftUI. I applied its professional creative-tool criteria to this repository's actual Next.js web gallery/admin UI.

## Inventory Before Findings

Inventory examined before filing findings:

- Public route pages: home, topic, smart collection, shared group, shared photo, photo detail, timeline, year, map, loading/error/not-found/layout surfaces under `apps/web/src/app/[locale]/(public)/`.
- Admin route pages: login, protected layout/loading/error, dashboard, categories, tags, settings, SEO, DB, password, users, tokens, analytics under `apps/web/src/app/[locale]/admin/`.
- Shared components: nav/search/home masonry/load-more/tag filter/photo viewer/photo navigation/lightbox/info bottom sheet/color details/histogram/map/similar photos/upload/image manager/bulk edit/admin header/nav/user manager/tag input/footer/UI primitives under `apps/web/src/components/`.
- Translation files: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Test/evidence sweep: `apps/web/src/__tests__`, `apps/web/e2e`, with special attention to tag/filter tests, touch target/focus-visible patterns, ARIA state, motion, and i18n.

Static inventory count for the primary UI/app/admin source sweep: 16,454 lines across `apps/web/src/components`, `apps/web/src/app/[locale]/(public)`, and `apps/web/src/app/[locale]/admin`.

## Browser Evidence

Local browser attempt:

- Existing Next dev server was running on `localhost:3017`.
- `agent-browser open http://localhost:3017/en` rendered the route error shell because local MySQL was unavailable: `.next/dev/logs/next-development.log` showed `ECONNREFUSED` for DB queries in `Nav` and queue bootstrap.
- Because local runtime state could not render representative data, I used the deployed gallery target for DOM/accessibility evidence while keeping source citations anchored to current HEAD.

Deployed public evidence collected with `agent-browser`:

- `https://gallery.atik.kr/en` accessibility snapshot exposes `group "Filter by tag"` with buttons `All`, `Color in Music Festival (276)`, `SHINYU (174)`, etc.
- Clicking `Color in Music Festival` navigates to `https://gallery.atik.kr/en?tags=color-in-music-festival` and sets that chip to `aria-pressed="true"`.
- Opening `https://gallery.atik.kr/en?tags=not-a-real-tag` returns the unfiltered page (`h1="Latest"`, paragraph `445 photos`, first masonry links unchanged from the unfiltered latest view), but DOM extraction shows all chips report inactive:
  - `All`: `aria-pressed="false"`
  - every concrete tag chip: `aria-pressed="false"`

## Confirmed Issues

### UIUX-C7-01 - Invalid tag URLs produce an impossible filter state where unfiltered results show with no active chip

Severity: Medium
Confidence: High
Classification: Confirmed UI state / accessibility semantics bug

Evidence:

- Server canonicalization filters the requested query down to existing tags:
  - `apps/web/src/app/[locale]/(public)/page.tsx:161-166` parses and filters `tagsParam` through `filterExistingTagSlugs(...)`, then queries unfiltered results when `tagSlugs.length === 0`.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:172-176` does the same on topic pages.
  - `apps/web/src/lib/tag-slugs.ts:37-48` drops slugs that do not exist in the available tag list.
- The canonical server state is passed to `HomeClient`:
  - `apps/web/src/app/[locale]/(public)/page.tsx:222`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:214`
- `HomeClient` uses the canonical `currentTags` for heading text, empty-state copy, and load-more requests:
  - `apps/web/src/components/home-client.tsx:241-250`
  - `apps/web/src/components/home-client.tsx:259-263`
  - `apps/web/src/components/home-client.tsx:438-447`
- But `HomeClient` renders `<TagFilter tags={tags} />` without passing canonical `currentTags` at `apps/web/src/components/home-client.tsx:269-270`.
- `TagFilter` reconstructs active state and next URLs from raw `useSearchParams()` instead:
  - `apps/web/src/components/tag-filter.tsx:13-15`
  - `apps/web/src/components/tag-filter.tsx:18-39`
  - `apps/web/src/components/tag-filter.tsx:61-72`
  - `apps/web/src/components/tag-filter.tsx:80-92`
- No direct `TagFilter` behavioral test exists; `rg` found no `render(<TagFilter...)` or equivalent coverage in `apps/web/src/__tests__` / `apps/web/e2e`.

Browser/DOM evidence:

- On `https://gallery.atik.kr/en?tags=not-a-real-tag`, the browser DOM reported `h1: "Latest"`, `paragraph: "445 photos"`, and normal latest-photo links, proving the server rendered the unfiltered gallery.
- The same DOM reported every filter chip with `aria-pressed="false"`, including `All`, even though the effective result set is all photos.

Why this is a problem:

The filter bar is the user's primary state indicator. The UI currently has a third state that should not exist: results are unfiltered, but `All` is not selected and no concrete tag is selected. Sighted users see no highlighted filter; screen-reader users hear no pressed toggle in the filter group. That breaks state visibility and makes the page look like filtering is neither active nor cleared.

Concrete failure scenario:

A visitor follows a stale or manually edited URL such as `/en?tags=not-a-real-tag`. The gallery shows all 445 photos, but the filter group communicates that `All` is not active. If the visitor then toggles real tags, `TagFilter` composes the next query from the stale raw value, so invalid slug state can continue to influence URL writes until a clear action removes it.

Suggested fix:

Make `TagFilter` consume the canonical tag list from the server, not raw query params. A narrow fix is:

- Change `TagFilter` props to accept `currentTags: string[]`.
- Pass `currentTags` from `HomeClient` into `TagFilter`.
- Derive `aria-pressed`, active variants, and `handleTagClick` additions/removals from that canonical list.
- When writing the next URL, write only canonical slugs plus the clicked valid slug; if the canonical list is empty, `All` should be active even when the URL contains junk.
- Add a regression test covering `?tags=not-a-real-tag` and `?tags=valid,not-a-real-tag`, asserting canonical chip state and URL writes.

## Information Architecture Assessment

The public information architecture is sound: persistent global nav, topic pills, gallery heading, filter group, masonry links, load-more, and photo detail/lightbox all form a coherent browsing model. The defect above is an IA/state-visibility issue, not a page-structure issue: the canonical result set and the filter control can diverge.

## Visual Design Audit

No new confirmed visual-system defects found. The source sweep shows consistent use of `min-h-11`/44 px targets, focus-visible rings, dark/OLED tokens, forced-colors handling, reduced-motion suppression, and photo-first black surfaces in the viewer/lightbox. Existing comments document prior tradeoffs such as masonry hover scale, color badges, and mobile toolbar constraints.

## Interaction Design Critique

Keyboard and pointer handling is generally robust on the reviewed surfaces: search has combobox semantics and IME guards, photo viewer/lightbox handle arrows and shortcut keys outside editable targets, and controls expose titles/ARIA shortcuts where appropriate. The current interaction failure is specific to tag filtering: the chip group does not have a single source of truth for active state and URL mutation.

## Workflow Design Evaluation

For public browsing, the standard workflow of choosing a topic/tag, opening a photo, using viewer/lightbox navigation, and returning to the grid is supported. The invalid-tag state bug can degrade trust in filtered browsing and load-more continuation, especially from shared/stale URLs, but does not block normal valid-tag browsing.

## Accessibility Report

Confirmed WCAG-relevant issue:

- `aria-pressed` state on the tag-filter toggle group can become false for every option while the page is effectively in the `All` state. This violates state communication expectations for toggle controls and leaves assistive-technology users without a reliable indication of the active result scope.

No additional confirmed accessibility defects found in this pass. Focus-visible, reduced-motion, forced-colors, and touch-target handling have explicit source/test coverage across many surfaces.

## Platform Fidelity Check

The web UI uses standard browser patterns and Radix/shadcn primitives where appropriate. Search, dialogs, select/switch controls, and links mostly carry familiar semantics. No new platform-fidelity findings filed.

## Competitive UX Comparison

| Feature | Lightroom / Photo Mechanic expectation | GalleryKit current HEAD | Verdict |
| --- | --- | --- | --- |
| Active filter visibility | Filter state is always explicit and canonical | Invalid tag URLs can show all photos with no active chip | Worse |
| Keyboard photo navigation | Arrow-key movement in viewer/lightbox | Implemented with editable-target guards | Same for public viewer |
| Touch target sizing | Large enough for repeated use | 44 px policy broadly enforced by source/tests | Same/better for web touch |
| Reduced motion | Optional/nonessential animation suppressed | Global reduced-motion CSS plus component checks | Same |

## Design System Assessment

The design system is coherent for the current product scale: Tailwind tokens, shadcn/Radix primitives, lucide icons, CSS variables for light/dark/OLED, and source-level touch-target/focus-visible tests. The bug is not token drift; it is state-source drift between server-canonical filters and a client component reading raw URL params independently.

## Prioritized Design Recommendations

Tier 0 - Blocking:

- None found in this UI/UX lane.

Tier 1 - High impact:

- Fix `TagFilter` to use server-canonical `currentTags` for active state and URL writes.

Tier 2 - Polish:

- Add direct component/e2e coverage for malformed tag URLs so the filter group cannot re-enter an impossible visual/ARIA state.

Tier 3 - Refinement:

- Consider canonicalizing or replacing malformed `?tags=` URLs in-place after render so copied links also converge to the state the page is actually showing.

## Final Missed-Issues Sweep

Final sweep covered:

- Public masonry, topic, smart collection, shared group/photo, timeline/year/map, photo detail, lightbox, search, tag-filter, load-more, and empty/error/loading surfaces.
- Admin login/dashboard/categories/tags/settings/SEO/DB/password/users/tokens/analytics/upload/image-manager surfaces.
- UI primitives for buttons, dialogs, alert dialogs, select, switch, input, tooltip, sheet, badge, table, progress, and global CSS.
- English/Korean message surfaces where they intersected reviewed UI.
- Existing test coverage for tag slugs, public actions, focus-visible links, touch target policy, i18n parity, and source contracts.

No additional confirmed UI/UX findings were found in current HEAD.

## Final Verdict

Score: 7/10. GalleryKit's UI mostly helps the photographer/viewer by staying photo-first and maintaining strong accessibility guardrails, but the tag filter currently gets in the way when URLs contain stale or invalid tag state. Fixing that canonical-state split should be the cycle 7 UI priority.
