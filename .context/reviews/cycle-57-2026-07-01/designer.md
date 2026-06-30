# Cycle 57 Designer / UI / UX / Accessibility Review

Current HEAD reviewed: `677a8410933a9aaabbd43721dcc5a0bdb6eee786`.

## Scope

- Read first: `AGENTS.md`, `CLAUDE.md`, and the `review-plan-fix` skill instructions.
- Write scope honored: this artifact only. No source files were edited.
- Reviewed frontend/UI surfaces under `apps/web/src/components/`, `apps/web/src/app/[locale]/`, `apps/web/messages/`, and UI/a11y source-contract tests.
- Credentialed browser/admin flows were not run. The inspected public/admin routes are DB-backed and this review should not require credentials, so validation used credential-free source inspection and Vitest source/contract tests.

## Prior Context Checked

- Cycle 56 findings were rechecked against current HEAD:
  - C56-06 is fixed: the photo page resolves admin state at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143-150`, and `getImageForViewer` selects admin fields only when requested at `apps/web/src/lib/data.ts:1204-1205`. The regression contract is pinned at `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:13-28`.
  - C56-07 is fixed: `apps/web/README.md:86-88` and `CLAUDE.md:566-568` now describe copying suggested alt text into title/description fields, not a nonexistent dedicated alt-text field.
- Existing deferred/polish items from Run 9 and Cycle 56 were not re-filed; no exit criterion changed during this review.

## Validation Evidence

All lightweight checks below passed locally:

- `npm test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/focus-visible-rings-cycle17.test.ts src/__tests__/info-bottom-sheet-ia.test.ts src/__tests__/alt-text-fallback.test.ts`
  - 5 files passed, 51 tests.
- `npm test --workspace=apps/web -- src/__tests__/focus-visible-links-scan.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts src/__tests__/switch-geometry-contract.test.ts src/__tests__/cycle-56-source-contracts.test.ts src/__tests__/client-source-contracts.test.ts src/__tests__/search-disclaimer.test.ts`
  - 6 files passed, 38 tests.
- `npm test --workspace=apps/web -- src/__tests__/i18n-key-parity.test.ts src/__tests__/color-pipeline-decision-i18n.test.ts src/__tests__/humanize-transfer-function-i18n.test.ts src/__tests__/wide-gamut-primaries.test.ts src/__tests__/photo-viewer-no-hdr-download.test.ts src/__tests__/free-download-contract.test.ts`
  - 6 files passed, 63 tests.
- `npm test --workspace=apps/web -- src/__tests__/hdr-badge-contrast.test.ts src/__tests__/color-details-section-delivered.test.ts src/__tests__/lightbox-color-pip-hdr.test.ts src/__tests__/histogram.test.ts src/__tests__/download-labels.test.ts src/__tests__/is-p3-pipeline.test.ts src/__tests__/humanize-color-primaries.test.ts src/__tests__/color-details-primaries-match-icc.test.ts`
  - 8 files passed, 114 tests.

Total targeted coverage run for this lane: 25 test files, 266 tests passing.

## Review Notes

- Touch/focus: the blocking touch-target scanner catches new sub-44 px controls and stale allowances at `apps/web/src/__tests__/touch-target-audit.test.ts:741-799`; it passed. Manual spot checks found 44 px/focus treatment on the color accordion buttons at `apps/web/src/components/color-details-section.tsx:303-342`, the mobile bottom sheet trap/controls at `apps/web/src/components/info-bottom-sheet.tsx:189-247`, and lightbox color pip controls at `apps/web/src/components/lightbox-color-pip.tsx:166-196` and `apps/web/src/components/lightbox-color-pip.tsx:306-316`.
- Keyboard/focus flow: source inspection covered nav, lightbox, search, photo viewer, bottom sheet, upload, admin tables/forms, and map controls. The focus-visible scanner passed and no new keyboard-only dead end was confirmed.
- Loading/empty/error states: credential-free source inspection confirmed polite/status states for route loading at `apps/web/src/app/[locale]/loading.tsx:7-10`, photo lightbox loading at `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:20-30`, restore maintenance at `apps/web/src/components/public-restore-maintenance.tsx:9-13`, load-more status at `apps/web/src/components/load-more.tsx:155-167`, and similar-photo loading/error/empty states at `apps/web/src/components/similar-photos.tsx:140-149`.
- i18n/Korean: full en/ko leaf-key parity is pinned at `apps/web/src/__tests__/i18n-key-parity.test.ts:43-70`; the parity test passed. Korean plural asymmetry remains consistent with the documented convention.
- Photographer-facing color/HDR honesty: admin-only audit rows remain gated in the color details surface at `apps/web/src/components/color-details-section.tsx:384-455`; HDR and gain-map honesty notes are gated/rendered at `apps/web/src/components/color-details-section.tsx:532-578`; corresponding contrast and color-pip tests passed.
- Photographer workflow: the Cycle 56 admin-viewer regression is fixed and pinned, so logged-in photographers can receive admin audit fields without moving OG/public metadata off public-safe data.

## Findings

No new UI/UX, accessibility, keyboard/focus, touch-target, Korean i18n, loading/empty/error-state, photographer-workflow, or color/HDR honesty findings were confirmed in this cycle.

## Missed-Issues Sweep

Final sweep included raw visible-text grep, interactive-control grep, image/alt grep, loading/empty/error grep, TODO/deferred grep, latest Cycle 56 aggregate/designer review, Run 9 deferred register, and the targeted Vitest runs above. No additional issue met the bar for a new finding. Known deferred polish items were intentionally not re-raised because no new evidence changed severity or scheduling.

Finding count: 0
