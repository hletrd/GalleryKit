# Cycle 10 — perf-reviewer

Reviewed HEAD: `1e3646e3` (2026-07-18)

## Inventory and method

The inventory covered all 946 review-relevant files, with a performance pass across request-time data access, image encode/delivery, public SSR payloads, queue/background concurrency, timers and bounded collections, DB query/index pairs, semantic scan limits, service-worker accounting, and Docker/runtime limits. I examined every file in the newest source diff and traced its callers and tests. Existing documented limits (single writer, pool 10/queue 20, bounded CLIP scans, multipart heap cost, map scale, background pool overlap) were not refiled without a fired exit criterion.

## Finding PERF-C10-01 — completed ladders publish redundant false-width candidates

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed; same root cause as CORE-C10-01**
- Regions: `apps/web/src/lib/process-image.ts:1212-1234`; `apps/web/src/lib/image-url.ts:91-95`; new grid consumers `apps/web/src/components/masonry-card.tsx:91-108`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:255-271`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:214-231`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:217-234`.
- Evidence: for a source narrower than multiple configured sizes, the encoder renders once then hard-links/copies that same output for every larger suffix. The helper emits all one-to-eight suffixes per format while advertising each suffix as a distinct intrinsic width. Thus up to three formats × several duplicate candidates × every card are serialized into HTML even though the bytes collapse to one actual resolution.
- Concrete failure: a 100-photo gallery of 1000 px originals with the six-size default emits 1,800 candidate entries across AVIF/WebP/JPEG. Four or five candidates per format point to identical-resolution bytes but carry different `w` values. This increases SSR/RSC/HTML transfer and parse work, and the browser's resource selection is driven by overstated widths. The regression test at `image-url.test.ts:110-136` verifies suffix completeness, not actual-width uniqueness or browser-correct descriptors.
- Fix: expose effective derivative width from processing, collapse equal-width candidates before markup generation, and use their actual widths as descriptors. Retain a single maximum-quality capped candidate. Add a small-source browser/metadata test and a bounded-markup assertion.

## Non-findings validated

- The detached-config generation/owner additions are constant-space and maintain in-flight dedupe (`gallery-config.ts:234-282`).
- The responsive `sizes` caps and full ladder solve the prior valid-large-derivative omission for sufficiently large originals; the new problem is the unmodelled lower processed-width ceiling, not a reason to restore positional truncation.
- Module Maps/Sets on reviewed request/background paths are bounded, drained, or documented best-effort state. No new unbounded collection was introduced by the last three commits.
- No new unindexed query, synchronous request-path filesystem operation, queue-concurrency increase, or encode fan-out increase was introduced.

## Final sweep

I cross-checked all five `sizedImageSrcSet` callers, the hard-link duplicate branch, responsive width policies, queue pool budgeting, maintenance drains, and large-list queries. No second new performance defect met the evidence threshold.
