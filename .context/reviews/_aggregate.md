# Aggregate Review — Cycle 1

## Summary
- Reviewed per-agent outputs across code quality, performance, security, architecture, testing, UX, docs, tracing, and verification.
- **New findings this cycle:** 4
- **Implement this cycle:** 2 small/high-confidence performance fixes
- **Defer with explicit exit criteria:** 2 larger architectural performance items

## Cross-agent signal map
- **AGG-01** was independently flagged by **code-reviewer, perf-reviewer, critic, and architect**.
- **AGG-02** was independently flagged by **code-reviewer and perf-reviewer**.
- **AGG-03** and **AGG-04** were primarily surfaced by **perf-reviewer**, with critic support for the general scalability concern.

## Deduped findings

### AGG-01 — Shared public-route topic data is not request-cached
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Source agents:** code-reviewer, perf-reviewer, critic, architect
- **Citations:** `apps/web/src/lib/data.ts:202-204, 786-790`, `apps/web/src/components/nav.tsx:2-8`, `apps/web/src/app/[locale]/(public)/page.tsx:82-84`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-120`
- **Why it matters:** The public layout/nav and page bodies fetch the same topics dataset through an uncached helper on the highest-traffic routes, despite the repo already using `cache()` for similar SSR dedupe cases.
- **Concrete failure scenario:** Cache misses or crawler traffic cause avoidable duplicate topic queries during a single public request.
- **Suggested fix:** Add `getTopicsCached` and switch shared public render paths to it.
- **Disposition:** Implement this cycle.

### AGG-02 — Photo viewer overstates image display width when the desktop info panel is open
- **Severity:** LOW
- **Confidence:** HIGH
- **Source agents:** code-reviewer, perf-reviewer
- **Citations:** `apps/web/src/components/photo-viewer.tsx:202-223`
- **Why it matters:** The browser is told to assume full-viewport image width even when the desktop sidebar narrows the actual image pane.
- **Concrete failure scenario:** Desktop viewers download a larger AVIF/WebP derivative than needed, increasing bandwidth and decode work.
- **Suggested fix:** Use a sidebar-aware `sizes` string and regression-test the helper that computes it.
- **Disposition:** Implement this cycle.

### AGG-03 — Infinite-scroll listings still scale with `OFFSET` discard work
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Source agents:** perf-reviewer
- **Citations:** `apps/web/src/lib/data.ts:314-330, 337-377`, `apps/web/src/components/load-more.tsx:29-43`, `apps/web/src/app/actions/public.ts:10-23`
- **Why it matters:** Later pages become progressively more expensive because MySQL must walk and discard prior rows before returning the next slice.
- **Concrete failure scenario:** Large galleries get slower the farther a visitor scrolls, increasing DB CPU under concurrent browsing.
- **Suggested fix:** Replace offset pagination with cursor/seek pagination using the existing sort tuple.
- **Disposition:** Defer this cycle; requires API/UI contract changes.

### AGG-04 — Search still performs broad wildcard scans and up to three DB queries per debounced request
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Source agents:** perf-reviewer, critic
- **Citations:** `apps/web/src/lib/data.ts:664-770`, `apps/web/src/app/actions/public.ts:26-100`, `apps/web/src/components/search.tsx:40-80`
- **Why it matters:** The client discards stale responses only after the server has already executed repeated `%term%` scans across several columns.
- **Concrete failure scenario:** A few users typing quickly into search create repeated broad scans on hot public traffic.
- **Suggested fix:** Plan an indexed search strategy plus stronger request coalescing/cancellation.
- **Disposition:** Defer this cycle; larger architectural/data-model work.

## No-new-finding agents
- security-reviewer
- verifier
- test-engineer
- debugger
- designer
- document-specialist
- tracer

## Agent failures
- `document-specialist`: initial run hung; retry also failed to return before timeout and was closed. The review surface was reconciled manually by the leader and written to `./.context/reviews/document-specialist.md`.
- `tracer`: initial run hung; retry also failed to return before timeout and was closed. The traced flows were reconciled manually by the leader and written to `./.context/reviews/tracer.md`.

## Notes
- Earlier cycle-1 findings around forwarded-header trust, keyboard-only photo-nav visibility, and Playwright standalone startup were verified as already fixed in the current checkout and were intentionally excluded from this cycle's aggregate.
