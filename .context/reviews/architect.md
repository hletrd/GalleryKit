# Architectural Review — Cycle 22

## Method
Reviewed layering, coupling, and lifecycle management across the queue, rate-limit, service worker, and semantic search modules.

## Findings

### HIGH

#### C22-ARCH-01: `decrementRateLimit` violates atomicity expectation
- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Cross-reference**: C22-HIGH-01
- **Issue**: The architecture assumes DB-backed rate limits are the source of truth, but `decrementRateLimit` is not atomic. This breaks the invariant that "the DB is the source of truth" because concurrent operations can lose updates.
- **Fix**: Use a transaction or single atomic statement.
- **Confidence**: High

### MEDIUM

#### C22-ARCH-02: Bootstrap cleanup responsibility is not single-responsibility
- **Source**: `apps/web/src/lib/image-queue.ts:576-592`
- **Issue**: The image processing queue bootstrap function also manages session purging, rate-limit bucket purging, audit log purging, and orphaned tmp file cleanup. These are orthogonal concerns that should be managed by a dedicated lifecycle/scheduler, not entangled with image queue bootstrap.
- **Fix**: Extract cleanup scheduling into a separate `schedulePeriodicCleanup()` module that runs independently of queue bootstrap.
- **Confidence**: Medium

#### C22-ARCH-03: Semantic search client hardcodes server constant
- **Source**: `apps/web/src/components/search.tsx:79`, `apps/web/src/lib/clip-embeddings.ts:12`
- **Issue**: The client component hardcodes `topK: 20` while the server defines `SEMANTIC_TOP_K_DEFAULT = 20`. This creates a fragile coupling where changing the server default requires a parallel client change.
- **Fix**: Export the constant from a shared module (or derive from an API response).
- **Confidence**: Medium

### LOW

#### C22-ARCH-04: Service worker version bumps invalidate all caches
- **Source**: `apps/web/public/sw.js:188-208`
- **Issue**: Every SW version change purges all image, HTML, and meta caches. For frequent deployments, this means users re-download all cached images even if the images themselves haven't changed.
- **Mitigation**: The image cache key includes the SW version, which is intentional for cache consistency. However, a more granular approach (content-hash or image-filename based) would allow longer-lived image caching across deployments.
- **Confidence**: Low — this is a known trade-off for the current architecture.

## Final Sweep
No new layering violations. The queue-shutdown abstraction (queue-shutdown.ts) is clean and properly decoupled. Semantic search is properly gated behind config.
