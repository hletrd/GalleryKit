# Performance Reviewer — Cycle 17

## Inventory of reviewed files

- `apps/web/src/lib/data.ts` — queries, view-count buffer, caching
- `apps/web/src/lib/image-queue.ts` — processing queue, bootstrap
- `apps/web/src/components/lightbox.tsx` — client-side rendering
- `apps/web/src/components/photo-viewer.tsx` — image rendering pipeline
- `apps/web/src/components/image-zoom.tsx` — zoom interaction
- `apps/web/src/lib/rate-limit.ts` — in-memory + DB rate limiting
- `apps/web/src/app/actions/images.ts` — upload/delete actions

## Findings

### C17-PR-01: `getImage` runs 3-4 parallel DB queries per photo view
- **Confidence**: High
- **Severity**: Medium
- **Location**: `apps/web/src/lib/data.ts:735-767`
- **Issue**: Each photo view calls `getImage()` which runs `Promise.all([tags, prev, next])` — that's 3 DB queries plus the initial image fetch (4 total). With a 10-connection pool and 20 queue limit, concurrent photo views can exhaust the pool. The `React.cache()` dedup helps within a single request but not across concurrent requests.
- **Concrete scenario**: 5 users viewing different photos simultaneously = 20 pool connections consumed (5 * 4), blocking all other DB operations.
- **Fix**: Combine prev/next into a single UNION query, or increase the pool size for production deployments.

### C17-PR-02: `lightbox.tsx` mouse-move handler fires on every pixel of movement
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/components/lightbox.tsx:227-229`
- **Issue**: `handleMouseMove` is bound to `onMouseMove` on the lightbox backdrop. Every pixel of mouse movement calls `showControls()`, which checks `controlsVisible` state and the debounce ref. The `showControls` callback has a 500ms debounce guard via `lastControlRevealRef`, so it doesn't re-set state on every call, but the function invocation itself still runs per mouse-move event.
- **Fix**: Use `requestAnimationFrame` throttling on the mouse-move handler, or use a `pointermove` passive listener with RAF throttling. The debounce guard already prevents excess state updates, so this is low-priority.

### C17-PR-03: View count flush creates up to 1000 `db.update` promises in worst case
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/lib/data.ts:78-110`
- **Issue**: The view-count flush processes entries in chunks of `FLUSH_CHUNK_SIZE = 20`, with `Promise.all` per chunk. When the buffer is at capacity (1000 entries), that's 50 sequential rounds of 20 parallel DB updates. Each round waits for all 20 promises before starting the next. On a slow DB connection, this could take 5-10 seconds.
- **Fix**: The chunking is intentional to limit concurrent DB promises. The exponential backoff on consecutive failures (line 36-39) helps during outages. Consider increasing `FLUSH_CHUNK_SIZE` to 50 for faster drain on healthy DBs.

### C17-PR-04: `searchImages` LIKE queries cannot use indexes efficiently
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/lib/data.ts:985-993`
- **Issue**: `searchImages` uses `LIKE '%term%'` which prevents MySQL from using B-tree indexes on `title`, `description`, `camera_model`, `topic`, and `label`. For a personal gallery (thousands of rows, not millions), the full-table scan is acceptable. The LIKE wildcards are properly escaped (line 967).
- **Fix**: If the gallery grows past ~100K images, consider adding a FULLTEXT index. Current scale does not warrant this.

### C17-PR-05: `photo-viewer.tsx` `srcSetData` useMemo recomputes on every image change
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/components/photo-viewer.tsx:205-254`
- **Issue**: The `srcSetData` useMemo depends on `image`, `photoViewerSizes`, `t`, and `imageSizes`. When navigating between photos, `image` changes, triggering full recomputation of the JSX element including all srcSet strings. This is expected behavior — the srcSet must change for each image — but the memo creates a new JSX element each time, causing React to unmount/remount the `<picture>` element rather than updating it.
- **Fix**: This is working as designed for navigation transitions (AnimatePresence handles the fade). No change needed.

### C17-PR-06: Bootstrap query uses `notInArray` with potentially 1000 IDs
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/image-queue.ts:437-438`
- **Issue**: When `permanentlyFailedIds` approaches its cap of 1000, `notInArray(images.id, [...state.permanentlyFailedIds])` generates a large IN clause. MySQL handles IN clauses up to ~10K items efficiently, but the array spread + query building has O(N) memory overhead on each bootstrap.
- **Fix**: If the permanently-failed set grows large, consider moving the exclusion to a temporary table or subquery. Current scale (personal gallery, few permanently-failed images) makes this low-priority.
