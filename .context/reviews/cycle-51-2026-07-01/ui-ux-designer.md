# Cycle 51 UI / UX / Accessibility / Photographer Review

## Summary

Reviewed current repo HEAD `11c4337fce35e3fcab789228a445960d6f573261` for GalleryKit UI/UX, accessibility, responsive behavior, Korean i18n, public photo offline behavior, and photographer-facing color/HDR product risk.

No new actionable UI/UX/accessibility or photographer-facing product-risk defects were found.

Validation evidence:

- `npm test --workspace=apps/web -- sw-template-contract.test.ts touch-target-audit.test.ts focus-visible-links-scan.test.ts color-details-section-delivered.test.ts photo-viewer-no-hdr-download.test.ts` passed: 5 files, 81 tests.
- `npm test --workspace=apps/web -- color-pipeline-decision-i18n.test.ts humanize-transfer-function-i18n.test.ts search-short-query-guard.test.ts data-timeline-truncation.test.ts` passed: 4 files, 53 tests.
- Manual message-key parity script over `apps/web/messages/en.json` and `apps/web/messages/ko.json` found 842 keys in each locale, with no missing English or Korean keys.
- Static review only; I did not start a dev server because the current HEAD delta is a service-worker contract-test change and no rendered UI defect required browser reproduction.

## Inventory

Project and prior-review context:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-50-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-50-2026-07-01/ui-ux-designer.md`
- `.context/plans/cycle-50-2026-07-01-plan.md`
- `.context/plans/cycle-50-2026-07-01-deferred.md`

Current HEAD delta reviewed:

- `apps/web/src/__tests__/sw-template-contract.test.ts`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

Public UI surfaces sampled:

- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`

Key interaction, accessibility, and color/HDR components sampled:

- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/grid-picture.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/ui/button.tsx`

Tests and source contracts reviewed:

- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/src/__tests__/focus-visible-links-scan.test.ts`
- `apps/web/src/__tests__/color-details-section-delivered.test.ts`
- `apps/web/src/__tests__/photo-viewer-no-hdr-download.test.ts`
- `apps/web/src/__tests__/color-pipeline-decision-i18n.test.ts`
- `apps/web/src/__tests__/humanize-transfer-function-i18n.test.ts`
- `apps/web/src/__tests__/search-short-query-guard.test.ts`
- `apps/web/src/__tests__/data-timeline-truncation.test.ts`

i18n messages sampled:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

## Findings

No actionable defects found.

Non-defect observations:

- Cycle 50's service-worker concern is addressed at current HEAD. `apps/web/src/__tests__/sw-template-contract.test.ts:124` now evaluates concrete localized and unlocalized route cases against both the template and generated worker. Normal public photo pages such as `/p/123`, `/ko/p/123`, and `/en-US/p/123` are asserted as fallback-eligible at `apps/web/src/__tests__/sw-template-contract.test.ts:126`, while share/group/collection/map routes remain bypassed at `apps/web/src/__tests__/sw-template-contract.test.ts:129`. The runtime classifier in both workers excludes only `[csg]` object routes and map routes at `apps/web/public/sw.template.js:59` and `apps/web/public/sw.js:59`.
- Public photo viewing remains covered by accessible viewer affordances: `PhotoViewer` supplies a hidden H1 and viewer description at `apps/web/src/components/photo-viewer.tsx:547`, keyboard navigation guards editable targets at `apps/web/src/components/photo-viewer.tsx:371`, and the current-position live region is present at `apps/web/src/components/photo-viewer.tsx:711`.
- Mobile and modal photo surfaces retain focus management and touch targets. The bottom sheet uses `role="dialog"` and `aria-modal` at `apps/web/src/components/info-bottom-sheet.tsx:198`, a keyboard-operable drag handle at `apps/web/src/components/info-bottom-sheet.tsx:217`, and min-44px close/download controls at `apps/web/src/components/info-bottom-sheet.tsx:243` and `apps/web/src/components/info-bottom-sheet.tsx:501`. Lightbox focus trapping, focus restoration, and dialog semantics are present at `apps/web/src/components/lightbox.tsx:432` and `apps/web/src/components/lightbox.tsx:451`.
- The global button primitive currently floors all size variants at 44px or larger through `min-h-11`, `size-11`, or `min-h-12` at `apps/web/src/components/ui/button.tsx:23`. The recursive touch-target audit scans `components/`, admin routes, and public routes at `apps/web/src/__tests__/touch-target-audit.test.ts:79` with documented exception budgets at `apps/web/src/__tests__/touch-target-audit.test.ts:112`.
- Keyboard focus coverage has a broad source scanner over `components/` and the full app tree at `apps/web/src/__tests__/focus-visible-links-scan.test.ts:56`, failing hover/cursor-styled interactive controls without a focus indicator at `apps/web/src/__tests__/focus-visible-links-scan.test.ts:214`.
- Korean/i18n coverage is complete by key parity. Color/HDR copy remains honest in both locales: delivered SDR and no public HDR-delivery claim are explicit in `apps/web/messages/en.json:380` and `apps/web/messages/ko.json:380`; force-show copy distinguishes public P3 badges from admin-only HDR audit badges at `apps/web/messages/en.json:768` and `apps/web/messages/ko.json:768`.
- Photographer color/HDR honesty remains guarded. The Color Details contract requires admin-only gating for source bit depth and ICC name at `apps/web/src/__tests__/color-details-section-delivered.test.ts:33`, delivered bit-depth labeling that accounts for `avif_10bit` and forced sRGB derivatives at `apps/web/src/__tests__/color-details-section-delivered.test.ts:75`, and explicit public HDR-badge suppression through `isAdmin && isHdr` at `apps/web/src/__tests__/color-details-section-delivered.test.ts:155`. The photo-viewer download contract still forbids nonexistent HDR AVIF download links at `apps/web/src/__tests__/photo-viewer-no-hdr-download.test.ts:13`.
- The public map keeps a non-map accessible path: skip link at `apps/web/src/app/[locale]/(public)/map/page.tsx:69`, hidden instructions at `apps/web/src/app/[locale]/(public)/map/page.tsx:75`, and a keyboard-focusable photo list at `apps/web/src/app/[locale]/(public)/map/page.tsx:87`.
- The shared-group zero-image branch currently uses the processing message at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:243`. I did not file this as a defect because group-share creation rejects empty selections at `apps/web/src/app/actions/sharing.ts:207`, requires processed images at `apps/web/src/app/actions/sharing.ts:231`, and the data accessor intentionally returns an existing group with zero visible images to avoid a broken-link 404 during processing windows at `apps/web/src/lib/data.ts:1341`.

Deferred items not re-raised:

- `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` remain carry-forward items from `.context/plans/cycle-50-2026-07-01-deferred.md`. None became newly UI/UX-scheduled during this review.

Final sweep:

- Checked: WCAG/focus indicators, keyboard paths, mobile touch target guards, responsive photo viewer/bottom sheet/lightbox behavior, loading/error/empty states, Korean i18n parity, photographer color/HDR copy, public photo service-worker offline fallback, map accessibility fallback, share/group public viewing paths, and current Cycle 50 closure.
- Intentionally skipped: starting a dev server, Playwright visual capture, deployment, commits, pushes, and edits outside this assigned review file.
