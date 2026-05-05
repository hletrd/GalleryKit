# Performance Reviewer — Cycle 3

## Findings

### F1: Service Worker HTML cache strategy disturbs network response body
- **File**: `apps/web/public/sw.js`, lines 148-155
- **Severity**: High
- **Problem**: Same as code-reviewer F1. On network success the returned HTML is blank because the body stream is consumed by the cache put, breaking the network-first strategy.

### F2: OG photo generation loads full derivative into memory as base64
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`, lines 70-78
- **Severity**: Medium
- **Problem**: No size cap on the fetched derivative. Base64 inflates memory by ~33%. Combined with Satori's SVG/PNG pipeline, this can spike heap usage for large JPEGs.
- **Fix**: Cap the derivative size before base64 conversion.

### F3: Semantic search computes cosine similarity in JS for up to 5000 embeddings
- **File**: `apps/web/src/app/api/search/semantic/route.ts`, lines 136-151
- **Severity**: Medium
- **Problem**: O(n*d) CPU-bound work in the request thread with no timeout or offloading. Under load this blocks the event loop.
- **Fix**: Consider capping scan size lower, adding an AbortSignal timeout to the compute step, or moving inference to a worker thread.

### F4: `BoundedMap` prune iterates twice over the map
- **File**: `apps/web/src/lib/bounded-map.ts`, lines 97-128
- **Severity**: Low
- **Problem**: Two full passes (expired keys + eviction keys) on every prune call. For rate-limit maps with thousands of keys this is acceptable but could be optimized to a single pass.
