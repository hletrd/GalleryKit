# Code Reviewer — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Code quality, logic correctness, maintainability, edge cases
**Scope**: Entire repository, with emphasis on recently-modified and cross-file interaction surfaces

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-MED-01: Semantic search rate limit consumed before request validation
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 76-122)
**Severity**: Medium | **Confidence**: High

The `POST` handler increments the in-memory rate-limit counter at line 80 (`checkAndIncrementSemanticRateLimit`) BEFORE validating that semantic search is enabled (line 96), parsing the request body (line 104), and validating query length (line 120). A client making requests while semantic search is disabled, or sending malformed JSON, or submitting queries shorter than 3 characters, will consume their 30 req/min budget without ever performing expensive work. This violates the "rollback on infrastructure/validation error" pattern (Pattern 2) documented in `rate-limit.ts` and used consistently by `loadMoreImages` and `searchImagesAction`.

**Failure scenario**: A bot probes the endpoint with `{}` bodies. Each probe increments the counter. After 30 probes, legitimate users are locked out for 60 seconds even though zero actual semantic search work was performed.

**Suggested fix**: Move the rate-limit increment AFTER all cheap validation gates (same-origin, maintenance, semantic-enabled, body shape, query length). Or add a `rollbackSemanticAttempt(ip)` helper and call it on every early-return path.

### C11-LOW-01: Semantic search endpoint has no request body size limit
**File**: `apps/web/src/app/api/search/semantic/route.ts` (line 104)
**Severity**: Low | **Confidence**: Medium

The route calls `await request.json()` without bounding the body size. A malicious client could stream a multi-megabyte JSON payload, pinning memory during `JSON.parse`. Next.js has default body-size limits (~1 MB for API routes), but this endpoint performs no explicit guard.

**Suggested fix**: Add an early `Content-Length` check before `request.json()`: reject bodies larger than a few KB (semantic queries are never > 200 code points).

### C11-LOW-02: Missing `touch-action: none` on ImageZoom container
**File**: `apps/web/src/components/image-zoom.tsx` (lines 332-359)
**Severity**: Low | **Confidence**: Medium

The `ImageZoom` component intercepts touch events for custom pinch-zoom and pan gestures, but the container `div` has no `touch-action` CSS property. On mobile browsers (especially Safari), the browser's default pinch-to-zoom and scroll behaviors compete with the custom handlers, producing janky or incorrect gesture responses.

**Suggested fix**: Add `style={{ touchAction: isZoomed ? 'none' : 'auto' }}` (or a Tailwind class) to the container. When zoomed, disable browser touch actions; when not zoomed, allow normal scrolling.

### C11-LOW-03: Lightbox focus-restoration targets potentially detached element
**File**: `apps/web/src/components/lightbox.tsx` (lines 364-374)
**Severity**: Low | **Confidence**: Medium

The mount/unmount `useEffect` stores `document.activeElement` in `previouslyFocusedRef` and calls `.focus()` on it during cleanup. In a Next.js App Router SPA navigation, the previously focused element may have been removed from the DOM when the lightbox unmounts (e.g., user navigated to a different photo page). Calling `.focus()` on a detached element can throw or produce confusing focus behavior.

**Suggested fix**: Before calling `.focus()`, verify `document.body.contains(previouslyFocusedRef.current)`.

### C11-LOW-04: Semantic search `topK` parameter bounds are untested
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 114-115)
**Severity**: Low | **Confidence**: High

The `topK` parameter is clamped to `[1, SEMANTIC_TOP_K_MAX]` (default 10, max 50). There is no unit test verifying that negative values, zero, floats, or values above the max are correctly clamped. The existing `semantic-search-rate-limit.test.ts` covers rate limiting only.

**Suggested fix**: Add a source-contract test in `__tests__/semantic-search-params.test.ts` that exercises boundary values for `topK`.

### C11-LOW-05: `data.ts` viewCountRetryCount redundant prune path
**File**: `apps/web/src/lib/data.ts` (lines 146-167)
**Severity**: Low | **Confidence**: High

In `flushGroupViewCounts`, when `viewCountBuffer.size === 0`, all retry entries are cleared (line 147). Immediately after, if `viewCountRetryCount.size > MAX_VIEW_COUNT_RETRY_SIZE`, it attempts FIFO eviction (lines 157-167). If the clear ran, the Map is empty and the eviction loop is a no-op. This is harmless but creates redundant logic that could confuse future maintainers.

**Suggested fix**: Add an `else` so the hard-cap eviction only runs when the buffer-is-empty clear did not fire:
```js
if (viewCountRetryCount.size > 0 && viewCountBuffer.size === 0) {
    viewCountRetryCount.clear();
} else if (viewCountRetryCount.size > MAX_VIEW_COUNT_RETRY_SIZE) {
    // eviction...
}
```

## Final Sweep

- Checked all server actions for consistent `requireSameOriginAdmin()` + `isAdmin()` ordering: `bulkUpdateImages` intentionally reverses the order (documented in comment), which is acceptable.
- Checked all DB transactions for proper scope: no leaked connections, all `tx` usages are consistent.
- Checked for unhandled Promise rejections: fire-and-forget analytics calls have `.catch()` handlers.
- No additional findings after final sweep.
