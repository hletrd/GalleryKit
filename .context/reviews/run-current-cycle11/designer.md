# Cycle 11 Designer Review

Date: 2026-07-18 KST  
Reviewed HEAD: `7e40e95c`  
Lane: designer

## Inventory, skill use, and browser coverage

Inventoried the full 3,679-file repository and concentrated visual review on 81 route files, 61 components, 116 library modules, EN/KO messages, styles/themes, 16 E2E files, current UX review history, and recent image-delivery changes. Read and used all mandated browser skills: agent-browser core, interact, query, wait, network, visual, debug, state, and config. The skills caused live interaction, accessibility-tree/DOM/computed-style inspection, network capture, state save, screenshots, console/error checks, trace capture, viewport/media/offline configuration, and keyboard testing; screenshots were evidence supplements only.

Live matrix: deployed EN and KO; 1440x1000 and 320x568; system/light/dark media; search initial/results/no-results/close; keyboard Tab/Escape and focus restoration; offline reload; source ladders/current resources; mobile navigation; screenshots and trace. WCAG 2.2 evidence included named landmarks/headings, skip link, dialog/combobox/listbox semantics, visible focus, 320 px reflow, target geometry, alt/name structure, and focus containment/restoration. No horizontal overflow occurred at 320 px. Shipped locales are LTR; `dir=ltr` matched EN/KO. RTL remains a future-locale validation concern, not a current failure.

## DES-C11-01 — Search result presentation starts invisible page-load work

- Severity: **Medium**
- Confidence: **High**
- Validation: **Confirmed** (DOM/source/network)
- WCAG: not a direct conformance failure; affects perceived performance and data use
- Regions: `apps/web/src/components/search.tsx:77-85`; existing UI flow tests `apps/web/e2e/public.spec.ts:21-69`.

The result list looks responsive and accessible, but merely rendering it triggers 16 dynamic photo RSC fetches for 10 unique destinations, six duplicated, before hover/focus/activation. Baseline home navigation produces zero such requests because masonry links opt out. On a constrained connection, this background burst competes with 20 result thumbnails and can make the typeahead feel heavier just when the user is scanning results.

Concrete failure: a mobile visitor types and refines a query; visible results arrive, then unrequested detail-page fetches consume bandwidth and server time, delaying thumbnails or the next query. Fix with `prefetch={false}` on result links, or prefetch only the active/hovered row after dwell. Preserve the current 44 px-plus row target, keyboard selection, and focus behavior.

## Required UX sweep and final missed-issue sweep

- Keyboard/focus: dialog autofocus, trap, Escape close, and trigger restoration passed.
- Responsive/states: 320 px reflow passed; initial, loading/results, no-results, offline, mobile disclosure, and fallback states were covered live/source-side.
- Themes/i18n/RTL: EN/KO and dark/system rendering passed; no shipped RTL locale exists.
- WCAG 2.2: no new landmark, heading, accessible-name, reflow, focus, or target-size failure confirmed.
- Perceived performance: DES-C11-01 is the sole new finding; truthful responsive widths are live and normal cards select 640 px assets.

Protected admin flows lacked credentials and remain source/E2E-reviewed rather than claimed as live-manual proof. Final sweep found no second current visual or interaction defect.
