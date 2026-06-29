# Cycle 5/100 Deferred Findings - 2026-06-29

Status: DEFERRED
Review source: `.context/reviews/_aggregate.md`

This file records cycle 5 findings that are not scheduled for implementation in `cycle-5-2026-06-29-plan.md`. Original severity/confidence is preserved. Deferred work remains bound by repo policy: GPG-signed conventional gitmoji commits, no force-push/no bypass flags, required quality gates, and repo migration/deploy rules.

## Deferred Items

### D-C5-10 - Timeline and On-This-Day use non-sargable date functions

- Original finding: AGG-C5-10
- Citation: `apps/web/src/lib/data-timeline.ts:97`, `:129`, `:186`; `apps/web/src/components/on-this-day-widget.tsx:14`; `apps/web/src/db/schema.ts:111`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance-only schema/query optimization. Fixing well requires either generated/indexed date parts or a derived timeline table, plus migration/journal/reconcile updates. It is not a correctness, security, or data-loss finding.
- Exit criterion: Library-size or slow-query evidence on timeline/year/home date widgets, or an approved schema-performance cycle for generated date indexes.

### D-C5-11 - Public map can fetch/render 10,000 markers

- Original finding: AGG-C5-11
- Citation: `apps/web/src/lib/data.ts:1642`; `apps/web/src/app/[locale]/(public)/map/page.tsx:8`; `apps/web/src/components/map-client.tsx:76`; `apps/web/src/db/schema.ts:111`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance/UX scalability optimization requiring map clustering or bounds-based API design. It is not a current correctness/security/data-loss defect.
- Exit criterion: Public map latency/main-thread evidence with large GPS libraries, or a planned map clustering/bounds-fetching feature cycle.

### D-C5-12 - Production CLIP embedding escapes queue backpressure

- Original finding: AGG-C5-12
- Citation: `apps/web/src/lib/image-queue.ts:204`, `:470`, `:490`; `apps/web/src/lib/clip-model.ts:151`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance/backpressure architecture work. A correct fix needs a bounded embedding queue and shutdown-drain contract, which is larger than the current correctness hotfix scope. It is not a data-loss finding; failed embeddings can be backfilled.
- Exit criterion: Production embedding backlog/CPU evidence, shutdown drain failures, or a dedicated semantic-search worker/backpressure cycle.

### D-C5-13 - Semantic/similar search can decode and rank up to 1,000,000 vectors

- Original finding: AGG-C5-13
- Citation: `apps/web/src/lib/clip-embeddings.ts:36`, `:104`, `:164`; `apps/web/src/app/api/search/semantic/route.ts:240`; `apps/web/src/app/api/search/similar/[id]/route.ts:141`; `apps/web/src/db/schema.ts:271`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance scalability guard. Current documented default scan limit is much lower; an ANN/vector-search migration or bounded heap ranking should be planned as search scale grows. The disabled-mode unmetered work issue is scheduled separately in the implementation plan.
- Exit criterion: Operator raises `SEMANTIC_SCAN_LIMIT` substantially, search latency/CPU evidence appears, or vector count approaches the in-process scan limit.

### D-C5-14 - Admin dashboard loads every permanently failed image

- Original finding: AGG-C5-14
- Citation: `apps/web/src/lib/data.ts:993`; `apps/web/src/db/schema.ts:108`
- Original severity/confidence: Low / High
- Reason for deferral: Low-severity admin-only performance issue requiring pagination/index design. It is not correctness, security, or data-loss.
- Exit criterion: Failed-image row count or dashboard latency makes the admin dashboard slow, or a dashboard pagination/index cycle is approved.

### D-C5-16 - Cursor pagination tests copy a looser cursor mock

- Original finding: AGG-C5-16
- Citation: `apps/web/src/__tests__/data-pagination.test.ts`; real cursor helper in `apps/web/src/lib/data.ts`
- Original severity/confidence: Medium / High
- Reason for deferral: Test-surface quality finding. The current production cursor helper is not reported as broken; fixing cleanly requires deciding whether to export private parsing helpers or move them into a testable module.
- Exit criterion: Any pagination regression, or a test-hardening cycle that extracts cursor normalization into a dedicated helper module.

### D-C5-17 - Real CLIP activation tests are opt-in/skipped in blocking CI

- Original finding: AGG-C5-17
- Citation: CLIP model activation tests under `apps/web/src/__tests__/clip-*`; `apps/web/package.json` blocking `test` script
- Original severity/confidence: Medium / Medium
- Reason for deferral: External model weights make full real-CLIP tests unsuitable for the default blocking suite. Lightweight production-mode gating remains covered and semantic model-version regression coverage is scheduled in the implementation plan.
- Exit criterion: A lightweight no-weight contract is identified, or CI gains a stable model-weight cache for opt-in real CLIP activation.

