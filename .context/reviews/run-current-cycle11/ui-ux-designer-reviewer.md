# Cycle 11 UI/UX Designer Reviewer

Date: 2026-07-18 KST
Reviewed HEAD: `7e40e95c`
Lane: ui-ux-designer-reviewer

## Inventory, skill use, and evidence

Inventoried all 3,679 tracked files and systematically covered public IA/routes, 61 components, responsive styling, EN/KO messages, themes, focus/modal helpers, loading/error/empty/offline states, E2E coverage, current UX history, and the recent image-delivery implementation. Read and used agent-browser core, interact, query, wait, network, visual, debug, state, and config skills. These skills directly caused the live DOM/accessibility/computed-style/network/focus/trace/state checks below.

Browser matrix: 1440x1000 and 320x568; EN/KO; system/light/dark; search open/type/results/Escape; mobile disclosure; offline reload; screenshots; console/errors; responsive source/current resource inspection. DOM evidence showed `scrollWidth == clientWidth == 320`, `lang=ko`, `dir=ltr`, named navigation/main/footer, H1/H2/H3 structure, labelled dialog/combobox/listbox/options, and restored focus on “Search photos.” The first focused skip link had a visible browser outline. No page error was captured. Shipped EN/KO are LTR; future RTL remains manual acceptance, not a current locale defect.

## UIUX-C11-01 — Typeahead results perform destination work before user intent

- Severity: **Medium**
- Confidence: **High**
- Validation: **Confirmed** (accessibility tree + source + isolated network capture)
- Regions: `apps/web/src/components/search.tsx:77-85,498-513`; comparison `apps/web/src/components/masonry-card.tsx:80-83`.

The interaction model communicates that the visitor should scan options, use arrows, and press Enter. The implementation acts earlier: when results appear, default Next link prefetch generates 16 dynamic route requests for 10 unique photos, with six duplicate destinations. Baseline gallery cards correctly make none. This disconnect between expressed intent and system activity increases perceived latency and data usage while offering little benefit because only one result can be chosen.

Concrete failure: on a throttled phone, the user enters a query and immediately edits it. Unused detail-page RSC fetches from the first result set compete with the second search and thumbnail decoding, making the input/results feel sluggish. Fix with `prefetch={false}` on each result link; optionally prefetch only `activeIndex` after dwell. Retain existing listbox semantics, 64 px row geometry, keyboard behavior, and focus restoration.

## Required matrix and final missed-issue sweep

- WCAG 2.2/keyboard/focus: passed on exercised public shell; no new name/role/value, focus-order/trap, focus-visible, reflow, target-size, or heading issue.
- Responsive: 320 px containment passed; mobile and desktop result/dialog layouts remained usable.
- States: initial, results, no-results, loading indicator, close, offline fallback, image fallback, and configurable nav absence were inspected live or in source/tests.
- i18n/RTL/themes: EN/KO and theme modes passed; no shipped RTL locale exists.
- Perceived performance: UIUX-C11-01 is the only confirmed defect.

Authenticated admin pages were source/E2E-reviewed because live credentials were unavailable. Final sweep found no second current IA, responsive, accessibility, state, or presentation issue.
