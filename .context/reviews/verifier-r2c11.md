# Verifier — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Evidence-based correctness check against stated behavior
**Scope**: Claims in CLAUDE.md, code comments, and docstrings vs. actual code behavior

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-VERIFY-01: Semantic search rate-limit pattern deviates from documented convention
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 40-59)
**Severity**: Medium | **Confidence**: High

`rate-limit.ts` documents three rollback patterns. Pattern 2 ("rollback on infrastructure error") applies to public read paths. The semantic search route is a public read path but does NOT implement rollback on validation failures. The code comment at the top of `semantic/route.ts` says "Rate-limit: 30 requests / min / IP (in-memory, ResetAt pattern)" but does not document the deviation from the established rollback convention.

**Evidence**: Compare with `loadMoreImages` (Pattern 2, rollback on error) and `searchImagesAction` (Pattern 2, rollback on error). Semantic search consumes the budget without rollback.

### C11-VERIFY-02: `data.ts` comment about viewCountRetryCount pruning doesn't match code
**File**: `apps/web/src/lib/data.ts` (lines 141-167)
**Severity**: Low | **Confidence**: High

The comment at line 141 says "Entries whose group IDs are no longer in the buffer (and are not being actively re-buffered) are leftover from deleted groups or from retries that succeeded on a later flush." This describes a selective pruning strategy. But the actual code at line 147 does `viewCountRetryCount.clear()` — an unconditional clear of the entire Map. The comment is stale from a previous selective-pruning implementation.

**Suggested fix**: Update the comment to match the actual unconditional-clear behavior.

### C11-VERIFY-03: `process-image.ts` comment claims GPS is stripped but function is best-effort
**File**: `apps/web/src/lib/process-image.ts` (lines 967-989)
**Severity**: Low | **Confidence**: Medium

The docstring at line 953 says "This function re-writes the original in-place... while stripping GPS." But the actual implementation catches errors and logs them, leaving the original file unchanged on failure. The comment "Non-fatal: log and continue" at line 983 is accurate, but the opening docstring over-promises.

**Suggested fix**: Update the docstring to say "best-effort" or "attempts to strip".

## Final Sweep
All other code comments match behavior. No additional mismatches found.
