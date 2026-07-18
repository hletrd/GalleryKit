# Tracer — Cycle 6 Provenance

Review target: `6e4c25c8`; review only.

## End-to-end traces

### NEW TRC-C6-01 — Sparse home geometry splits at `itemCount`

- Severity / confidence: **Medium / High**
- Status: **Confirmed live mismatch; visible relayout manual-validation**
- Regions: `home-client.tsx:27-79,231-274` → `masonry-card.tsx:52-77` → `globals.css:231-235`
- Trace: route loads two filtered rows → `allImages.length=2` → class policy emits two effective columns and `getMainMasonrySizes(2)` emits `50vw` → `useColumnCount(1536)` independently reports five → intrinsic estimate uses five-column width → live card computes `744×496` but `contain-intrinsic-size:auto 196px`.
- Failure: a deferred/offscreen sparse grid initially contributes the undersized stand-in to document geometry and grows when activated.
- Fix: carry one effective-column result through classes, sizes, and containment; optionally replace viewport math with grid `ResizeObserver` evidence.

### NEW TRC-C6-02 — Cycle 5 terminal state stops before its pushed HEAD

- Severity / confidence: **Low / High**
- Status: **Confirmed signed push; exact deploy SHA manual-validation**
- Regions: `.context/plans/cycle-5-2026-07-18-plan.md:3-5,47-49,70-78`; `.context/plans/README.md:34-40`; Git refs/commits `baec70b5`, `45a9417f`, `6e4c25c8`
- Trace: implementation/test commits are signed → docs commit records “signed release pending” → `master == origin/master == 6e4c25c8` and all three signatures verify → production serves the new `sizes` string → plan/index still present Cycle 5 as active with push/deploy unchecked.
- Failure: recovery treats already-published work as pending and may repeat release actions.
- Fix: reconcile signed push after publication, record live verification separately from unavailable exact deploy identity, archive Cycle 5, and advance the active index.

## Revalidated traces and final coverage

Cycle 5 breakpoint flow now aligns at 640/768/1280/1536, and eager/high scheduling stays first-card-only. I traced public/admin request guards, DB/file upload-delete-restore lifecycles, queue/backfill concurrency, migration/journal/reconcile, cache/PWA/config, image fallback, and release promotion. Existing topology/restore/pool risks retain prior IDs; no additional new trace survived.
