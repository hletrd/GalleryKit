# Cycle 10 Designer / UI-UX Review

Date: 2026-07-18 KST  
Reviewed HEAD: `1e3646e3`  
Lane: designer

## Browser evidence

Used the required `agent-browser` core, interaction, query, wait, network, visual, debug, state, and configuration skills after reading each `SKILL.md` completely. Chromium 151 was installed/verified. No local server was listening and authenticated credentials were unavailable, so the deployed public application was used; protected admin pages were source-reviewed only.

Live coverage: desktop 1440×1000 and mobile 320×568; EN and KO; light and dark media; accessibility snapshots/diffs; search open/fill/results/Escape and focus restoration; network requests; cookies/state save; console/errors; full-page screenshots; offline reload; 320 px horizontal containment. The public page exposed skip navigation, labelled landmarks, logical headings, named photo links, 44 px footer targets, labelled search dialog/combobox/results, and focus restoration. No horizontal overflow was measured at 320 px. Offline reload returned cached content. No page error was reported.

## DES-C10-01 — Responsive image selection can produce avoidable perceived softness

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed visual-quality/perceived-performance defect**
- WCAG relevance: quality rather than a direct conformance failure
- Regions: `apps/web/src/lib/process-image.ts:1214-1234`; `apps/web/src/lib/image-url.ts:91-95`; `apps/web/src/components/masonry-card.tsx:88-110`; archive/shared grid call sites; `apps/web/e2e/responsive-masonry.spec.ts:102-138`.

The browser is told that a 1200 px resource is 4096 px wide. On a 1504 CSS-px card at DPR 2, it selects that file as adequate and then stretches 1200 physical pixels to a 3008-device-pixel target. This is especially visible in a photography product whose primary promise is faithful finished-photo presentation. It also makes the apparent network choice opaque: DevTools/currentSrc suggests a large derivative while the decoded detail is much smaller.

Concrete failure: a visitor opens a sparse/single-photo archive on a Retina ultrawide display and sees a softer image than the source limit and UI imply. Fix by advertising unique actual candidate widths and capping the ladder at the real encoded width; show no false promise that a suffix is a decoded dimension. Add visual/browser checks based on decoded width and, if practical, screenshot sharpness fixtures.

## Required UX sweep disposition

- IA/affordances: Timeline/Map are configurable and absent on the live operator's deployment by setting; not refiled as a defect.
- Keyboard/focus: search trigger, modal focus, Escape close, and restoration passed; mobile nav and tag disclosure remain named.
- WCAG 2.2/responsive: 320 px reflow passed on the exercised public shell; no new target-size, landmark, contrast, or focus issue confirmed.
- Loading/empty/error/validation: public search result/instruction state and offline fallback worked. Protected admin validation remains manual-validation-only in this pass.
- Themes/i18n/RTL: EN/KO and light/dark passed. Shipped locales are LTR; RTL remains a future-locale acceptance concern, not a current defect.
- Perceived performance: DES-C10-01 is the sole new finding; full ladders are live and network requests selected 640 px assets for normal cards.

Screenshots were kept ephemeral at `/tmp/gallery-c10-desktop.png` and `/tmp/gallery-c10-mobile-dark.png`; no source asset was modified.
