# Cycle 79 Designer + Accessibility Review

Reviewer: Cycle 79 designer + accessibility reviewer
HEAD reviewed: `15e7a4ba`
Scope: current HEAD UI/UX, accessibility, WCAG/touch targets, keyboard/focus, responsive behavior, loading/empty/error states, dark/light mode, i18n, and perceived performance.

## Result

No new confirmed UI/UX or accessibility issue found.

Severity: N/A
Confidence: Medium-high for source/test-covered surfaces; medium for browser-only visual flows because local MySQL was unavailable.
Failure scenario: none confirmed in this pass. Normal gallery, photo, map, and authenticated admin flows could not be fully browser-exercised because the local app's configured DB refused connections on `127.0.0.1:3306`.
Suggested fix: no code fix recommended from this review. Keep `C75-08` in the existing deferred register; I did not re-file it.

## Browser Evidence

I started GalleryKit locally on `http://localhost:3023` and stopped it before finishing. Port 3000 was occupied by a different app (`ccusage`), so I did not use it.

Browser startup was feasible, but full public/admin data flows were blocked by DB errors. The dev server repeatedly logged `ECONNREFUSED 127.0.0.1:3306`; `/en` and `/en/map` rendered the localized route error shell instead of real gallery/map content.

Confirmed in Chromium:

- `/en/admin`, mobile 390x844: status 200, `lang="en"`, `dir="ltr"`, username input autofocus, username/password/sign-in controls measured `308x44`, password reveal measured `44x44`.
- `/ko/admin`, desktop dark 1280x900: status 200, `lang="ko"`, `dir="ltr"`, username input autofocus, username/password/sign-in controls measured `334x44`, password reveal measured `44x44`.
- `/en` and `/en/map` DB-error states: visible nav/recovery controls measured at least 44 px except the intentionally `sr-only` skip link before focus.

Source backing:

- Root layout sets localized `lang`, future-proofed `dir`, skip link, theme provider, and toaster: `apps/web/src/app/[locale]/layout.tsx:94`, `apps/web/src/app/[locale]/layout.tsx:99`, `apps/web/src/app/[locale]/layout.tsx:123`.
- Login form has persistent labels, field-level `aria-invalid`/`aria-describedby`, autofocus, password reveal `aria-pressed`, and 44 px submit/reveal controls: `apps/web/src/app/[locale]/admin/login-form.tsx:59`, `apps/web/src/app/[locale]/admin/login-form.tsx:68`, `apps/web/src/app/[locale]/admin/login-form.tsx:70`, `apps/web/src/app/[locale]/admin/login-form.tsx:104`, `apps/web/src/app/[locale]/admin/login-form.tsx:127`.
- Route error shell keeps a labelled nav, focusable `main`, single `<h1>`, and 44 px retry/back actions: `apps/web/src/app/[locale]/error.tsx:25`, `apps/web/src/app/[locale]/error.tsx:34`, `apps/web/src/app/[locale]/error.tsx:37`, `apps/web/src/app/[locale]/error.tsx:44`, `apps/web/src/app/[locale]/error.tsx:50`.

## Source + Test Evidence

Touch targets and focus:

- Button variants floor `default`/`sm` at `min-h-11`, icons at `size-11`, and large at `min-h-12`/`size-12`: `apps/web/src/components/ui/button.tsx:23`.
- Inputs use `min-h-11` and focus-visible rings: `apps/web/src/components/ui/input.tsx:11`.
- Switch root uses `min-h-11 min-w-11`; select trigger/items/scroll buttons use `min-h-11`: `apps/web/src/components/ui/switch.tsx:27`, `apps/web/src/components/ui/select.tsx:40`, `apps/web/src/components/ui/select.tsx:112`, `apps/web/src/components/ui/select.tsx:151`.
- Search dialog uses modal tree isolation, focus trap, `role="dialog"`, combobox semantics, live status, and 44 px close button: `apps/web/src/components/use-modal-tree-isolation.ts:19`, `apps/web/src/components/search.tsx:150`, `apps/web/src/components/search.tsx:412`, `apps/web/src/components/search.tsx:420`, `apps/web/src/components/search.tsx:438`, `apps/web/src/components/search.tsx:479`, `apps/web/src/components/search.tsx:467`.
- Upload dropzone exposes disabled semantics, progressbar state, skipped-file status, per-file errors, lazy/async previews, and 44 px remove/clear/upload controls: `apps/web/src/components/upload-dropzone.tsx:217`, `apps/web/src/components/upload-dropzone.tsx:436`, `apps/web/src/components/upload-dropzone.tsx:456`, `apps/web/src/components/upload-dropzone.tsx:476`, `apps/web/src/components/upload-dropzone.tsx:497`, `apps/web/src/components/upload-dropzone.tsx:513`, `apps/web/src/components/upload-dropzone.tsx:526`, `apps/web/src/components/upload-dropzone.tsx:581`.

i18n and state copy:

- English/Korean keys are present for home empty/loading/rate-limit/maintenance states: `apps/web/messages/en.json:254`, `apps/web/messages/ko.json:254`.
- English/Korean search states include keyboard instructions, loading, error, rate-limit, maintenance, semantic setup, and short-query messages: `apps/web/messages/en.json:417`, `apps/web/messages/ko.json:417`.

Validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/bottom-sheet-dropdown-portal.test.ts src/__tests__/search-status-source.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/analytics-link-touch-targets.test.ts src/__tests__/gps-map-link-touch-targets.test.ts src/__tests__/select-item-touch-target.test.ts`
  - Result: 9 files passed, 44 tests passed.
- `npm test --workspace=apps/web -- --run src/__tests__/i18n-key-parity.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/search-stale-response.test.ts src/__tests__/search-short-query-guard.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/upload-dropzone-topic-wiring.test.ts src/__tests__/map-thumb-wiring.test.ts src/__tests__/error-shell-heading.test.ts src/__tests__/a11y-us-p15.test.ts`
  - Result: 10 files passed, 44 tests passed.

## Prior Deferred Items

Not re-raised:

- `C75-08`: bulk-edit validation alert association remains in the existing deferred register. This review found no new browser/source evidence that changes its severity.
- `C76-04`: bottom-sheet dropdown portal coverage remains a deferred test-depth item; the existing source-shaped test passed in this run.

## Residual Risk

Because MySQL was not running locally, I could not visually inspect real masonry content, photo viewer/lightbox content, map markers, analytics tables, upload success, or authenticated admin dashboard data in the browser. The conclusion above is therefore based on available browser shells plus current source/test evidence, not a full data-backed visual walkthrough.
