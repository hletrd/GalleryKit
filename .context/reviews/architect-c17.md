# Architect Review — Cycle 17

## Architectural risks and coupling analysis

### A1: `data.ts` as a god module

`data.ts` (1136 lines) is the most significant architectural risk. It serves as the single data access layer for:
- View-count buffering and flushing (162 lines of state management)
- Privacy field guards and compile-time checks (lines 177-284)
- Image listing queries with 4 variants (lite, lite page, full, admin)
- Image detail query with prev/next navigation
- Shared group query with tag batching
- Search with 3-query merge strategy
- SEO settings with DB fallback
- Cursor pagination normalization
- Sitemap query

The module-level closures (`viewCountBuffer`, `viewCountFlushTimer`, `consecutiveFlushFailures`, `isFlushing`) create hidden state that is difficult to test in isolation. The view-count buffering system alone has 6 pieces of mutable state.

**Risk**: Any change to view-count logic risks breaking query logic because they share the same module scope. Merge conflicts are common.

**Recommendation**: Extract `data-view-count.ts` as a separate module with explicit exports. The view-count system has no dependency on the query logic other than the `sharedGroups` table import.

### A2: Rate-limiting architecture split between in-memory and DB

The rate-limiting system has a dual architecture:
- In-memory `BoundedMap` for fast-path checks (`rate-limit.ts`)
- DB-backed `rate_limit_buckets` table for cross-restart persistence (`rate-limit.ts:221-318`)
- Per-action rate-limit maps in `auth-rate-limit.ts` (separate file)

This creates 3 places where rate-limit logic lives:
1. `rate-limit.ts` — IP-based login, search, OG, share rate limits
2. `auth-rate-limit.ts` — account-scoped login, password-change rate limits
3. DB `rate_limit_buckets` table — persistent backup for login

**Risk**: Adding a new rate-limited endpoint requires changes in multiple files. The DB-backed rate limit is only used for login; other endpoints rely solely on in-memory Maps.

**Recommendation**: Consider a unified rate-limit registry that centralizes all rate-limit definitions. This is a low-priority refactor.

### A3: Server action auth pattern inconsistency

Three auth patterns exist across server actions:
1. `getCurrentUser()` + `requireSameOriginAdmin()` (uploadImages)
2. `isAdmin()` + `requireSameOriginAdmin()` (deleteImage, updateImageMetadata)
3. `requireSameOriginAdmin()` alone (no additional check needed when origin is verified)

Both `getCurrentUser()` and `isAdmin()` ultimately call `getCurrentUser()`, which calls `getSession()` -> `verifySessionToken()`. The `isAdmin()` function just negates the null check. The redundancy is harmless but adds cognitive overhead.

**Recommendation**: Standardize on `requireSameOriginAdmin()` as the single auth entry point, with `getCurrentUser()` called only when the user ID is needed (audit logging, ownership checks).

### A4: Image processing queue singleton on globalThis

The processing queue state is stored on `globalThis` (line 127-150) to survive HMR in development. This is a standard Next.js pattern but has implications:
- In a multi-process deployment (forbidden by CLAUDE.md), each process has its own queue state.
- The queue state is never serialized — process crashes lose all in-memory state (retry counts, permanently-failed IDs).
- The `permanentlyFailedIds` set is process-local and doesn't survive restarts.

**Risk**: After a restart, all permanently-failed images are re-enqueued (the `permanentlyFailedIds` set is empty). This could cause a burst of processing failures. The retry mechanism (3 retries) will re-add them to `permanentlyFailedIds`, but the burst is wasteful.

**Recommendation**: Consider persisting `permanentlyFailedIds` to the DB (e.g., a `processing_failed` column on the `images` table) so it survives restarts. This is low-priority for a personal gallery.

## Findings

### C17-AR-01: `data.ts` should be split into focused modules
- **Confidence**: High
- **Severity**: Medium
- **Location**: `apps/web/src/lib/data.ts`
- **Issue**: 1136-line god module with 6 pieces of mutable state and 7+ concerns. Previously flagged as A1-MED-07.
- **Fix**: Extract view-count buffering into `data-view-count.ts`. Extract search into `data-search.ts`. Extract SEO into `data-seo.ts`.

### C17-AR-02: Permanently-failed IDs are process-local and lost on restart
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/lib/image-queue.ts:114-116`
- **Issue**: `permanentlyFailedIds` is an in-memory Set. After a restart, all permanently-failed images will be re-enqueued, causing a burst of 3 retry attempts per image before they're re-added to the failed set.
- **Fix**: Add a `processing_failed` boolean column to the `images` table, or a separate `processing_failures` table. Exclude failed images in the bootstrap query using this DB flag.
