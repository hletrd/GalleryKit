# Architecture Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository — architectural risks, coupling, layering, single-writer constraints, scalability boundaries.

## Inventory reviewed

All `apps/web/src/` files with focus on: module boundaries, data flow, process-local state, deployment topology constraints, and cross-cutting concerns.

---

## Findings

### C1F-AR-01 (High / High). Process-local state prevents horizontal scaling — 7 distinct in-memory state modules

- Location: Multiple files
  - `lib/data.ts` — view count buffer (Map + timer)
  - `lib/image-queue.ts` — processing queue (PQueue + Sets + Maps)
  - `lib/rate-limit.ts` — in-memory rate limit Maps
  - `lib/auth-rate-limit.ts` — in-memory auth rate limit Maps
  - `lib/upload-tracker-state.ts` — upload tracker Map
  - `lib/restore-maintenance.ts` — restore maintenance flag
  - `lib/bounded-map.ts` — bounded Map utilities
- CLAUDE.md explicitly documents "single web-instance / single-writer topology". If the web service is horizontally scaled, all process-local state (view counts, upload quotas, rate limits, queue state, restore maintenance) will diverge across instances.
- **Severity**: Low at current scale (single Docker instance). Medium if the deployment topology changes.
- **Fix**: No fix needed at current scale. Document that horizontal scaling requires migrating all in-memory state to Redis/shared store.

### C1F-AR-02 (Medium / Medium). Data access layer (`lib/data.ts`) is 1123 lines with mixed concerns

- Location: `apps/web/src/lib/data.ts`
- The file contains: view count buffering/flushing, privacy guard types, multiple query builders, cursor pagination, search, SEO settings, and cached query wrappers. These are distinct concerns that could be separated.
- **Severity**: Low — the file is well-organized with clear section comments, but the length makes it a merge-conflict hotspot.
- **Fix**: Consider splitting into `data-queries.ts`, `data-view-counts.ts`, `data-search.ts`, and `data-seo.ts`.

### C1F-AR-03 (Medium / Medium). Server actions use inconsistent auth patterns

- Location: `apps/web/src/app/actions/*.ts`
- Three auth patterns exist:
  1. `isAdmin()` — cookie-based auth check (used in `deleteImage`, `deleteImages`, `updateImageMetadata`)
  2. `getCurrentUser()` + `requireSameOriginAdmin()` — user lookup + origin check (used in `uploadImages`)
  3. `isAdmin()` + `requireSameOriginAdmin()` — combined (used in most actions)
- The inconsistency means some actions check `isAdmin()` (cookie only) while others also verify `getCurrentUser()`. The `requireSameOriginAdmin()` wrapper was added as defense-in-depth (C2R-02), but the split between `isAdmin()` and `getCurrentUser()` is inconsistent.
- **Severity**: Low — all paths ultimately verify the session cookie, but the inconsistency could lead to future errors if someone adds a new action and picks the wrong pattern.
- **Fix**: Standardize on a single auth pattern (e.g., `getCurrentUser()` + `requireSameOriginAdmin()`) for all mutating admin actions. Create a `requireAuth()` helper that combines both.

### C1F-AR-04 (Low / Low). `instrumentation.ts` bootstrap is not guarded against concurrent invocation

- Location: `apps/web/src/instrumentation.ts`
- The `bootstrapImageProcessingQueue` call in `instrumentation.ts` is protected by `state.bootstrapped` in the queue state, so concurrent invocations are safe. However, the instrumentation file itself doesn't document this.
- **Severity**: Low — the guard exists in the queue module.
- **Fix**: Add a comment documenting that concurrent invocation is safe due to the `bootstrapped` flag.

### C1F-AR-05 (Low / Low). No structured logging — all logging uses console.debug/warn/error

- Location: Throughout the codebase
- All logging uses raw `console.debug`, `console.warn`, and `console.error`. There's no structured logging (JSON, log levels, request tracing). For a personal-gallery deployment this is fine, but it makes production debugging harder.
- **Severity**: Low — acceptable for personal-gallery scale.
- **Fix**: Consider adopting a lightweight structured logger for production deployments.
