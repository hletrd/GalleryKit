# Debugger Review — Cycle 2 Ultradeep

**Scope:** whole-repo latent-bug and failure-mode review of the current working tree.
**Inventory reviewed first:** `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/revalidation.ts`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `scripts/deploy-remote.sh`.

**Verification:** `npm run lint --workspace=apps/web` ✅, `npm test --workspace=apps/web` ✅ (`13` files, `97` tests).

## Findings

### D2-01 — Claim-retry accounting is cleared before the cap can ever trigger
**Severity:** High
**Confidence:** High
**Citations:** `apps/web/src/lib/image-queue.ts:154-171`, `apps/web/src/lib/image-queue.ts:265-273`

**Failure scenario:**
When a job cannot acquire the MySQL advisory lock, the queue increments `claimRetryCounts` and schedules a delayed requeue. But the `finally` block deletes `claimRetryCounts` whenever `retried` is still `false`, and that flag is never set on the claim-failure path. As a result, every delayed retry starts back at attempt `1`, so `MAX_CLAIM_RETRIES = 10` is effectively dead code. A permanently held lock or stuck worker can therefore cause an endless claim/requeue loop with no terminal give-up path.

**Suggested fix:**
Preserve `claimRetryCounts` across delayed claim retries. Only clear it on a successful claim, a definitive terminal failure, or explicit cancellation. The delayed-retry path should keep its counter alive until the cap is actually reached.

---

### D2-02 — A missing original upload leaves a permanent unprocessed row with no failure state
**Severity:** Medium
**Confidence:** High
**Citations:** `apps/web/src/lib/image-queue.ts:174-189`, `apps/web/src/lib/image-queue.ts:287-303`, `apps/web/src/lib/image-queue.ts:332-338`

**Failure scenario:**
If the original file is missing when the queue starts processing a pending image, the job logs `File not found` and returns early. That return does not mark the row as failed, delete the DB record, or write any durable error state. Because `bootstrapImageProcessingQueue()` re-enqueues every `processed = false` row on startup, the same broken record will keep coming back after restarts, but it never makes forward progress and never becomes visible as a hard failure.

**Suggested fix:**
Treat a missing original file as a terminal failure path. Either delete the stale image row, mark it failed, or persist a recovery job that lets operators see and clear the problem explicitly. A plain log-and-return is not enough for a durable queue.

---

### D2-03 — Public photo/share routes are not invalidated after content mutations
**Severity:** High
**Confidence:** High
**Citations:** `apps/web/src/app/actions/images.ts:307-383`, `apps/web/src/app/actions/images.ts:506-551`, `apps/web/src/app/actions/tags.ts:42-118`, `apps/web/src/app/actions/topics.ts:102-206`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:129-243`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-80`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:116-140`, `apps/web/src/components/photo-viewer.tsx:231-355`

**Failure scenario:**
Several mutation paths update the database but only revalidate admin/root paths. That misses public consumers that render the same data:
- `updateImageMetadata()` changes title/description, but shared photo pages and shared group pages still read those fields from cached renders.
- `deleteImage()` / `deleteImages()` remove content, but `/s/[key]` and `/g/[key]` pages are not explicitly invalidated, so deleted photos can remain visible on public share URLs until cache expiry.
- `updateTag()` / `deleteTag()` and `updateTopic()` mutate labels/slugs, but photo pages still display `image.tags`, `image.topic`, and `image.topic_label` in the viewer and breadcrumb/back-link UI.

**Suggested fix:**
Invalidate every public route that consumes the mutated data, not just admin surfaces. For image mutations, that includes photo pages plus any share/group pages tied to the image. For tag/topic mutations, that includes the affected photo pages and any shared pages that render those labels. If enumerating keys is too brittle, prefer a broader layout-level invalidation after the mutation succeeds.

---

### D2-04 — Image deletion can silently leave orphaned public files behind
**Severity:** Medium
**Confidence:** High
**Citations:** `apps/web/src/app/actions/images.ts:361-379`, `apps/web/src/app/actions/images.ts:472-483`, `apps/web/src/lib/process-image.ts:160-187`, `apps/web/src/lib/serve-upload.ts:32-112`

**Failure scenario:**
`deleteImage()` and `deleteImages()` commit the DB transaction first and then perform filesystem cleanup inside a swallow-all `try/catch` / per-image best-effort block. If `deleteOriginalUploadFile()` or any `deleteImageVariants()` call fails, the action still returns success. The database row is gone, but the files remain on disk, and `serveUploadFile()` serves directly from the filesystem. That means a deleted image can stay reachable by its direct asset URLs until someone manually cleans up the orphaned files.

**Suggested fix:**
Make filesystem cleanup a first-class failure path. At minimum, surface a partial-failure status and persist a durable retry/cleanup job so the orphaned files are not silently lost. The current “log and continue” behavior hides a real data-retention failure.

---

## Missed-issues sweep

I rechecked the other high-risk surfaces for additional latent failures:

- **Auth/session/rate limits:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts` — no extra stale-success or credential-rollback gap surfaced beyond the queue and invalidation issues above.
- **Restore/export/security surfaces:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts` — no additional deployment/runtime failure stood out in the current tree.
- **Routing and metadata:** `apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/global-error.tsx` — the branding/OG changes look internally consistent; no new route-loop or metadata crash surfaced.
- **Current diff hot spots:** `scripts/deploy-remote.sh`, `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` — I did not find an additional failure mode beyond the invalidation and queue problems above.

**Bottom line:** 4 actionable latent failure modes remain, with the queue claim-retry reset and the public-route invalidation gaps being the highest-impact issues.
