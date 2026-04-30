# Test Engineer — Cycle 2 review-plan-fix loop (2026-04-25)

## Lens

Did plan-301's tests provide regression seatbelts that would actually catch the real failure modes? Are any cycle-2 follow-ups testable at the unit level?

## Findings

### TE2L-LOW-01 — Underscore-normalization tests don't cover the photo-viewer chip render path

- **Files (test):** `apps/web/src/__tests__/photo-title.test.ts:64-98`
- **Files (subject):** `apps/web/src/components/photo-viewer.tsx:393-397`, `apps/web/src/components/info-bottom-sheet.tsx:241-245`
- **Severity / Confidence:** LOW / High
- **Why:** Existing tests assert `humanizeTagLabel` itself, plus that `getConcisePhotoAltText` and `getPhotoDisplayTitleFromTagNames` strip underscores. They do **not** test that the photo-viewer info sidebar or bottom-sheet renders the chip with the helper applied. As a result, the bug AGG2L-LOW-01 silently regressed past the gates. A simple component test rendering `<PhotoViewer>` with a tag named `Music_Festival` and asserting the visible chip text equals `#Music Festival` would catch it.
- **Suggested fix:** Add a vitest+RTL assertion or, if the photo-viewer is too heavy to mount, a focused snippet-level test that calls `humanizeTagLabel` on each chip render path. Tracked alongside the implementation fix.

### TE2L-LOW-02 — `buildHreflangAlternates` tests don't lock the root-layout consumer

- **Files (test):** `apps/web/src/__tests__/locale-path.test.ts:73-95`
- **Files (subject):** `apps/web/src/app/[locale]/layout.tsx:28-34`
- **Severity / Confidence:** LOW / Medium
- **Why:** The unit test covers the helper output for the supported paths, but no test asserts that the root-layout metadata uses the helper. Adding a metadata-rendering test (or simply scanning the source for `'en':` / `'ko':` literals in `app/**/*.tsx`) would have caught the missed migration.
- **Suggested fix:** After applying CR2L-LOW-01, also add a small grep-style fixture (similar to the `lint:action-origin` pattern) or, more simply, inline a test that imports the layout's `generateMetadata` and asserts `metadata.alternates?.languages` contains every entry in `LOCALES` plus `x-default`. Even a scanner that reads `apps/web/src/app/**/page.tsx` and `layout.tsx` for `'en':` literals inside `languages: { ... }` is enough. Defer if not required to land cycle 2.

## Existing test surface

- Vitest: 60 files / 402 tests passed.
- Playwright e2e: 20 passed / 1 skipped (admin opt-in skip is expected when `ADMIN_USER`/`ADMIN_PASSWORD` env not set in CI; one admin-only suite ran successfully here).

No regressions in the test surface. The two findings above are gaps that allowed plan-301 to land "partially complete" without raising a flag.
