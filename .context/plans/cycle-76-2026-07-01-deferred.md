# Cycle 76/100 Deferred Findings

## New Deferred Findings

### C76-04 - Bottom-sheet dropdown portal coverage is source-shaped only

- Original severity: Low
- Original confidence: High
- Citations: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:15`
- Reason for deferral: test-depth improvement only. The Cycle 75 source-lock and touch-target/i18n checks passed, and the repo currently relies heavily on source-contract tests without a shared React Testing Library component harness. This is not a security, correctness, or data-loss finding.
- Exit criterion: reopen when adding DOM component-test infrastructure, when touching `InfoBottomSheet`/dropdown portal wiring, or when a browser/focus regression is reported.

### C76-05 - `getImageProcessingState` test would miss a processed-predicate drift

- Original severity: Low
- Original confidence: Medium
- Citations: `apps/web/src/__tests__/image-processing-state-data.test.ts:42`, `apps/web/src/__tests__/og-photo-fallback.test.ts:98`, `apps/web/src/lib/data.ts:1204`
- Reason for deferral: low-risk test hardening. The helper currently has direct behavior coverage plus a source guard against the known `processed=true` regression; broadening it to AST/integration-style query coverage is less valuable this cycle than fixing the confirmed backfill data-loss-adjacent misclassification. This is not a security, correctness, or data-loss finding in current code because the implementation currently selects by id only.
- Exit criterion: reopen when touching `getImageProcessingState`, route fallback caching for pending photos, or Drizzle query-test infrastructure.

## Carry-forward Deferred Items

The following previously deferred items remain open with their original severity/confidence, reasons, and exit criteria in their authoritative files:

- `C75-08` - Bulk-edit validation alert is not associated with the failing field (`.context/plans/cycle-75-2026-07-01-deferred.md`).
- `C73-05` - Sidecar derivative write-boundary guard is source-locked, not behavior-proven.
- `C73-06` - Settings backfill warning persistence is only source-wired at the component boundary.
- `C72-06` - Browser matrix invariants are mostly mocked, not engine-smoked.
- `C65-02` - Settings-only re-encode obligation disappears after page reload.
- `C61-06` - Shared-group view-count flush race logic lacks behavioral coverage.
- `C61-07` - Lightroom upload route remains mostly source-contract covered.
- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps.
- `TV-40-03` - JavaScript operational scripts need semantic checking.
- `PERF-C39-03` - feed and sitemap updated-time indexes.
- `PERF-C39-04` - backfill pipeline-version indexes.
- `AGG-C38-07` - broad imported-helper side-effect classification.
- `AGG-C38-08` - sidecar keyset pagination.

This file does not downgrade or replace those records.
