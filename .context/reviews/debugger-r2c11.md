# Debugger — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Latent bug surface, failure modes, regressions, race conditions
**Scope**: Runtime behavior, async flows, error paths, state consistency

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-DEBUG-01: Semantic search rate limit leaks on validation failures
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 76-122)
**Severity**: Medium | **Confidence**: High

The rate-limit counter is incremented before body validation, semantic-enabled check, and query-length check. Any request rejected for these reasons permanently consumes one unit of the 30 req/min budget. During a sustained invalid-request attack, legitimate users are locked out.

**Failure mode**: A script sends 30 requests with `{}` body every 60 seconds. Every legitimate user's valid request gets 429 even though zero semantic search work was ever done.

**Suggested fix**: Move rate-limit consumption to after all cheap validation gates, or implement rollback.

### C11-DEBUG-02: `data.ts` viewCountRetryCount double-prune edge case
**File**: `apps/web/src/lib/data.ts` (lines 146-167)
**Severity**: Low | **Confidence**: High

When `viewCountBuffer.size === 0` AND `viewCountRetryCount.size > MAX_VIEW_COUNT_RETRY_SIZE`, both prune paths execute. The first clears the Map; the second iterates over an empty Map. Result is correct (empty Map) but the redundant logic is a latent maintenance hazard.

**Suggested fix**: Use `else if` to make the mutual exclusion explicit.

### C11-DEBUG-03: Lightbox `previouslyFocusedRef` focus on detached element
**File**: `apps/web/src/components/lightbox.tsx` (lines 364-374)
**Severity**: Low | **Confidence**: Medium

If the lightbox is unmounted after a route change, `previouslyFocusedRef.current` may point to a DOM node that no longer exists. Most browsers silently ignore `.focus()` on detached nodes, but some configurations or assistive technologies may log warnings or shift focus unexpectedly.

**Suggested fix**: Add a `document.body.contains()` guard.

### C11-DEBUG-04: Semantic search `request.json()` can throw on malformed JSON
**File**: `apps/web/src/app/api/search/semantic/route.ts` (line 104)
**Severity**: Low | **Confidence**: High

The `try/catch` at lines 103-118 catches JSON parse errors, but the rate limit has already been consumed at line 80. A client can force-parse errors (e.g., by sending truncated JSON) to burn rate-limit budget.

**Suggested fix**: Same as C11-DEBUG-01 — validate before consuming rate limit.

## Final Sweep
No additional latent bugs found after tracing all async error paths and state mutation sequences.
