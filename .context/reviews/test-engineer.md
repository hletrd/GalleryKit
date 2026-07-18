# Cycle 1 Test-Engineer Review

Date: 2026-07-18 KST
Start HEAD: `64f6ac63`

## Inventory

Reviewed configured scripts in root/web `package.json`, CI workflows, all `apps/web/src/__tests__/*.test.*` categories, Playwright specs/config/helpers, recent source-contract tests, migration/deploy contract tests, and the current review/deferred registers. Cross-checked the live public navigation with the browser at desktop, 393 px, and 320 px.

## Finding TE-C1-01 — nav regression coverage omits the minimum reflow width and production-mode branch

- Severity: Medium
- Confidence: High
- Status: Confirmed behavioral coverage gap; same root issue as `DES-C1-01`
- Regions: `apps/web/e2e/nav-visual-check.spec.ts:40-59`; `apps/web/src/__tests__/client-source-contracts.test.ts:73-76`; `apps/web/src/components/search.tsx:381-398`
- Why it matters: the E2E nav check uses 375 px and the local smoke fixture does not prove the deployed production semantic-search branch. A source-contract test explicitly expects the branch that forces the label visible in production. Consequently all normal checks can pass while the 320 px header collapses the brand link to zero width.
- Concrete failure: production semantic search is enabled, search renders as a 143.55 px text button, and the 320 px header preserves the controls by reducing the gallery home link to a zero-width, invisible focus target.
- Suggested fix: change the production label behavior and add an E2E case at 320 px which asserts (1) the home link bounding box is non-zero, (2) no horizontal overflow, and (3) every visible nav target remains at least 44×44 and non-overlapping. Update the source-contract expectation so it guards the corrected responsive rule rather than the defect.

## Final sweep

No additional new test defect was confirmed beyond the already-recorded broader gaps (real upload fixtures, non-Chromium matrix, schema-parity integration proof, and operator-only CLIP/nginx evidence). Those remain pre-existing deferred findings and are not duplicated as new work here.
