# Plan 68-Deferred — Deferred Items (Cycle 22)

**Created:** 2026-04-19 (Cycle 22)
**Status:** Deferred

## Deferred Findings

### C22-01: handleCreate/handleUpdate in topic-manager.tsx — no finally block to reset loading state
- **File+Line:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 58-71, 73-86
- **Severity/Confidence:** LOW / HIGH
- **Reason for deferral:** Not a bug — the behavior is intentional. catch blocks show error toasts and keep the dialog open for retry, consistent with the rest of the codebase. No loading state variable is used for these handlers.
- **Exit criterion:** If a future refactor introduces a loading state for these handlers, the finally block should be added at that time.

### C22-04: searchImagesAction in-memory counter can exceed SEARCH_MAX_REQUESTS by 1
- **File+Line:** `apps/web/src/app/actions/public.ts`, lines 24-88
- **Severity/Confidence:** LOW / MEDIUM
- **Reason for deferral:** The overage is at most 1 request per concurrent burst. The DB-backed check is the authoritative source of truth and prevents the actual limit from being meaningfully exceeded. The complexity of fixing this (e.g., with atomic compare-and-swap) is not proportional to the benefit for a non-critical rate limit.
- **Exit criterion:** If search becomes a performance or abuse concern, revisit with a more robust concurrent rate limiter.

## Carry-Forward from Previous Cycles

All 17 previously deferred items remain deferred with no change in status (see cycle 14 aggregate for full list).
