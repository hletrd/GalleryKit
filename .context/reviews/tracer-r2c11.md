# Tracer — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Causal tracing of suspicious flows, competing hypotheses
**Scope**: Request flows, state transitions, async pipelines

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Traced Flows

### Flow 1: Semantic search request lifecycle
**Hypothesis**: A malicious client can exhaust the semantic search rate limit without triggering any expensive work.

**Trace**:
1. Client sends POST to `/api/search/semantic` with body `{}`
2. Same-origin check passes (line 68)
3. Maintenance check passes (line 72)
4. `checkAndIncrementSemanticRateLimit(ip, now)` increments counter (line 80)
5. Body parsing fails — JSON has no `query` field (line 109)
6. Returns 400 with `error: 'Invalid request body'` (line 110)
7. Rate-limit counter remains incremented — no rollback

**Result**: CONFIRMED. After 30 such requests, legitimate users get 429.

**Competing hypothesis**: Maybe the rate limit is only checked, not incremented, on failures.
**Falsification**: Line 52 does `entry.count++` unconditionally inside `checkAndIncrementSemanticRateLimit`. The boolean return value only indicates whether the limit is exceeded AFTER increment.

### Flow 2: Lightbox focus restoration after SPA navigation
**Hypothesis**: Unmounting the lightbox after a route change can attempt to focus a detached DOM node.

**Trace**:
1. User opens lightbox on photo A
2. `useEffect` stores `document.activeElement` (the thumbnail button for photo A)
3. User presses ArrowRight to navigate to photo B
4. `onNavigate(1)` calls `router.push(buildPhotoPath(nextId))`
5. Next.js unmounts photo A page, mounts photo B page
6. Lightbox unmounts, cleanup effect runs
7. `previouslyFocusedRef.current?.focus()` executes
8. The thumbnail button for photo A is no longer in the DOM
9. Browser behavior varies: Chrome silently ignores, Safari may shift focus to `<body>`

**Result**: CONFIRMED on some browsers. Low severity because focus landing on `<body>` is not catastrophic.

### Flow 3: ImageZoom pinch gesture with browser default zoom
**Hypothesis**: Browser pinch-to-zoom and custom pinch-to-zoom compete, producing jerky behavior.

**Trace**:
1. User places two fingers on ImageZoom container
2. `handleTouchStart` fires, sets `isPinchingRef.current = true`
3. Browser also detects pinch gesture (no `touch-action: none`)
4. Browser attempts page zoom
5. `handleTouchMove` fires, `e.preventDefault()` is called
6. But on some browsers, default zoom has already started
7. Visual result: competing scale transforms

**Result**: CONFIRMED on Safari iOS. Low severity because most users don't pinch-zoom gallery images.

## Final Sweep
No additional suspicious flows identified.
