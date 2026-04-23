# Aggregate Review — Cycle 2/100 (2026-04-23)

## Agent coverage
Requested reviewers were executed with rolling retries because the Agent tool hit a `max 6` thread limit when the initial single-batch fan-out was attempted. Completed reviewer outputs exist for:
- code-reviewer
- security-reviewer
- critic
- verifier
- test-engineer
- architect
- debugger
- designer
- perf-reviewer
- tracer
- document-specialist

## Aggregation method
I deduped repeated claims across reviewer outputs, then re-verified each claim directly against current HEAD before keeping it. Several repeated subagent claims were stale and did **not** match the current code, so they are called out separately below instead of being treated as actionable findings.

## CONFIRMED FINDINGS

### C2R2-01 — Metadata tag validation still inserts an avoidable async hop on tag-filtered public pages
- **Severity:** LOW
- **Confidence:** HIGH
- **Cross-agent agreement:** High (broad SSR-latency concern was independently raised by code-reviewer, critic, verifier, architect, debugger, perf-reviewer, and tracer; local validation narrowed the real issue to the metadata tag lookup paths below).
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:18-29`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-36`
- **Why it is a problem:** Both `generateMetadata` implementations wait for the initial `Promise.all(...)` to finish and only then start `getTagsCached(...)` when tag filters are present. That extra await is small, but it is still unnecessary work on SEO-critical requests.
- **Concrete failure scenario:** Requests like `/en?tags=portrait` and `/en/travel?tags=seoul` pay an extra round-trip before metadata can finish, increasing TTFB for crawlers and first render on cold paths.
- **Suggested fix:** Start the tag lookup promise earlier (or compose it off the existing topic lookup promise) so tag validation overlaps with the other metadata reads.

### C2R2-02 — Static icon routes are forced onto Edge runtime, which disables static generation and emits a build warning every release
- **Severity:** LOW
- **Confidence:** HIGH
- **Cross-agent agreement:** Manual validation finding (not surfaced correctly by subagents).
- **Files:** `apps/web/src/app/apple-icon.tsx:2-5`, `apps/web/src/app/icon.tsx:2-6`
- **Why it is a problem:** Both routes render fixed SVG-to-PNG icons with no request-dependent data, but `export const runtime = 'edge'` forces them dynamic. `next build` currently warns: `Using edge runtime on a page currently disables static generation for that page`.
- **Concrete failure scenario:** Every production build keeps emitting the warning, and icon requests lose the benefits of build-time generation/caching for no product gain.
- **Suggested fix:** Remove the explicit Edge runtime from the static icon routes so Next can statically generate them.

## INVALIDATED / STALE REVIEW CLAIMS

### I2R2-01 — “Load-more lacks an explicit hasMore contract” is stale and not reproducible on current HEAD
- **Original sources:** code-reviewer, critic, verifier, test-engineer, architect, debugger, designer, perf-reviewer, tracer
- **Original severity/confidence:** LOW / HIGH (MEDIUM confidence from designer)
- **Why it is invalid now:** `loadMoreImages()` already overfetches one row and returns `{ images, hasMore }` (`apps/web/src/app/actions/public.ts:11-25`), and the exact-multiple termination case is already locked by `apps/web/src/__tests__/public-actions.test.ts:89-99`.
- **Re-open condition:** Only reopen if the server action stops returning `hasMore`, or a reproduced UI trace shows redundant terminal fetches despite the current contract.

### I2R2-02 — The broad “public pages still serialize all independent reads” claim overstates the current code
- **Original sources:** code-reviewer, critic, verifier, architect, debugger, perf-reviewer, tracer
- **Original severity/confidence:** MEDIUM / HIGH
- **Why it is invalid as written:** The cited route bodies already use `Promise.all(...)` for the major public-page read groups (`apps/web/src/app/[locale]/(public)/page.tsx:95-101`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:109-114`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-110`). The real remaining issue is narrower: the metadata tag-validation hop called out in C2R2-01.
- **Re-open condition:** Reopen if new profiling shows other specific route segments regressing to serialized fetches with exact file/line evidence.

## AGENT FAILURES / EXECUTION NOTES
- Initial single-batch spawn attempt hit the platform limit `collab spawn failed: agent thread limit reached (max 6)`.
- No unresolved reviewer failures remained after rolling retries; all requested reviewer outputs were produced.
- Several reviewer outputs appear to have copied stale cycle-6 conclusions without fully reconciling them against current HEAD, so local re-validation was required before aggregation.

## Final actionable count
- **Confirmed actionable findings:** 2
- **Invalidated stale findings:** 2 aggregated buckets (covering the repeated false-positive reviewer claims)
