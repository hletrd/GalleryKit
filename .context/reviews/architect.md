# Architecture Review — cycle 3

## Summary
GalleryKit is still understandable as a single Next.js app, but several important boundaries are porous: auth/action code leaks into library and public-page code, operational state is spread across process-local singletons, the storage abstraction is declared but not actually authoritative, and the DB admin surface mixes many concerns in one module. Those choices are already visible in the code and will make multi-instance deployment, auth changes, and storage evolution harder than the current structure suggests.

## Confirmed Issues

### 1) Layer inversion: library/API/public rendering depends on the action-layer auth module
- `apps/web/src/lib/api-auth.ts:1-18` imports `isAdmin` from `@/app/actions/auth`.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:1-2,206-232` imports `isAdmin` from the same action module to decide whether a public page can expose sharing/admin controls.
- `apps/web/src/app/actions/auth.ts:1-18,69-230` is not a pure auth library; it mixes server-action concerns (`cookies`, `headers`, `redirect`, translations, audit, rate limiting, session writes).

**Why this matters**
- `lib -> app/actions` is a reverse dependency.
- Public rendering and API auth now depend on server-action module shape, not a stable lower-level auth service.
- Future auth refactors will require coordinated edits across `app`, `lib`, and page code.

**Failure / evolution scenario**
- If auth moves from cookie-backed sessions to another mechanism, `lib/api-auth`, public pages, and protected layouts can drift because they are coupled to action exports instead of a shared server-only auth domain.

**Suggested fix**
- Extract a server-only auth module such as `src/lib/auth/server.ts` that owns session verification/admin lookup.
- Make `app/actions/auth.ts`, `lib/api-auth.ts`, layouts, and public pages depend on that module instead of importing each other.

**Confidence:** high

---

### 2) The storage boundary is not real yet; actual file I/O still bypasses it
- `apps/web/src/lib/storage/index.ts:4-13` says storage is based on a `storage_backend` admin setting, but also explicitly says it is “not yet integrated” and that file I/O still goes through direct FS paths.
- `apps/web/src/lib/process-image.ts:216-236,345-439` writes originals/variants directly to `UPLOAD_DIR_*`.
- `apps/web/src/lib/serve-upload.ts:32-100` serves files directly from the local filesystem.
- `apps/web/src/lib/image-queue.ts:184-245` verifies and cleans up local files directly.
- `apps/web/src/lib/gallery-config-shared.ts:10-19` does not define any `storage_backend` setting at all.

**Why this matters**
- The codebase advertises a swappable storage layer, but the real pipeline is hard-wired to local disk.
- S3/MinIO support is currently an incomplete abstraction rather than a usable boundary.

**Failure / evolution scenario**
- A future “switch storage backend” feature will not be a settings flip; it will require a cross-cutting rewrite of upload, processing, serving, cleanup, and URL generation paths.

**Suggested fix**
- Either:
  1. fully integrate storage keys/interfaces end-to-end through processing, serving, and cleanup, or
  2. remove/feature-flag the abstraction until it is real.
- Do not leave “backend switch” semantics implied while the actual pipeline bypasses them.

**Confidence:** high

---

### 3) Cross-request operational state is fragmented across process-local maps/timers
- `apps/web/src/lib/data.ts:9-43,43-91,530-600` keeps shared-group view counts in a process-local buffer with deferred flush.
- `apps/web/src/app/actions/images.ts:23-48,82-137` keeps upload quota state in an action-local `Map`.
- `apps/web/src/lib/rate-limit.ts:22-26,91-109,127-195` combines in-memory maps with DB buckets.
- `apps/web/src/app/actions/sharing.ts:19-59,61-88,151-177` adds another in-memory share limiter.
- `apps/web/src/app/actions/admin-users.ts:17-53,71-98` adds another in-memory user-create limiter.
- `apps/web/src/lib/image-queue.ts:38-93,135-280` keeps a global singleton queue with retry maps and timers.

**Why this matters**
- Multiple concerns rely on “fast local state + DB fallback/source of truth”, but each concern implements it separately.
- The architecture implicitly assumes a long-lived single Node process.

**Failure / evolution scenario**
- In multi-instance or autoscaled deployment:
  - view counts become lossy/process-local,
  - rate limits split across instances,
  - upload quota enforcement differs by instance,
  - operational debugging becomes difficult because each concern has its own authority model.

**Suggested fix**
- Centralize authority per concern:
  - correctness-sensitive quotas/rate limits: one durable authority,
  - best-effort telemetry: explicit async service, not embedded in query helpers,
  - background processing: isolated queue service/module with explicit lifecycle.
- Avoid re-implementing “Map + prune + DB reconcile” separately per action.

**Confidence:** medium-high

---

### 4) The read/query layer is not side-effect free
- `apps/web/src/lib/data.ts:530-600` shows `getSharedGroup()` fetching data and also buffering view-count increments.
- `apps/web/src/instrumentation.ts:17-25` relies on shutdown hooks to flush buffered counts.

**Why this matters**
- A data-read helper now owns write behavior and process lifecycle coupling.
- That makes caching, extraction of pure data access, and future service separation harder.

**Failure / evolution scenario**
- If `getSharedGroup()` is reused in new contexts (background jobs, alternate runtimes, pre-rendering), it can accidentally mutate counters or lose mutations if shutdown hooks do not run.

**Suggested fix**
- Split:
  - pure `getSharedGroupByKey(...)`
  - explicit `recordSharedGroupView(...)`
- Let callers choose whether to mutate metrics.

**Confidence:** high

---

### 5) `admin/db-actions.ts` is a cross-layer god module
- `apps/web/src/app/[locale]/admin/db-actions.ts:3-20` imports DB access, schema, `child_process`, file streams, temp-file handling, auth, audit, revalidation, SQL scanning, and backup naming.
- `apps/web/src/app/[locale]/admin/db-actions.ts:94-221,232-360` combines auth checks, temp-file streaming, shelling out to `mysqldump` / `mysql`, dump validation, restore scanning, auditing, and cache invalidation.

**Why this matters**
- One module owns too many responsibilities across application, infrastructure, and security boundaries.
- Backup/restore logic is difficult to test or evolve in isolation.

**Failure / evolution scenario**
- Changing DB engine, backup policy, restore validator, or admin authorization policy will all hit the same large module, increasing regression risk.

**Suggested fix**
- Split into:
  - admin use-case layer,
  - dump/restore infrastructure adapter,
  - SQL validation/scanning service,
  - download controller/route layer.

**Confidence:** high

## Risks / Evolution Hazards

### A) Auth enforcement is duplicated across multiple layers with different semantics
- `apps/web/src/proxy.ts:12-56` checks cookie presence/basic token shape in middleware.
- `apps/web/src/lib/api-auth.ts:9-18` wraps admin API handlers.
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-15` enforces protected page access.

**Risk**
- Policy drift between HTML, API, and navigation behavior.

**Scenario**
- A future auth change updates one gate but not the others, producing inconsistent access results.

**Suggested fix**
- Define one server-only auth primitive and reuse it across middleware/layout/API wrappers, with middleware limited to cheap routing concerns.

**Confidence:** medium-high

---

### B) Client/UI surfaces are tightly coupled to action exports
- `apps/web/src/components/photo-viewer.tsx:16`
- `apps/web/src/components/upload-dropzone.tsx:6`
- `apps/web/src/components/image-manager.tsx:4`
- `apps/web/src/components/admin-user-manager.tsx:12`
- `apps/web/src/components/search.tsx:9`

**Risk**
- UI code is coupled to the current server-action surface instead of narrower use-case interfaces.

**Scenario**
- Renaming or repartitioning actions becomes a broad UI refactor; component tests remain integration-heavy.

**Suggested fix**
- Keep server actions as transport endpoints, but introduce narrower server-side use-case/domain functions beneath them.

**Confidence:** medium

---

### C) Queue bootstrap depends on import-time side effects
- `apps/web/src/lib/image-queue.ts:291-347` bootstraps the queue and then immediately calls `void bootstrapImageProcessingQueue()`.
- `apps/web/src/instrumentation.ts:1-7` also bootstraps queue setup explicitly.

**Risk**
- Background behavior becomes harder to reason about because importing the module can start work.

**Scenario**
- Tests, alternate runtimes, or future script entry points accidentally trigger queue behavior just by importing queue utilities.

**Suggested fix**
- Remove import-time bootstrap; use explicit startup wiring only.

**Confidence:** medium-high

## Root Cause
The repository is structured around Next.js surfaces (`app`, `actions`, `lib`, `components`), but cross-cutting concerns were added incrementally inside whichever module was convenient for the feature at the time. That preserved delivery speed, but it left no stable domain-service layer beneath the App Router/UI shells, so auth, storage, queueing, metrics, and quota logic now cross those boundaries freely.

## Recommendations
1. **Extract a server-only auth/service layer** — medium effort — high impact  
   Remove `lib -> app/actions` inversion and make auth a reusable lower-level dependency.

2. **Make storage either real or explicitly absent** — high effort — high impact  
   Integrate the storage abstraction through processing/serving/cleanup, or remove the misleading abstraction until ready.

3. **Unify mutable operational state patterns** — medium effort — high impact  
   Stop scattering `Map + timer + DB reconcile` logic across unrelated modules.

4. **Separate read models from side effects** — medium effort — medium impact  
   Make data helpers pure; move metrics/view-count mutation into explicit services.

5. **Break up admin DB actions by concern** — medium effort — medium/high impact  
   Reduce blast radius for backup/restore/security changes.

## Trade-offs
| Option | Pros | Cons |
|--------|------|------|
| Keep current pragmatic structure | Fastest short-term iteration | Drift continues; scaling/storage/auth changes stay expensive |
| Fix only auth + storage + state seams | Best cost/benefit | Some cross-layer coupling remains |
| Full layering cleanup | Strongest long-term architecture | Highest refactor cost and regression risk |

## Confidence
**Medium-high.** The layering inversions, incomplete storage abstraction, side-effectful data access, and process-local state coupling are directly confirmed by the cited code. The deployment/evolution failure modes are reasoned risks derived from those confirmed structures.

## Missed-Issues Sweep
Final sweep covered:
- reverse imports,
- singleton/timer/process-local state,
- incomplete abstraction markers,
- auth gate duplication,
- direct action coupling from UI/public surfaces.

No additional architectural blocker above the findings listed here surfaced in that sweep.

## References
- `apps/web/src/lib/api-auth.ts:1-18`
- `apps/web/src/app/actions/auth.ts:1-18,69-230`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:1-2,206-232`
- `apps/web/src/lib/storage/index.ts:4-13,53-71,116-177`
- `apps/web/src/lib/gallery-config-shared.ts:10-19`
- `apps/web/src/lib/process-image.ts:216-236,345-439`
- `apps/web/src/lib/serve-upload.ts:32-100`
- `apps/web/src/lib/image-queue.ts:38-93,135-280,291-347`
- `apps/web/src/lib/data.ts:9-43,43-91,530-600`
- `apps/web/src/instrumentation.ts:17-25`
- `apps/web/src/app/actions/images.ts:23-48,82-137`
- `apps/web/src/lib/rate-limit.ts:22-26,91-109,127-195`
- `apps/web/src/app/actions/sharing.ts:19-59,61-88,151-177`
- `apps/web/src/app/actions/admin-users.ts:17-53,71-98`
- `apps/web/src/proxy.ts:12-56`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-15`
- `apps/web/src/app/[locale]/admin/db-actions.ts:3-20,94-221,232-360`
