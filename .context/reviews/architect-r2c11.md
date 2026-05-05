# Architect — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Architectural/design risks, coupling, layering, maintainability
**Scope**: Entire repository, cross-module dependencies

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-ARCH-01: Semantic search rate-limit pattern inconsistency
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 40-59)
**Severity**: Medium | **Confidence**: High

The semantic search endpoint uses a purely in-memory `createResetAtBoundedMap` for rate limiting, unlike login/search/load_more which have DB-backed persistence. This inconsistency means:
1. Rate limits are lost on process restart
2. No centralized audit trail of blocked requests
3. The pattern differs from the established three-pattern taxonomy in `rate-limit.ts`

**Suggested fix**: Either add DB-backed persistence (insert `incrementRateLimit` / `decrementRateLimit` / `checkRateLimit` calls) or document the intentional deviation with a rationale comment.

### C11-ARCH-02: Semantic search endpoint mixes route-layer and business-layer rate limiting
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 46-59)
**Severity**: Low | **Confidence**: High

The rate-limit helpers (`checkAndIncrementSemanticRateLimit`, `resetSemanticRateLimitForTests`) are defined directly in the API route file rather than in `lib/rate-limit.ts`. This fragments the rate-limit taxonomy and makes it harder to discover all rate-limit surfaces.

**Suggested fix**: Move the semantic search rate-limit map and helpers to `lib/rate-limit.ts` alongside `ogRateLimit`, `shareRateLimit`, and `checkoutRateLimit`.

### C11-ARCH-03: `ImageZoom` touch gesture handling duplicates browser native behavior
**File**: `apps/web/src/components/image-zoom.tsx`
**Severity**: Low | **Confidence**: Medium

The component reimplements pinch-to-zoom and pan in JavaScript instead of delegating to the browser's native zoom capabilities or the CSS `touch-action` property. This increases complexity and risks gesture conflicts with the browser.

**Suggested fix**: Evaluate whether CSS `touch-action: pinch-zoom` or the native `pinch-zoom` behavior could partially replace the custom implementation. If not, document why custom handling is required.

## Final Sweep
No additional architectural findings after reviewing module dependency graph and cross-file imports.
