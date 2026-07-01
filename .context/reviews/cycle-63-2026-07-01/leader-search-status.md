# Cycle 63 Leader Search Status Review

Reviewer: leader aggregation lane
Date: 2026-07-01
Start HEAD: `ecfda466cab14cd6a9ffbe03e6dc7d42023c8e82`

## Scope

This pass rechecked the only newly deferred Cycle 62 UX item, `C62-04`, while waiting for the Cycle 63 fan-out lanes. The goal was to decide whether new evidence changed its scheduling.

Files reviewed:

- `apps/web/src/components/search.tsx`
- `apps/web/src/__tests__/search-disclaimer.test.ts`
- `apps/web/src/__tests__/search-stale-response.test.ts`
- `apps/web/src/__tests__/search-semantic-toggle-source.test.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

## Finding

### C63-01 - Search dialog shows stale or premature status for the current query

- Severity: Low
- Confidence: High
- File/line: `apps/web/src/components/search.tsx:240`, `apps/web/src/components/search.tsx:405`, `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:473`.
- Evidence:
  - The input `onChange` only updates `query` and `activeIndex`; it does not invalidate `requestIdRef`, abort an in-flight semantic request, clear prior `results`, or mark the result set as belonging to a completed query.
  - During the 300 ms debounce window, `query.trim()` is true while `loading` is still false and `results.length` can be `0`, so the visible empty-state branch renders `search.noResults` before the new query has run.
  - If an old keyword search is in flight and the visitor types a new query before the next debounced search starts, the old response can still satisfy `requestId === requestIdRef.current` and render results for the previous query.
  - The same dynamic empty/error/status message is still exposed through both the `sr-only` live region and the visible status block, which was the original `C62-04` accessibility-polish finding.
- Failure scenario: a visitor types or edits a search query and briefly sees or hears "No results" before the request has run, or sees results from the previous query until the debounce/new request completes. Assistive technology users can also receive duplicate announcements for the same terminal state.
- Fix direction: track the query string that owns the settled result/status state, invalidate stale requests immediately on input changes, and give each search state a single announcement source: hidden live text for loading/result counts, visible live status for empty/error/rate-limit/maintenance states.

## Deferred Handling

`C62-04` is not carried forward separately. `C63-01` supersedes it with stronger behavior evidence and is scheduled for Cycle 63 implementation.
