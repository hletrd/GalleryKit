# Cycle 84/100 Designer / Accessibility Review

Reviewed HEAD: `023ae28d41ee757caaa408710bd864d88087a40c`.
Date: 2026-07-01.
Role: designer/accessibility lane.

## Scope

- Read-only review of information architecture, affordances, keyboard/focus, WCAG 2.2 accessibility, touch targets, responsive behavior, loading/empty/error states, English/Korean UX, and photographer-facing product risk.
- Required context read: `AGENTS.md`, `CLAUDE.md`, code-review skill instructions, Cycle 83 designer/accessibility review, Cycle 83 aggregate, and Cycle 83 deferred register.
- No implementation files were edited. This review artifact is the only intended write for this lane.

## Findings

### C84-DES-01 - Dashboard failed-image retry label contract can drift while tests still pass

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123`, `apps/web/src/__tests__/failed-image-retry.test.ts:152`, `apps/web/src/__tests__/failed-image-retry.test.ts:154`, `apps/web/src/__tests__/failed-image-retry.test.ts:155`, `apps/web/src/__tests__/failed-image-retry.test.ts:156`, `apps/web/messages/en.json:73`, `apps/web/messages/ko.json:73`.
- Failure scenario: the current UI is correct: each failed row computes `label = getFailedImageLabel(img)`, displays `{label}`, and uses the same localized value for the retry button's accessible name. But the test only checks that the helper exists, that the helper body contains the fallback expression, and that an `aria-label` consumes a variable named `label`. A future refactor could leave that helper unused, assign `label` from raw `img.title` or `img.user_filename`, and regress blank/weak retry names for admins using screen readers while the source-contract test still passes.
- Suggested fix: tighten the source contract around the failed-image map body: require `const label = getFailedImageLabel(img);`, the visible row text `{label}`, and the retry `aria-label` inside the same slice. If the component test harness is expanded, add a render test for whitespace title + missing filename fallback to `ID {id}`.

## Non-Findings / Evidence

- Search result naming is now locked against the Cycle 82/83 photographer-facing filename regression: `getPhotoResultLabel()` rejects filename-like titles and falls back through description/id at `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99`, with behavior coverage at `apps/web/src/__tests__/photo-title.test.ts:92`. The search component computes and visibly renders `label` at `apps/web/src/components/search.tsx:71` and `apps/web/src/components/search.tsx:104`, and the strengthened source contract checks that flow at `apps/web/src/__tests__/search-disclaimer.test.ts:19` through `apps/web/src/__tests__/search-disclaimer.test.ts:25`.
- Similar-photo thumbnails use the same normalized label for title, `aria-label`, and image `alt`: `apps/web/src/components/similar-photos.tsx:183`, `apps/web/src/components/similar-photos.tsx:188`, and `apps/web/src/components/similar-photos.tsx:230` through `apps/web/src/components/similar-photos.tsx:236`. The source contract pins that path at `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:9` through `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:22`.
- Public search has expected keyboard/focus/status affordances: the trigger and dismiss controls are 44 px (`apps/web/src/components/search.tsx:376`, `apps/web/src/components/search.tsx:469`), the dialog uses modal/focus-trap wiring (`apps/web/src/components/search.tsx:414`, `apps/web/src/components/search.tsx:422`), the input exposes combobox/listbox state (`apps/web/src/components/search.tsx:440` through `apps/web/src/components/search.tsx:444`), and empty/error statuses stay in the accessibility tree (`apps/web/src/components/search.tsx:507`; test at `apps/web/src/__tests__/search-disclaimer.test.ts:10`).
- Core touch-target guardrails remain broad: the audit scans shared components, admin routes, public routes, and app-level route files at `apps/web/src/__tests__/touch-target-audit.test.ts:79` through `apps/web/src/__tests__/touch-target-audit.test.ts:83`, with the 44 px policy documented at `apps/web/src/__tests__/touch-target-audit.test.ts:9` through `apps/web/src/__tests__/touch-target-audit.test.ts:15`. I did not re-raise the known admin-only touch-target exemptions because their exit criteria were not hit.
- Photo-viewer and lightbox keyboard affordances are present: global viewer shortcuts skip editable/interactive targets (`apps/web/src/components/photo-viewer.tsx:42` through `apps/web/src/components/photo-viewer.tsx:64`), the viewer exposes a hidden heading/description (`apps/web/src/components/photo-viewer.tsx:541` through `apps/web/src/components/photo-viewer.tsx:550`), and lightbox controls retain explicit labels/shortcuts and 44 px controls (`apps/web/src/components/lightbox.tsx:553` through `apps/web/src/components/lightbox.tsx:659`).
- Loading, empty, and error states are localized and exposed: the gallery empty/filter state includes a clear-filter path (`apps/web/src/components/home-client.tsx:430` through `apps/web/src/components/home-client.tsx:445`), load-more announces progress through a polite live region (`apps/web/src/components/load-more.tsx:155` through `apps/web/src/components/load-more.tsx:167`), and upload no-category/progress/skipped-file/error states are visible with status/alert semantics (`apps/web/src/components/upload-dropzone.tsx:373`, `apps/web/src/components/upload-dropzone.tsx:456`, `apps/web/src/components/upload-dropzone.tsx:470`, `apps/web/src/components/upload-dropzone.tsx:568`).
- Korean UX coverage is acceptable for the reviewed delta: retry labels have natural EN/KO forms at `apps/web/messages/en.json:73` and `apps/web/messages/ko.json:73`, and the full leaf-key parity gate prevents raw-key drift between locales at `apps/web/src/__tests__/i18n-key-parity.test.ts:47` through `apps/web/src/__tests__/i18n-key-parity.test.ts:66`.

## Deferred Not Re-Raised

- `C80-06`: `site-config.json` runtime/build-time contract.
- `C77-ARCH-01`: restore maintenance foreground admin mutation barrier.
- `C76-04`: bottom-sheet dropdown portal runtime coverage.
- `C76-05`: `getImageProcessingState` processed-predicate behavior coverage.
- `C75-08`: bulk-edit validation alert association.
- Historical performance, semantic-search, settings re-encode, shared-view, broad browser-matrix, mobile filter hierarchy, and admin responsive ergonomics items remain covered by prior artifacts unless their exit criteria are hit.

## Validation

- Source/test review only; browser automation was not used because the requested artifact could be grounded from code and tests without delaying the cycle.
- Full lint/typecheck/build/Vitest gates were not run in this lane.
