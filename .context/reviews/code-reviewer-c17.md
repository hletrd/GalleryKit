# Code Reviewer — Cycle 17

## Inventory of reviewed files

- `apps/web/src/lib/image-queue.ts` (538 lines)
- `apps/web/src/lib/sanitize.ts` (163 lines)
- `apps/web/src/lib/data.ts` (1136 lines)
- `apps/web/src/app/actions/auth.ts` (437 lines)
- `apps/web/src/components/lightbox.tsx` (405 lines)
- `apps/web/src/lib/rate-limit.ts` (329 lines)
- `apps/web/src/app/actions/images.ts` (750 lines)
- `apps/web/src/lib/validation.ts` (126 lines)
- `apps/web/src/proxy.ts` (108 lines)
- `apps/web/src/lib/content-security-policy.ts` (92 lines)
- `apps/web/src/lib/session.ts` (145 lines)
- `apps/web/src/components/photo-viewer.tsx` (655 lines)

## Findings

### C17-CR-01: `image-manager.tsx` catch blocks swallow errors silently
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/components/image-manager.tsx` lines 136, 165, 190, 216, 250, 434
- **Issue**: Six catch blocks in `image-manager.tsx` catch errors from `deleteImage`, `updateImageMetadata`, `deleteImages`, `batchUpdateImageTags`, etc., but only `return` without any logging. If these server-action calls fail with unexpected errors (network, auth, server crash), the admin sees the UI silently do nothing with no console output to help debug.
- **Concrete scenario**: Admin clicks "Delete" on an image. The server throws a 500 because the DB connection is down. The catch block just returns; the admin sees no error toast and no console message. Previous cycle-1 review flagged this as A1-LOW-01 but it remains unfixed.
- **Fix**: Add `console.warn` or `console.error` to each catch block, and ensure the error message is shown to the user via toast.

### C17-CR-02: `storage/index.ts` uses `console.log` in production code
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/lib/storage/index.ts:112`
- **Issue**: `console.log('[Storage] Switched to ${type} backend')` is a production log using `console.log` instead of `console.debug` or `console.info`. CLAUDE.md notes this module is "not yet integrated" but it still ships in the bundle.
- **Fix**: Replace with `console.debug`.

### C17-CR-03: `lightbox.tsx` `showControls` callback has stale `controlsVisible` closure risk
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/components/lightbox.tsx:94-118`
- **Issue**: `showControls` is a `useCallback` that depends on `controlsVisible` and `shouldAutoHideControls`. The 500ms debounce guard (`now - lastControlRevealRef.current < 500`) is a ref-based workaround for the stale closure, but the `controlsVisible` in the dependency array means the callback is recreated on every visibility change. When `controlsVisible` is `true`, the early return at line 96-98 means rapid mouse-move events call the function but exit immediately (no state set, no timer reset). This is correct but subtly coupled: if the debounce guard were removed, the callback would still short-circuit because `controlsVisible` is already `true`. The dual guard (stale-closure workaround + explicit state check) works but is fragile for future maintainers.
- **Fix**: Add a code comment explaining the dual guard pattern, or refactor to use a ref for `controlsVisible` as well so the callback is stable.

### C17-CR-04: `data.ts` `searchImages` runs up to 3 DB queries sequentially in worst case
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/lib/data.ts:961-1073`
- **Issue**: `searchImages` first queries `images` (title/description/camera), then if results are insufficient, runs tag and alias queries in parallel. The initial query is sequential before the parallel branch. For a gallery with no title matches but many tag matches, the first query wastes a DB round-trip before the parallel branch starts. This is already documented as C3-AGG-03. The short-circuit at line 998 partially mitigates it.
- **Fix**: Consider running all three queries in parallel and merging, or accept the current design as intentional (avoids unnecessary tag/alias queries on popular terms).

### C17-CR-05: `proxy.ts` middleware does not validate cookie signature cryptographically
- **Confidence**: High
- **Severity**: Low (by design)
- **Location**: `apps/web/src/proxy.ts:83`
- **Issue**: The middleware checks `token.split(':').length !== 3` as a basic format check, with full cryptographic verification in server actions. This is intentional (middleware must be fast), but the format check is weak: `a:b:c` passes even though it's not a valid HMAC-signed token. The middleware only needs to distinguish "cookie present and looks plausible" from "no cookie", so this is acceptable.
- **Fix**: No code change needed. Document the intentional trust boundary more explicitly.

### C17-CR-06: `data.ts` is 1136 lines with mixed concerns
- **Confidence**: High
- **Severity**: Medium
- **Location**: `apps/web/src/lib/data.ts`
- **Issue**: This has been flagged before (A1-MED-07) and remains unfixed. The file contains: view-count buffering/flushing, privacy field guards, image listing queries, cursor pagination, search, SEO settings, and sitemap queries. It is a merge-conflict hotspot and makes it difficult to reason about any single concern.
- **Fix**: Split into focused modules: `data-view-count.ts`, `data-privacy.ts`, `data-queries.ts`, `data-search.ts`, `data-seo.ts`.

### C17-CR-07: `image-queue.ts` retry on claim failure re-enqueues the same job object
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/image-queue.ts:240-242`
- **Issue**: When `acquireImageProcessingClaim` fails (lock already held), the code calls `enqueueImageProcessing(job)` after a delay. The `job` object carries the same `quality` and `imageSizes` snapshot from the original upload. If the admin changed `image_sizes` between the first enqueue attempt and the delayed retry, the retried job will use the old snapshot. This is a very narrow edge case (claim retries are for concurrent workers, not admin config changes) and the `quality`/`imageSizes` fallback in the queue handler (lines 270-282) fetches fresh config when the job doesn't carry snapshots.
- **Fix**: No immediate fix needed. Document that claim-retry jobs use the original upload-time config snapshot.

### C17-CR-08: `sanitizeAdminString` double-strips when `rejected=false`
- **Confidence**: Low
- **Severity**: Low
- **Location**: `apps/web/src/lib/sanitize.ts:156-161`
- **Issue**: When `UNICODE_FORMAT_CHARS.test(input)` is `false` (no formatting chars), the function still calls `stripControlChars(input)` which also runs `UNICODE_FORMAT_CHARS_RE.replace()`. Since the `.test()` already confirmed no formatting chars exist, the regex-based replace in `stripControlChars` is a no-op for formatting chars but still strips C0/C1 controls. This is correct behavior (C0/C1 controls are separate from Unicode formatting) but the naming could confuse future contributors who might think the check is redundant.
- **Fix**: Add a clarifying comment that `stripControlChars` handles C0/C1 controls separately from the Unicode formatting check.
