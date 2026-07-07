# GalleryKit UI/UX Designer Reviewer — Cycle 5 Prompt 1

Date: 2026-07-07
Custom reviewer prompt consulted: `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`.

Note: the local custom prompt is written for a different product domain, so I used its review method (professional workflow, keyboard ergonomics, density, accessibility, and code-backed evidence) rather than its BurstPick-specific file requirements.

## Inventory

Reviewed:

- Public browsing flows: localized home/topic/photo/share/smart-collection routes.
- Admin IA: admin nav and protected admin surfaces.
- Interaction systems: search dialog, lightbox, mobile info sheet, upload/admin forms by source inspection.
- Test contracts: focus restore, public route behavior, nav/touch-target visual checks, i18n parity.
- Styling/system constraints: Tailwind classes, UI primitives, reduced-motion and touch-target enforcement.

Browser automation was not run because this prompt allows writes only to review artifacts. This review is code/test backed.

## Confirmed Issues

### UXR-C5-01 — Smart collections have no discoverable admin workflow despite public/action implementation

Evidence:

- Public read route exists: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`.
- Mutation actions exist and are hardened: `apps/web/src/app/actions/collections.ts:16-150`.
- Admin navigation has no Collections destination: `apps/web/src/components/admin-nav.tsx:15-25`.
- Product/architecture doc confirms no admin UI invokes them: `CLAUDE.md:162`.

Concrete failure scenario:

An admin wants to publish a dynamic gallery such as "recent wedding highlights" or "50mm black-and-white" and has no UI path to create, preview, edit, or retire the collection. The only path is direct DB insertion of `query_json`, which is not a designer-acceptable workflow for a marketed admin feature.

Suggested fix:

Create an admin Collections area with list state, empty state, create/edit dialog or page, slug/name validation, predicate builder, preview count, public/private toggle, and destructive-delete confirmation. If that scope is not planned now, keep the feature internal and avoid exposing it in product copy.

Confidence: High.

## Likely Issues

### UXR-C5-02 — Search shortcut copy may mislead non-Mac users

Evidence:

- `apps/web/src/components/search.tsx:138-142` defaults platform detection to Mac when `navigator` is unavailable.
- `apps/web/src/components/search.tsx:516-522` renders the visible keyboard hint from that state.
- Search tests cover focus and results but not platform-specific copy.

Concrete failure scenario:

A Windows/Linux user sees `⌘K` in the search footer instead of `Ctrl+K`. The command is still technically available, but the visible affordance is wrong for the user's keyboard.

Suggested fix:

Use neutral shortcut copy (`Ctrl/⌘ K`) or client-only platform detection with explicit non-Mac coverage. Add an e2e assertion for the footer label under a non-Mac browser context.

Confidence: Medium.

## Manual-Validation Risks

### UXR-C5-M01 — Mobile admin density and repeated-use ergonomics still need live validation

Evidence:

- Admin nav uses wrapped touch-safe links (`apps/web/src/components/admin-nav.tsx:29-44`), and touch-target tests exist, but this lane did not run mobile browser inspection.
- Prior cycle work fixed several mobile/focus issues; those areas have regression tests, but not every admin form workflow is covered by e2e.

Risk scenario:

The admin surfaces may be technically accessible while still feeling inefficient for repeated phone use: too much wrapping, controls below the fold, or form feedback not near the field that failed.

Suggested validation:

Run a mobile-width admin pass after login on dashboard, categories/tags, SEO/settings, upload, and DB/analytics pages. Check one-handed reach, visible validation, keyboard order, and whether primary actions stay discoverable without screenshots as sole evidence.

Confidence: Medium.

### UXR-C5-M02 — Live performance/interaction metrics are unverified in this lane

Evidence:

- Source and tests cover many UX invariants, but no LCP/CLS/INP capture was run.
- Photo-heavy grids and image derivative caching are the primary user-perceived performance surfaces.

Risk scenario:

A code path can pass unit/e2e behavior tests while still causing slow first meaningful photo paint or input delay on low-end devices.

Suggested validation:

Run performance traces against home, topic, photo detail, and mobile admin on representative data. Tie any failures to image sizing, hydration, service-worker, or expensive client components.

Confidence: Medium.

## Final Sweep

Checked information architecture, affordances, keyboard/focus, responsive states, accessibility gates, i18n/RTL readiness, loading/error-state coverage by source, and performance validation boundaries. No additional confirmed UI/UX defects were found without runtime inspection.
