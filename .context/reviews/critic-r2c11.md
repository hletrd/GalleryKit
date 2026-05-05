# Critic — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Multi-perspective critique, skepticism, "what could go wrong"
**Scope**: Entire repository

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-CRIT-01: Semantic search endpoint is an outlier in rate-limit posture
**File**: `apps/web/src/app/api/search/semantic/route.ts`
**Severity**: Medium | **Confidence**: High

The semantic search endpoint is the only public read path that consumes rate-limit budget before validation and offers no rollback. Every other public read path (`loadMoreImages`, `searchImagesAction`, OG, share, checkout) follows Pattern 2 (rollback on rejection before expensive work). This inconsistency is a footgun for future maintainers copying the semantic search pattern.

**Cross-angle agreement**: code-reviewer (C11-MED-01), security-reviewer (C11-SEC-01), debugger (C11-DEBUG-01), verifier (C11-VERIFY-01) all flag this.

### C11-CRIT-02: `ImageZoom` touch gesture implementation is fragile
**File**: `apps/web/src/components/image-zoom.tsx`
**Severity**: Low | **Confidence**: Medium

Reimplementing pinch-to-zoom in JavaScript instead of using CSS `touch-action` or browser-native zoom is a well-known source of UX bugs. The current implementation works for basic cases but may break on:
- Devices with unusual pixel densities
- Browsers that throttle touch events
- Multi-touch gestures with >2 fingers
- Accessibility tools that synthesize touch events

**Suggested fix**: Consider a progressive enhancement approach: use CSS `touch-action: pinch-zoom` when available, fall back to custom JS only when needed.

### C11-CRIT-03: The `viewCountRetryCount.clear()` unconditional wipe is heavy-handed
**File**: `apps/web/src/lib/data.ts` (lines 146-148)
**Severity**: Low | **Confidence**: Low

The unconditional `clear()` on every empty-buffer flush wipes retry counts for ALL groups, even groups that are still active and may fail again on the next flush. A selective pruning (only removing entries for groups not in the buffer) would be more precise. However, the current behavior is simple and correct — the worst case is a group that failed 3 times gets one extra attempt before being dropped.

## Final Sweep
No additional skeptical findings after reviewing all public-facing API surfaces.
