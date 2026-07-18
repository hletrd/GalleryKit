# Cycle 1 Designer Review

Date: 2026-07-18 KST
Start HEAD: `64f6ac63`
Scope: public/admin UI components and routes, Tailwind/global styling, i18n UI copy, accessibility/touch-target fixtures, Playwright UI coverage, and a live browser pass against `https://gallery.atik.kr` at desktop, 393 px, and 320 px widths.

## Inventory and method

- Inventoried the UI under `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/messages/**`, `apps/web/e2e/**`, and the touch-target/accessibility tests under `apps/web/src/__tests__/**`.
- Exercised the live home page, tag filters, search dialog, photo page, lightbox focus trap/escape restoration, mobile menu, theme/media settings, accessibility snapshots, computed boxes, console/page errors, and desktop/mobile screenshots with `agent-browser`.
- Confirmed visible interactive targets on the exercised pages meet the repository's 44 px floor, dialogs expose names and modal state, lightbox focus returns to its trigger, and the 393 px layout does not overflow.

## Finding DES-C1-01 — production semantic-search label collapses the site identity at 320 CSS px

- Severity: Medium (WCAG 2.2 reflow / responsive information loss)
- Confidence: High; reproduced on the deployed site with DOM box evidence
- Status: Confirmed
- Code: `apps/web/src/components/search.tsx:381-398`, especially the production-mode exception at line 397; `apps/web/src/components/nav-client.tsx:97-110,169-205`
- Test gap: `apps/web/e2e/nav-visual-check.spec.ts:40-59` tests 375 px only, while `apps/web/src/__tests__/client-source-contracts.test.ts:73-76` positively pins the production-mode label exception.
- Evidence: at a 320×700 viewport on `/en`, `document.documentElement.scrollWidth` remains 320 only because the nav brand link is squeezed to `{ width: 0, left: 16, right: 16 }`. The search control remains 143.55 px wide because production semantic mode forces its visible text label; theme, locale, and expand controls each remain 44 px. The site identity is therefore completely invisible at the WCAG 1.4.10 reflow width even though its focusable link remains in the accessibility tree.
- Failure scenario: a visitor using a 320 CSS px viewport or 400% zoom cannot see the gallery identity/home affordance in the sticky header. Keyboard users can focus an apparently blank home link.
- Suggested fix: when `showDesktopLabel` is true, keep the visible search text desktop-only regardless of semantic-search mode; the existing `aria-label` preserves the icon button's accessible name. Add a 320 px Playwright assertion that the brand link has a non-zero box and all visible nav targets remain at least 44×44 without overlap.

## Final missed-issue sweep

No additional confirmed UI defect was found in the exercised home/photo/lightbox/search/mobile-menu flows. Large-map payloads, broader browser-matrix coverage, and admin mobile redesign remain pre-existing recorded items rather than new findings from this cycle.
