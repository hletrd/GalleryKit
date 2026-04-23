# Plan 204 — Deferred Performance Findings (Cycle 1)

**Status:** TODO / DEFERRED
**Source review:** `.context/reviews/_aggregate.md`
**Purpose:** Record the reviewed-but-not-implemented performance findings from this cycle. No new ideas are introduced here; this file only tracks existing review findings.

## Deferred findings

### AGG-03 — Infinite-scroll listings still scale with `OFFSET` discard work
- **Original severity:** MEDIUM
- **Original confidence:** HIGH
- **Citation:** `apps/web/src/lib/data.ts:314-330, 337-377`, `apps/web/src/components/load-more.tsx:29-43`, `apps/web/src/app/actions/public.ts:10-23`
- **Reason for deferral:** Converting the public/admin listing surfaces to cursor pagination changes API/UI contracts, pagination state, and test coverage across multiple flows. That exceeds the safe scope of this cycle, which is focused on smaller verified wins plus full gate execution.
- **Exit criterion to reopen:** A follow-up cycle is dedicated to pagination contract changes and can update server actions, `LoadMore`, and regression coverage together.

### AGG-04 — Search still performs broad wildcard scans and up to three DB queries per debounced request
- **Original severity:** MEDIUM
- **Original confidence:** HIGH
- **Citation:** `apps/web/src/lib/data.ts:664-770`, `apps/web/src/app/actions/public.ts:26-100`, `apps/web/src/components/search.tsx:40-80`
- **Reason for deferral:** A credible fix requires an indexed search design (for example FULLTEXT or another selective strategy) plus a revised request model; that is larger architectural work than this cycle can safely complete while also honoring the full gate suite.
- **Exit criterion to reopen:** A follow-up cycle scopes and approves an indexed search approach, associated schema/runtime changes, and matching UI/test updates.
