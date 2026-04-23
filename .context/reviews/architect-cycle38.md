# Architecture Review — Cycle 38 (2026-04-19)

## Reviewer: architect
## Scope: Architectural/design risks, coupling, layering

### Findings

**Finding ARCH-38-01: Server actions barrel file creates circular dependency risk**
- **File**: `apps/web/src/app/actions.ts`
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The barrel file re-exports from individual action modules (auth.ts, images.ts, etc.). Client components import from `@/app/actions`. This is a clean pattern that avoids circular dependencies since each action module is self-contained. However, the `actions/auth.ts` imports from `@/app/actions` itself (line 1: `import { isAdmin } from '@/app/actions'`). Wait — checking again, it imports from `'./actions/auth'`... no, it's `import { isAdmin, getCurrentUser } from '@/app/actions/auth'`. Actually the barrel re-exports from `./actions/auth`, and `auth.ts` doesn't import from the barrel — it's self-contained. No circular dependency. Good architecture.

**Finding ARCH-38-02: In-memory rate limiting state is not shared across instances**
- **File**: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`
- **Severity**: MEDIUM | **Confidence**: HIGH
- **Description**: The rate limiting uses a dual strategy: in-memory Maps as a fast-path cache, and MySQL-backed `rateLimitBuckets` as the source of truth. This design correctly handles multi-instance deployments because the DB is the authoritative source. However, the in-memory Maps are per-process, meaning each instance maintains its own cache. In a multi-instance deployment (e.g., multiple Docker containers behind a load balancer), a request to instance A that increments the in-memory counter won't be reflected in instance B's in-memory counter until the DB is consulted. This is by design (the DB check is always consulted for accuracy), but the pre-increment pattern (e.g., in `login()` at auth.ts line 111-114) optimistically increments the local in-memory counter BEFORE the DB check. If the DB check on instance B is slow, both instances could allow more requests than the limit.
- **Scenario**: Limit is 5 attempts. Instance A processes request 5, increments local counter to 5, increments DB to 5. Instance B simultaneously processes request 6 (its local counter is 0), increments local to 1, tries to increment DB to 6 — but the DB check would catch this. The DB `onDuplicateKeyUpdate` makes the increment atomic, and the `checkRateLimit` query reads the current count. So the DB is the source of truth and would correctly block request 6 on instance B if the check runs after A's increment. The risk is in the race window between the in-memory pre-increment and the DB check.
- **Fix**: The existing design is acceptable for this application's threat model. For stricter enforcement, add Redis as the rate limit store, or remove the in-memory fast path entirely and rely solely on the DB.

**Finding ARCH-38-03: `data.ts` is a god module with too many responsibilities**
- **File**: `apps/web/src/lib/data.ts` (650+ lines)
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: `data.ts` handles: view count buffering, privacy guard enforcement, image listing (getImagesLite, getImages), single image retrieval (getImage), share key lookup, shared group retrieval, topic queries, tag queries, search, sitemap data. The view count buffering (lines 7-86) is a separate concern that could be extracted to its own module. The privacy guard (lines 88-141) is also a cross-cutting concern. However, refactoring now would be high churn for low benefit — the module is cohesive (all data access) and well-organized with clear section comments.
- **Fix**: Consider extracting view count buffering to `lib/view-count-buffer.ts` in a future refactor.

**Finding ARCH-38-04: Image processing queue uses MySQL advisory locks for claim mechanism**
- **File**: `apps/web/src/lib/image-queue.ts` lines 70-101
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The queue uses `GET_LOCK`/`RELEASE_LOCK` for processing claim acquisition. This is a correct pattern for MySQL — advisory locks are session-scoped and automatically released on connection close. The `acquireImageProcessingClaim` function correctly gets a dedicated connection from the pool and releases it in all code paths. The `releaseImageProcessingClaim` function releases the lock and then the connection. This is a well-designed pattern for multi-process coordination.

### Summary
No critical architectural issues. The codebase follows clean separation of concerns with:
- Barrel re-exports for server actions
- Dual in-memory + DB rate limiting
- MySQL advisory locks for queue coordination
- React cache() for deduplication
- Proper ISR caching strategy
