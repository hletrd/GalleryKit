# Cycle 22 Debugger Review

Reviewer: cycle 22 debugger
HEAD reviewed: `ec7cd52883d4973e32f056324620154228190335`
Scope: read-only source review plus targeted lint guard verification. No source code was edited.

## Inventory Examined

Guidance and repo context:
- `AGENTS.md` instructions supplied in the task prompt.
- `CLAUDE.md`, including runtime topology, security model, migrations, upload/restore coordination, privacy contracts, color/HDR conventions, and deploy rules.
- `.context/plans/cycle-22-plan.md`
- `.context/plans/cycle-22-deferred.md`
- Previous `.context/reviews/debugger.md` before this review artifact was replaced.

Configuration, schema, and tooling:
- `package.json`
- `apps/web/package.json`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/drizzle/*.sql` inventory
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/migrate.js`

Public/admin route surfaces:
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`

Server actions and shared libraries:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/view-retention.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/bounded-map.ts`
- `apps/web/src/lib/env.ts`
- `apps/web/src/lib/pagination.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/index.ts`

Client surfaces checked for route-side effects and navigation regressions:
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/on-this-day-widget.tsx`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/lightbox.tsx`

Tests and review history sampled by targeted grep/inventory:
- `apps/web/src/__tests__/` targeted tests and source-contract tests around pagination, env parsing, privacy, upload tracker, route guards, serve-upload, storage quarantine, restore/quiesce, and touch targets.
- `.context/reviews/archive/` and `.context/plans/` by search for carried risks, deferred invariants, and prior cycle closures.

## Verification Run

- `npm run lint:api-auth --workspace=apps/web` - passed. Both admin API routes are wrapped.
- `npm run lint:action-origin --workspace=apps/web` - passed. Mutating server actions enforce same-origin provenance or carry explicit exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed. Public mutating API routes are rate-limited.

I did not run the full lint/typecheck/build/Vitest/Playwright suite because this was a read-only debugger review and the targeted policy gates above directly cover the highest-risk route/action invariants inspected.

## Findings

### DBG22-D1 - Upload quota claim still depends on hand-maintained settle points

Severity: Medium
Confidence: High
Status: Risk, current latent invariant fragility

Evidence:
- `apps/web/src/app/actions/images.ts:238-242` pre-claims the per-admin upload quota synchronously before any post-claim work.
- `apps/web/src/app/actions/images.ts:271-279` documents the failure mode: any unhandled throw after the claim and before final settlement leaks the claim until the roughly one-hour window expires.
- Current explicit settlement points exist at `apps/web/src/app/actions/images.ts:257-264`, `apps/web/src/app/actions/images.ts:286-292`, `apps/web/src/app/actions/images.ts:570-571`, and `apps/web/src/app/actions/images.ts:595-596`.
- `apps/web/src/app/actions/images.ts:540-548` calls out another post-claim await that is safe only while `deleteOriginalUploadFile` never rejects.
- `apps/web/src/lib/upload-paths.ts:71-77` currently satisfies that non-throwing cleanup contract by swallowing unlink/resolve failures.

Concrete failure scenario:
An otherwise reasonable future edit adds an awaited validation step after the quota claim, or changes `deleteOriginalUploadFile` to propagate filesystem errors. A transient DB/filesystem error then exits the upload action before any settlement call. The outer `finally` releases only the upload-processing lock, not the quota claim, so the in-memory tracker overcounts failed bytes/files and can reject legitimate uploads from that admin/IP until the quota window rolls over.

Suggested fix:
Replace the comment-enforced settlement discipline with a single idempotent `claimSettled` guard in a `try/finally` around the entire post-claim span. Keep the current success/all-failed settlements, but make the finally settle `(0, 0)` only when no earlier settlement ran. Add a source-contract or behavior test that fails when a new post-claim `await` can escape without settling.

### DBG22-D2 - Audit retention still deletes all expired rows in one statement

Severity: Low
Confidence: High
Status: Likely operational failure mode

Evidence:
- `apps/web/src/lib/audit.ts:97-122` validates the retention window and then runs one unbounded `db.delete(auditLog).where(lt(auditLog.created_at, cutoff))`.
- The analogous analytics retention path is already chunked: `apps/web/src/lib/view-retention.ts:64-87` loops bounded deletes with `.limit(VIEW_PURGE_BATCH)` and an iteration cap.

Concrete failure scenario:
If a long-lived site accumulates a large audit backlog, the hourly/maintenance purge can issue one very large delete transaction. On MySQL this can hold locks longer than needed, generate a large undo/redo burst, and briefly degrade or block admin activity that writes audit rows. The environment parser is now safe, so this is not a mass-delete correctness bug; it is a boundedness and availability bug.

Suggested fix:
Mirror `purgeOldViewEvents`: delete expired audit rows in batches with a conservative per-run cap, return the deleted count for observability, and add a test that asserts `.limit(...)` is present or that repeated batched deletes drain multiple chunks.

### DBG22-D3 - Upload fallback serving still validates one path and opens a later path by name

Severity: Low
Confidence: Medium
Status: Risk, same-host filesystem race

Evidence:
- `apps/web/src/lib/serve-upload.ts:175-184` checks `lstat`, rejects symlinks/non-files, resolves `realpath`, and verifies the resolved path is inside the upload root.
- `apps/web/src/lib/serve-upload.ts:216-217` builds the ETag from the earlier `lstat` result.
- `apps/web/src/lib/serve-upload.ts:263-269` then opens `createReadStream(resolvedPath)` by pathname, and the in-code comment explicitly notes this is not descriptor-backed validation.
- The admin DB backup download route shows the safer pattern for sensitive file serving: `apps/web/src/app/api/admin/db/download/route.ts:42-90` opens the file descriptor, stats that descriptor, and streams from the same opened object.

Concrete failure scenario:
A same-host actor with write access to the upload tree swaps the checked file path after `lstat`/`realpath` but before `createReadStream`. The route may stream a different inode than the one used for validation and ETag calculation. This is not a remote unauthenticated exploit under the documented deployment, but it keeps the fallback serving path dependent on a same-host trust boundary instead of an invariant enforced by the file descriptor.

Suggested fix:
Open the file once with `fs.promises.open`, run `fh.stat()` on that descriptor, reject non-regular files, build headers from the descriptor stat, and stream via `fh.createReadStream({ autoClose: true })`. Keep the existing upload-root realpath check as path traversal defense, but make the served bytes come from the same object that was validated.

## Cleared Checks And Non-Findings

- Cycle-21 explicit photo navigation prefetch regression is closed at this HEAD. `apps/web/src/components/photo-navigation.tsx:36-42` navigates with `router.push` only, and the hidden adjacent photo links at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:284-294` carry `prefetch={false}`.
- The main masonry grid photo links are also fenced with `prefetch={false}` at `apps/web/src/components/home-client.tsx:323-328`.
- Pagination/parser fixes from the cycle-22 plan are present: `apps/web/src/lib/pagination.ts:1-16`, `apps/web/src/lib/env.ts:1-24`, `apps/web/src/lib/image-types.ts:123-132`, and `apps/web/src/lib/process-image.ts:345-367`.
- Restore coordination did not produce a new finding. `apps/web/src/app/[locale]/admin/db-actions.ts:388-445` acquires same-session MySQL advisory locks before maintenance, `apps/web/src/app/[locale]/admin/db-actions.ts:481-525` flushes/quiesces/resumes around restore, and `apps/web/src/app/[locale]/admin/db-actions.ts:526-548` has fallback releases.
- The process-local restore-maintenance flag remains a known scale-out constraint, not a new bug under the documented topology. `apps/web/src/lib/restore-maintenance.ts:1-56` is process-local, and `CLAUDE.md:232-233` explicitly prohibits horizontal scaling until that state moves to a shared store.
- The dead `@/lib/storage` abstraction still has a weaker local stream implementation at `apps/web/src/lib/storage/local.ts:91-99`, but source imports are quarantined by tests and no production source imports it outside `lib/storage`.
- Privacy-field and public API wrapper surfaces matched the existing guard model during inspection; no new privacy field leak was found.

## Final Sweep / Skipped Files

Skipped or not line-read exhaustively:
- Binary/image assets, generated screenshots, logs, `.git`, `.omx` runtime state, and dependency directories.
- Historical review/archive markdown was searched and sampled for carried risks rather than fully line-read.
- The entire `apps/web/src/__tests__/` tree was not read line-by-line; targeted tests and source-contracts relevant to this review were inspected or searched.
- Full browser-flow validation and production deploy were not run because this task was a static/debugger review with no source changes.

No critical or high-severity new runtime bug was confirmed in current HEAD. The actionable residuals above are all current codebase risks with concrete line evidence.
