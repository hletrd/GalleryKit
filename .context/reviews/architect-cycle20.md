# Architect — Cycle 20

## Review Scope
System architecture, module coupling, layering violations, abstraction boundaries, scalability patterns, and design risk assessment.

## New Findings

### ARCH-20-01: `uploadTracker` negative-count drift violates rate-limit abstraction invariant [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 273-278
- **Description**: The upload tracker's count field represents "number of files uploaded in the current window." The abstraction assumes count >= 0. The differential adjustment pattern (`count += (successCount - files.length)`) violates this invariant when all uploads fail. This is a layering issue: the tracker should enforce its own invariants rather than relying on callers to provide valid deltas. The same pattern (Map + pre-increment + post-adjustment) is used across login, password change, share creation, search, and admin user creation, but only the upload tracker has this particular failure mode because it's the only one where the "pre-incremented" amount (files.length) is adjusted by a potentially-different "actual" amount (successCount).
- **Fix**: Either (a) clamp count to >= 0 after adjustment, or (b) refactor the tracker to use absolute counts instead of differential adjustments.

### ARCH-20-02: DRY violation — 5+ nearly identical rate-limit Map pruning functions across codebase [LOW] [HIGH confidence]
- **Files**: `rate-limit.ts` (pruneLoginRateLimit), `auth-rate-limit.ts` (prunePasswordChangeRateLimit), `images.ts` (pruneUploadTracker), `sharing.ts` (pruneShareRateLimit), `admin-users.ts` (pruneUserCreateRateLimit), `public.ts` (inline in searchImagesAction)
- **Description**: Six nearly identical functions that prune a Map by: (1) iterating and deleting expired entries, (2) evicting oldest entries if size exceeds a cap. The only differences are the Map reference, the expiry field name, and the max-keys constant. This is already tracked as CRI-38-01 / C32-03 from prior cycles.
- **Verdict**: Already deferred. No change from prior assessment.

## Architecture Assessment

The codebase remains well-structured with clear separation between:
- Server actions (thin orchestration layer)
- Data access (data.ts with React cache() deduplication)
- Business logic (validation.ts, session.ts, rate-limit.ts)
- Image processing (process-image.ts, image-queue.ts)

No new coupling or layering issues introduced since last cycle. The storage abstraction is not yet integrated into the processing pipeline (noted in storage/index.ts), which is fine — it's an in-progress feature.

Prior deferred items (ARCH-38-03 data.ts god module, etc.) remain unchanged.
