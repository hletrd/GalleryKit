# Cycle 75/100 Deferred Findings

## New Deferred Findings

### C75-08 - Bulk-edit validation alert is not associated with the failing field

- Original severity: Low
- Original confidence: Medium
- Citations: `apps/web/src/components/bulk-edit-dialog.tsx:116`, `apps/web/src/components/bulk-edit-dialog.tsx:187`, `apps/web/src/components/bulk-edit-dialog.tsx:212`, `apps/web/src/components/bulk-edit-dialog.tsx:233`, `apps/web/src/components/bulk-edit-dialog.tsx:294`
- Reason for deferral: admin-only form polish with lower confidence and lower user-facing risk than the scheduled cache correctness, OG performance, and modal focus fixes. This is not a security, correctness, or data-loss finding; it remains a screen-reader ergonomics improvement for client-side validation.
- Exit criterion: reopen when touching `bulk-edit-dialog.tsx`, when an accessibility pass targets admin form validation, or when user/admin feedback reports difficulty locating the invalid bulk-edit field after Apply.

## Carry-forward Deferred Items

The following previously deferred items remain open with their original severity/confidence, reasons, and exit criteria in `.context/plans/cycle-73-2026-07-01-deferred.md` and later carry-forward registers:

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

This file does not downgrade or replace those records; it points to the authoritative carry-forward registers because no Cycle 75 review evidence changed their severity or exit criteria.
