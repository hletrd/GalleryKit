# Architect Review — Cycle 1 (New Loop)

**Reviewer:** Architecture, design risks, coupling, layering
**Date:** 2026-04-19

## Methodology
- Analyzed module dependency graph
- Reviewed separation of concerns between data layer, actions, and components
- Checked for coupling issues and circular dependencies
- Evaluated error handling patterns across layers
- Reviewed the barrel re-export pattern in actions.ts

## Findings

### C1N-17: `actions/images.ts` directly imports from `@/lib/process-image` creating tight coupling between the action layer and the image processing internals [LOW, Low Confidence]
**File:** `apps/web/src/app/actions/images.ts:7`
**Problem:** The `uploadImages` action directly imports `saveOriginalAndGetMetadata`, `extractExifForDb`, `deleteImageVariants`, and upload directory constants from `process-image.ts`. This couples the action layer to the internal implementation details of image processing. If the processing pipeline changes (e.g., moving to a job queue with different metadata extraction), the action would need to change too.
**Impact:** Low — the current architecture works well and the coupling is pragmatic. The image processing is unlikely to change its core interface significantly.
**Suggested fix:** Consider extracting an `ImageProcessingService` interface, but only if the processing pipeline is expected to change.

### C1N-18: In-memory rate limit Maps in multiple files create scattered state management [LOW, Low Confidence]
**Files:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/images.ts:21`, `apps/web/src/app/actions/sharing.ts:22`
**Problem:** Rate limiting state (in-memory Maps) is spread across 4 different files with 4 different Map implementations. Each has its own pruning logic, window parameters, and cap sizes. This makes it difficult to reason about the total memory footprint and ensure consistent eviction policies.
**Impact:** Low — each Map serves a distinct purpose and the caps prevent unbounded growth. But the pattern is not DRY and a new rate limit requirement would copy-paste the same boilerplate.
**Suggested fix:** Consider a generic `RateLimitMap<K>` class that encapsulates pruning, caps, and window logic. But only if more rate limits are expected.

### C1N-19: `data.ts` module-level mutable state (viewCountBuffer, viewCountFlushTimer, isFlushing) is not encapsulated [LOW, Low Confidence]
**File:** `apps/web/src/lib/data.ts:8-26`
**Problem:** The view count buffering system uses module-level `let` variables (`viewCountFlushTimer`, `isFlushing`) and a `Map`. These are global mutable state without encapsulation. Testing or replacing this subsystem would require module-level mocking.
**Impact:** Low — the system works correctly and the state is contained within the module.
**Suggested fix:** Consider wrapping in a class for testability, but only if the system needs to be unit-tested.

## No-New-Findings Items
- **Barrel re-export pattern** in `actions.ts` is clean and maintains backward compatibility
- **Data layer** properly separates public queries (selectFields without PII) from admin queries
- **React cache()** correctly used for SSR deduplication
- **Queue architecture** (PQueue + MySQL advisory locks) is appropriate for the workload
- **i18n integration** is well-structured with localized revalidation
