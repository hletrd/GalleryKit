# Document Specialist — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Doc/code mismatches against authoritative sources
**Scope**: Code comments, docstrings, CLAUDE.md, README, inline documentation

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-DOC-01: `data.ts` stale comment about selective pruning
**File**: `apps/web/src/lib/data.ts` (lines 141-148)
**Severity**: Low | **Confidence**: High

The comment at lines 141-145 describes selective pruning: "Entries whose group IDs are no longer in the buffer... are leftover from deleted groups or from retries that succeeded on a later flush. Pruning prevents unbounded growth..." But the actual code at line 147 does `viewCountRetryCount.clear()` — an unconditional wipe of the entire Map when the buffer is empty. The comment describes behavior from an older implementation.

**Suggested fix**: Replace the comment with: "When the buffer is empty, all retry entries are stale — clear the entire Map."

### C11-DOC-02: `process-image.ts` over-promises GPS stripping guarantee
**File**: `apps/web/src/lib/process-image.ts` (lines 953-966)
**Severity**: Low | **Confidence**: Medium

The docstring says: "This function re-writes the original in-place... while stripping GPS." But the function catches errors and returns without modifying the original file. A reader skimming the docstring might assume GPS is always stripped.

**Suggested fix**: Prefix with "Best-effort: attempts to re-write..."

### C11-DOC-03: Semantic search route lacks Pattern 2 rollback documentation
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 16-36)
**Severity**: Low | **Confidence**: High

The module docstring describes rate limiting as "30 requests / min / IP (in-memory, ResetAt pattern)" but does not document the deviation from the project's established rollback convention (Pattern 2 for public read paths).

**Suggested fix**: Add a note: "Rate-limit consumption happens after all cheap validation gates; invalid requests do not consume budget."

## Final Sweep
No additional doc/code mismatches found.
