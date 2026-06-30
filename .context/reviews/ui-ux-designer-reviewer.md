# Cycle 30 UI/UX Designer Reviewer

Reviewer: ui-ux-designer-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-30
Scope: GalleryKit UI/UX review. The installed reviewer prompt was BurstPick-specific; this artifact uses only its professional UI/UX review intent and applies it to GalleryKit.

## Executive Summary

GalleryKit is not a professional culling instrument; it is a publishing and browsing surface for finished photography. Judged on that actual product, the public browsing UI is pleasant and mostly accessible, but two interaction systems are not yet production-grade: discovery search fails on the live demo for a normal query, and share links have creation affordances without lifecycle affordances. The map also has an accessibility/performance design flaw when GPS-visible collections grow. UI/UX readiness: 7/10 for current browsing, 5/10 for admin trust workflows.

## Information Architecture Assessment

The public IA is simple: localized home/topic/photo/share/map/timeline/privacy pages under a sticky nav, with admin pages separated behind `/admin`. This matches GalleryKit's "finished-photo publishing" scope. The weak IA is operational: "Share" is treated as an action, not an object with state. A share link becomes an external public artifact, but the admin navigation does not expose a place to audit, copy again, expire, or revoke it.

## Visual Design Audit

Live desktop/mobile pages use consistent Tailwind tokens, restrained typography, rounded photo cards, visible focus rings, and a quiet gallery-first hierarchy. Sampled controls met the 44 px target. The design concern is not visual polish; it is state representation. Search failure is visually indistinguishable from a generic transient problem, semantic search appears as an advanced promise in the same dialog, and map scale has no progressive disclosure beyond an all-or-nothing marker/list render.

## Interaction Findings

### C30-UXR-01 - Live search returns a generic failure for a normal gallery query

Severity: High
Confidence: High for symptom, Medium for root cause
Region: `#search-dialog`, `#search-input`; `apps/web/src/components/search.tsx:160-270`, `apps/web/src/components/search.tsx:473-476`, `apps/web/src/app/actions/public.ts:236-317`, `apps/web/src/lib/data.ts:1490-1628`

Concrete failure scenario: A keyboard user presses Cmd/Ctrl+K, types a visible term like `JIHOON`, waits, and hears/sees "Search failed. Please try again." There are no results, no error code, and no path to recover beyond retrying the same broken action.

Suggested fix: Fix the underlying production query failure and add a targeted seeded-browser smoke for a known title/tag. Return specific server-action statuses for DB/query failures and display a clear temporary-unavailable state.

### C30-UXR-02 - Search result list is keyboard-designed, but unproven because the live result path fails

Severity: Medium
Confidence: Medium
Region: `apps/web/src/components/search.tsx:73-109`, `apps/web/src/components/search.tsx:394-426`, `apps/web/src/components/search.tsx:451-472`

Concrete failure scenario: The component implements `role="combobox"` plus `aria-activedescendant` and arrow/Enter activation, but a live user never reaches result navigation when keyword search fails. If this regresses further, result anchors are `tabIndex={-1}`, so Tab users rely entirely on the custom combobox behavior.

Suggested fix: After fixing search, add E2E coverage for open dialog -> type seeded query -> ArrowDown -> Enter -> navigates to expected photo, and a screen-reader-oriented assertion that active descendant and selected option update.

### C30-UXR-03 - Share creation has no UI memory or undo/revoke path

Severity: Medium
Confidence: High
Region: `apps/web/src/components/photo-viewer.tsx:586-618`, `apps/web/src/components/image-manager.tsx:194-210`, `apps/web/src/app/actions/sharing.ts:317-397`

Concrete failure scenario: The admin copies a share URL but misses the toast, closes the tab, or later needs to pull access. There is no visible "active shares" state in the photo, image manager, or analytics UI, even though revoke/delete actions exist server-side.

Suggested fix: Model shares as durable admin objects. Add active-state badges on shared photos/groups, a manage-shares table, and confirmation-backed revoke/delete actions.

### C30-UXR-04 - Public map exposes an unbounded-feeling accessibility surface

Severity: Medium
Confidence: High
Region: `apps/web/src/app/[locale]/(public)/map/page.tsx:75-99`, `apps/web/src/components/map/map-client.tsx:76-90`, `apps/web/src/components/map/map-client.tsx:119-140`, `apps/web/src/lib/data.ts:1649-1685`

Concrete failure scenario: With thousands of GPS-visible photos, the accessible list below the map becomes thousands of links. Screen-reader and keyboard users pay the full cost of a data-heavy visual map even if they skip the map.

Suggested fix: Add list pagination/virtualization and cluster/viewport loading. Announce total/truncated counts and expose filters before the map/list payload.

### C30-UXR-05 - Generic route errors are not designed as public gallery states

Severity: Low-Medium
Confidence: Medium
Region: `apps/web/src/app/[locale]/error.tsx:22-57`

Concrete failure scenario: A visitor on a photo, topic, timeline, or map page sees "Something went wrong loading this page" with Home/Try Again, but no explanation related to gallery data, restore maintenance, search outage, or temporary database unavailability.

Suggested fix: Add public route-level unavailable states with product-specific copy and keep normal public chrome when safe.

## Accessibility Report

- Positive evidence: skip link to `#main-content`, nav landmark labels, dialog focus trap, focus-visible rings, 44 px sampled controls, map skip link, localized status text, and Korean/English key parity.
- Main WCAG risks: generic error messaging affects understandable recovery; map fallback can become an excessive keyboard/screen-reader burden; search failure prevents proving the combobox result path.
- Reduced motion: source uses reduced-motion hooks in lightbox and CSS patterns exist in prior tests; no new issue found.
- Color independence: P3 badges include text; no color-only critical state found in sampled public UI.

## Responsive Review

Live 1440x900 and 390x844 pages rendered without observed overlap. The mobile nav collapses topics and preserves search/theme/locale controls. Home masonry adapts column count. The map and semantic search risks are data-size/responsiveness risks rather than breakpoint CSS issues.

## Loading, Empty, Error States

- Good: `/en/map` empty state is clear; global loading has `role="status"`; photo loading has a lightbox-aware full-screen loader.
- Weak: search failure and route error shell are generic. Share creation relies on transient toast feedback and lacks a persistent state view.

## Product Scope Alignment

GalleryKit does not claim culling/editing/scoring, and the UI does not accidentally introduce those workflows. Admin batch operations are metadata-oriented. The main product/UX mismatch is that search and sharing are marketed as core publishing features but their live/revocation experience is incomplete.

## Rechecked Fixed Items

- GPS public-map switch now prompts before publishing coordinates.
- Privacy copy now states that short-lived full-IP rate-limit buckets may exist.
- Theme control uses mounted state before reading client theme.
- README/app README now warn about first-upload GPS-stripping decisions.

## Skipped Areas

- No production admin login or mutations.
- No local seeded DB/browser run; live public pages and source were used.
- No axe run in this turn; accessibility findings are DOM/source/manual-review based.

## Final Verdict

The UI helps casual public browsing today, but it still gets in the way of trust-critical workflows: finding photos, managing shared access, and browsing GPS data at scale. Fix search reliability first, then design share management as a first-class admin object and make map scale progressive.
