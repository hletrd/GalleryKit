# Cycle 85/100 Designer / Accessibility Review

Reviewed HEAD: `1d29b98861098a68a8107746997a5d81d70f03f1`.
Date: 2026-07-01.
Role: designer/accessibility lane.

## Scope

- Read-only UI/UX/accessibility review focused on the Cycle 84 delta, adjacent dashboard failed-image retry UI, public gallery/search labels, responsive/touch-target contracts, loading/error states, and photographer-facing product risks.
- Required context read: `AGENTS.md`, `CLAUDE.md`, latest aggregate `.context/reviews/_aggregate.md`, Cycle 84 aggregate/reviews/plan/deferred, current Cycle 85 lane artifacts, and relevant source/tests.
- Source files and plans were not edited. This artifact is the only intended write for this lane.

## Findings

### C85-DES-01 - Retry button accessible names can lose the per-image label if copy edits remove `{label}`

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, `apps/web/src/__tests__/failed-image-retry.test.ts:159`, `apps/web/src/__tests__/failed-image-retry.test.ts:161`, `apps/web/src/__tests__/failed-image-retry.test.ts:163`, `apps/web/messages/en.json:73`, `apps/web/messages/en.json:74`, `apps/web/messages/ko.json:73`, `apps/web/messages/ko.json:74`, `apps/web/src/__tests__/i18n-key-parity.test.ts:47`, `apps/web/src/__tests__/i18n-key-parity.test.ts:65`.
- Problem: Cycle 84 correctly closed the row-source gap: each failed-image row derives `label` from `getFailedImageLabel(img)`, renders `{label}`, and passes `{ label }` into the retry button translation. The accessible name still depends on the EN/KO message templates preserving the `{label}` placeholder. Current copy includes it, but the focused retry test only checks that the component passes `{ label }`, while the global i18n parity gate checks keys only, not placeholder variables.
- Failure scenario: a future translation or copy edit changes `dashboard.retryImageAria` or `dashboard.retryingImageAria` to a generic string such as "Retry processing". `failed-image-retry.test.ts` and `i18n-key-parity.test.ts` still pass, but every retry button in the failed-image panel has the same accessible name, making the admin's recovery workflow ambiguous for screen-reader users.
- Suggested fix: add a focused placeholder assertion requiring `dashboard.retryImageAria` and `dashboard.retryingImageAria` in both locales to contain `{label}`. Keep it targeted to placeholder presence, not full value equality, because EN/KO value shapes legitimately differ.

## Browser / DOM Evidence

- Deployed public site checked with Playwright at `https://gallery.atik.kr/en` on desktop `1280x800`: page title was `ATIK.KR Gallery`; the search trigger exposed `aria-label="Search photos"`, `aria-haspopup="dialog"`, `aria-expanded="false"`, and measured `44x44` px. Opening search produced a `role="dialog"` with `aria-modal="true"` and label `Search photos`; the input exposed `role="combobox"` and `aria-autocomplete="list"`; the close button measured `44x44` px; an unlikely query surfaced visible `No results` in a `role="status"` block.
- Deployed public site checked with Playwright at mobile `390x844`: the search trigger measured `44x44` px, the dialog filled the viewport at `390x844`, the search input measured `282x44` px, and the close button measured `44x44` px.
- Deployed admin dashboard browser evidence was not available without credentials: `https://gallery.atik.kr/en/admin/dashboard` redirected to `https://gallery.atik.kr/en/admin` and rendered the login page with one password field. The failed-image retry panel was therefore reviewed from source/tests.

## Non-Findings / Evidence

- Cycle 84's failed-image row-label source gap is closed. The test now slices the failed-image map body and requires `const label = getFailedImageLabel(img);`, visible `{label}`, and the retry aria-label call at `apps/web/src/__tests__/failed-image-retry.test.ts:154` through `apps/web/src/__tests__/failed-image-retry.test.ts:163`. Current dashboard source satisfies that flow at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:84` through `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123`.
- The current failed-image retry UI is not a confirmed runtime accessibility regression. The label helper trims title/user filename and falls back to `ID {id}` at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39` through `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40`; the row renders the label and describes the retry button with the processing error when present at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109` through `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123`.
- Public search result labels remain meaningful and source-locked. `getPhotoResultLabel()` rejects blank and filename-like titles before falling back through description/id at `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99`; behavior coverage is at `apps/web/src/__tests__/photo-title.test.ts:92` through `apps/web/src/__tests__/photo-title.test.ts:101`; the search component derives and visibly renders `label` at `apps/web/src/components/search.tsx:71` and `apps/web/src/components/search.tsx:103` through `apps/web/src/components/search.tsx:106`; the source contract pins that at `apps/web/src/__tests__/search-disclaimer.test.ts:19` through `apps/web/src/__tests__/search-disclaimer.test.ts:25`.
- Similar-photo labels remain aligned across visible/accessible thumbnail surfaces. The parent computes `label = getPhotoResultLabel(...)` at `apps/web/src/components/similar-photos.tsx:177` through `apps/web/src/components/similar-photos.tsx:188`, and the thumbnail uses that same label for `title`, `aria-label`, and `alt` at `apps/web/src/components/similar-photos.tsx:228` through `apps/web/src/components/similar-photos.tsx:236`. The source contract covers this at `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:9` through `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:22`.
- Touch-target contracts remain broad and passed focused validation. The shared button variants floor default/sm/icon controls at 44 px or larger at `apps/web/src/components/ui/button.tsx:23` through `apps/web/src/components/ui/button.tsx:29`; the audit scans components, admin routes, public routes, and app-level route files at `apps/web/src/__tests__/touch-target-audit.test.ts:79` through `apps/web/src/__tests__/touch-target-audit.test.ts:83`; the policy is documented at `apps/web/src/__tests__/touch-target-audit.test.ts:9` through `apps/web/src/__tests__/touch-target-audit.test.ts:15`.
- Public search loading/empty/error states are accessible in the reviewed source and in deployed DOM. The component announces loading/results through a polite live region at `apps/web/src/components/search.tsx:396` through `apps/web/src/components/search.tsx:405` and `apps/web/src/components/search.tsx:481` through `apps/web/src/components/search.tsx:483`, and keeps visible empty/error text in `role="status"` at `apps/web/src/components/search.tsx:506` through `apps/web/src/components/search.tsx:509`; the source-contract test pins that status block at `apps/web/src/__tests__/search-disclaimer.test.ts:10` through `apps/web/src/__tests__/search-disclaimer.test.ts:17`.
- Gallery/upload loading and error affordances remain visible and named. Load-more has a 44 px button plus a polite live region at `apps/web/src/components/load-more.tsx:155` through `apps/web/src/components/load-more.tsx:167`; empty filtered galleries expose a clear-filter link with `min-h-11` at `apps/web/src/components/home-client.tsx:430` through `apps/web/src/components/home-client.tsx:445`; upload no-topic/skipped-file/progress/file-error states use `role="status"`, `aria-live`, `role="progressbar"`, and `role="alert"` at `apps/web/src/components/upload-dropzone.tsx:373` through `apps/web/src/components/upload-dropzone.tsx:383`, `apps/web/src/components/upload-dropzone.tsx:456` through `apps/web/src/components/upload-dropzone.tsx:458`, `apps/web/src/components/upload-dropzone.tsx:469` through `apps/web/src/components/upload-dropzone.tsx:478`, and `apps/web/src/components/upload-dropzone.tsx:568` through `apps/web/src/components/upload-dropzone.tsx:570`.

## Deferred Not Re-Raised

- `C80-06`: `site-config.json` runtime/build-time contract. No operator-contract decision was visible in this designer lane.
- `C77-ARCH-01`: restore maintenance foreground admin mutation barrier. Out of scope for UI unless a visible admin maintenance flow changes.
- `C76-04`: bottom-sheet dropdown portal runtime coverage. No exit criterion was hit in this cycle.
- `C76-05`: `getImageProcessingState` processed-predicate behavior coverage. No new UI evidence changed its status.
- `C75-08`: bulk-edit validation alert association. No reviewed Cycle 84 delta touched that surface.
- Historical performance, semantic-search, settings re-encode, shared-view, browser-matrix, mobile filter hierarchy, and admin responsive ergonomics items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.

## Validation

- Playwright browser/DOM checks against deployed `https://gallery.atik.kr/en` for desktop and mobile public search/touch-target evidence.
- Protected dashboard retry-panel browser check attempted against deployed admin route; redirected to login, so no credential-gated admin DOM evidence was used.
- Focused tests run and passed: `npm test --workspace=apps/web -- --run src/__tests__/failed-image-retry.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/cycle-21-source-contracts.test.ts src/__tests__/photo-title.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/touch-target-audit.test.ts` - 6 files passed, 66 tests passed.
- Not run: full lint, typecheck, build, full Vitest, Playwright e2e, or deploy. This was a read-only designer/accessibility review lane.
