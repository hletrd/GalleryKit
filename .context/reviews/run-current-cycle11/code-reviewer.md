# Cycle 11 — code-reviewer

Reviewed HEAD: `7e40e95c` (2026-07-18)

## Inventory and coverage

The tracked inventory contains 3,679 files. I treated the 631 implementation files under `apps/web/src` (81 App Router/action files, 116 library modules, 61 components, and 370 unit-test/fixture files), 29 application scripts, 16 Playwright specs, 35 migration/journal files, root/application build and deploy configuration, `AGENTS.md`, all 771 lines of `CLAUDE.md`, and the current plan/review ledgers as review-relevant. The 2,392-file historical review corpus was filename/ID indexed; I then read the Cycle 10 six-role provenance, aggregate/plan, consolidated carry-forward register, and the authoritative home records for matching open findings so closed findings were not refiled.

Coverage was systematic rather than a sample: repository-wide searches covered exports/guards, raw SQL and child processes, filesystem writes, timers/fire-and-forget work, mutable module state, suppressions/exemptions, all `processImageFormats` callers, every `derivative_max_width` producer/projection/consumer, and every `sizedImageSrcSet` call. I also reviewed the complete source diff since Cycle 10's start. Validation was green: ESLint, the API-auth/action-origin/public-route-rate-limit gates, full typecheck, and 3,447 unit tests (363 files passed, two skipped).

## Finding CODE-C11-01 — persisted “maximum delivered width” can exceed every delivered file

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Regions: `apps/web/src/lib/process-image.ts:1044-1046,1214-1219,1366-1377,1462-1465`; schema contract at `apps/web/src/db/schema.ts:79-85`; public documentation at `CLAUDE.md:189-190`; consumer at `apps/web/src/lib/image-url.ts:96-145`.
- Evidence: the encoder renders only `sortedSizes`. Each output width is `min(processingBaseWidth, size)`, and the unsuffixed base file is linked from the largest configured size. The returned `derivativeMaxWidth`, however, is the uncapped `processingBaseWidth`. Therefore, when the source is wider than the largest configured size, the stored value is not the maximum pixel width of the derivative set as its schema name and documentation claim.
- Concrete failure: with a 10,000 px source and the default ladder ending at 7,680, every AVIF/WebP/JPEG derivative and the base file tops out at 7,680 px, but `image_queue` persists `derivative_max_width=10000`. Current `srcset` output happens to remain standards-correct because `sizedImageCandidates` iterates only configured aliases, but the public field itself lies and any API/UI/future selection policy that consumes it as the documented maximum overstates deliverable resolution.
- Fix: return `Math.min(processingBaseWidth, sortedSizes[sortedSizes.length - 1])` (using an explicit validated non-empty ladder invariant), persist that value in upload and both backfill paths, and add a real encoder test whose source is wider than the largest configured size. The test should inspect the generated base/sized files with Sharp and assert the returned/persisted maximum equals the largest decoded width.

## Final missed-issue sweep

I rechecked both upload paths, queue retries, the two backfill update shapes including detection-failure handling, public/admin/timeline privacy projections, all five responsive presentation surfaces, migration/journal/reconcile parity, detached-config ownership cleanup, delete-during-reencode cleanup, and current open carry-forward triggers. No second new code defect met the evidence threshold. In particular, the Cycle 10 fix correctly deduplicates source-limited `srcset` aliases and falls back to the base JPEG when the legacy WI-15 maximum is unknowable.
