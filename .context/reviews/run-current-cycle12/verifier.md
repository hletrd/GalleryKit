# Verifier Review — Cycle 12/100

Date: 2026-07-18
Reviewed HEAD: `ff6532f4`

## Inventory and evidence standard

The verification inventory covered every file changed since Cycle 11's review
base, their transitive callers/consumers, schema and migration mirrors, CI,
unit/E2E coverage, repository instructions, and the current deferred ledger.
Claims were accepted only when source behavior and an independent executable
or structural check agreed.

## Verified behavior

- **Delivered derivative width:** confirmed. The encoder writes each suffix
  with `resizeWidth = min(processingBaseWidth, size)`, aliases the last
  configured output as the base file, and returns
  `min(processingBaseWidth, largestConfiguredSize)`. The regression decodes
  both the base and largest suffix before comparing the returned value
  (`apps/web/src/lib/process-image.ts:1219-1231,1366-1381,1467-1479`;
  `apps/web/src/__tests__/process-image-orientation.test.ts:133-168`).
- **No search prefetch:** confirmed in source and browser contract. The result
  `Link` carries `prefetch={false}` and the Playwright listener observes no
  localized photo RSC request during a bounded populated-list window before
  activation (`apps/web/src/components/search.tsx:77-86`;
  `apps/web/e2e/public.spec.ts:62-91`).
- **Schema reconciliation:** structurally coherent. Migration, Drizzle schema,
  generated lookup query, privacy omission, and reconciliation agree on the
  two generated columns and three index shapes. The convergence script refuses
  mutation without both an explicit opt-in and a local test/CI/e2e database,
  degrades the new artifacts, restores them, and proves a second run is stable
  (`apps/web/scripts/check-schema-convergence.mjs:15-116`).

## Result and final sweep

No new correctness finding survived. I specifically challenged source-only
tests, false-green convergence, EXIF orientation, nullable dates, index order,
request timing, public-field leakage, and failure cleanup. Items requiring a
real disposable MySQL instance are appropriately proved in the configured CI
lane rather than claimed from source-text tests alone.
