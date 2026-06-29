# Cycle 16 Tracer Review

Mode: current-HEAD causal tracing review only. I reviewed repository state via `HEAD` and did not modify production source code. This report is the only intended write.

HEAD reviewed: `7506661e247ee63680b547ed89a1e8462883b2e8`.

## Scope And Method

I loaded the workspace instructions and `CLAUDE.md`, then traced request, background, cache, and persistence flows end-to-end. The suspicious-flow inventory covered the full app-relevant tree at HEAD: 572 files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/nginx`.

Focus areas:

- browser upload and Lightroom upload: request gates -> quota claim -> filesystem write -> DB insert -> queue enqueue -> derivative generation
- restore: admin action -> advisory locks -> maintenance state -> queue/view-count drain -> SQL import -> migration assertion -> revalidation
- public read/write surfaces: share lookup, search, semantic/similar search, OG routes, analytics recorders, rate-limit rollback semantics
- admin mutations: same-origin/auth gates, topic/tag/share/image/user transaction boundaries, audit side effects, cache revalidation
- process-local state: restore maintenance, upload tracker, queue singleton, rate-limit fast paths, shared-group view-count buffer
- cache/data-flow: `unstable_cache` usage, revalidation helpers, service-worker bypass, derivative routes

## Findings

### Confirmed Issues

None found in current HEAD.

### Likely Issues

#### L1. Topic delete race degrades to generic failure instead of the expected "topic has images" outcome

- Severity: Low
- Confidence: Medium
- Region: `apps/web/src/app/actions/topics.ts:429-466`

Failure scenario:

`deleteTopic` checks for images and deletes the topic inside one transaction (`topics.ts:433-441`). The comment says this prevents TOCTOU, but the query is a plain read of `images.topic` (`topics.ts:434`) followed by a topic delete (`topics.ts:440`); it does not acquire a topic-route/upload contract lock or a range lock preventing a concurrent upload from inserting an image for the same topic after the read. If that interleaving happens, the database FK should prevent data loss by rejecting the topic delete, but the catch block only maps the explicit in-process `TopicHasImagesError` to `cannotDeleteCategoryWithImages` (`topics.ts:461-466`). A concurrent FK rejection falls through to `failedToDeleteTopic`.

Competing hypotheses:

- Data-loss hypothesis: rejected. The FK protects existing/new image rows from being orphaned.
- UX/state hypothesis: likely. A real "cannot delete category with images" state can be reported as a generic failure under concurrency.

Suggested fix:

Serialize topic deletion with the same upload-processing contract used by upload acceptance, or specifically classify MySQL FK errors from `tx.delete(topics)` as `cannotDeleteCategoryWithImages`. If stronger serialization is desired, lock the topic row and image range with DB-level locking appropriate for the current isolation mode.

### Manual-Validation Risks

#### M1. Durable analytics writes are intentionally best-effort and can under-record under request/runtime teardown

- Severity: Low
- Confidence: Medium
- Region: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:163-165`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:132-137`, `apps/web/src/app/actions/public.ts:357-385`, `apps/web/src/app/actions/public.ts:391-419`, `apps/web/src/app/actions/public.ts:422-452`

Failure scenario:

Public pages invoke analytics recorders with `void` so rendering is not blocked (`p/[id]/page.tsx:163-165`, `[topic]/page.tsx:163-164`, `g/[key]/page.tsx:132-137`). The recorders validate request metadata, rate-limit, verify target visibility, then start DB inserts without awaiting them (`public.ts:378-385`, `public.ts:409-416`, `public.ts:444-452`). This is internally consistent with the comments, but it means an aborted request, process shutdown, or runtime teardown can lose events from `image_views`, `topic_views`, or `shared_group_views`.

Competing hypotheses:

- User-facing correctness issue: rejected. The page render should continue even if analytics is lost.
- Analytics completeness issue: manual-validation risk. If these tables are used for reports or billing-like decisions, fire-and-forget semantics are too weak.

Suggested fix:

Keep as-is if analytics are explicitly approximate. If durable analytics matter, await the insert before returning from the recorder, or move analytics into a tracked background side-effect queue that is drained by the existing shutdown/restore lifecycle.

#### M2. Process-local coordination is correct only for the documented single web-instance topology

- Severity: High if topology changes; Low for the documented deployment
- Confidence: High
- Region: `CLAUDE.md:228`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-78`, `apps/web/src/lib/image-queue.ts:76-90`, `apps/web/src/lib/rate-limit.ts:112-121`, `apps/web/src/lib/data.ts:24-71`

Failure scenario:

The repo documents the shipped deployment as single web instance / single writer and warns that restore maintenance flags, upload quota tracking, queue state, backfill status, and several public rate-limit buckets are process-local (`CLAUDE.md:228`). The code matches that contract: restore maintenance is a `globalThis` flag (`restore-maintenance.ts:1-56`), upload tracking is a `globalThis` map (`upload-tracker-state.ts:7-78`), image queue state is process-local (`image-queue.ts:76-90`), rate-limit fast paths include in-memory maps (`rate-limit.ts:112-121`), and shared-group view counts buffer in process memory (`data.ts:24-71`). Under horizontal scaling, another process could admit uploads while one process is in restore maintenance, split public rate-limit budgets, or lose buffered view-count increments on abrupt termination.

Competing hypotheses:

- Current production bug: rejected by project documentation; this is an explicit topology constraint.
- Future operational risk: confirmed as a manual-validation guardrail. Scaling the web service without moving these states would break coordination assumptions.

Suggested fix:

Keep the single-instance deployment invariant visible in deploy/runbooks. Before scaling out, move restore maintenance, upload quotas, public rate-limit buckets, shared view-count buffering, and queue coordination into DB/Redis/advisory-lock-backed shared state, or introduce a distributed queue with a single active worker contract.

## Negative Trace Findings

Upload and processing:

- Browser uploads reject restore maintenance before parsing work, then take same-origin/auth gates and acquire the upload-processing contract lock before reading upload settings or claiming quota (`apps/web/src/app/actions/images.ts:114-180`).
- Browser upload quota is claimed synchronously before awaited topic/disk work and rolled back on disk/topic failure paths (`apps/web/src/app/actions/images.ts:238-292`); final reconciliation settles the claim to actual successes/bytes (`apps/web/src/app/actions/images.ts:561-585`).
- Lightroom upload preclaims quota, has a one-shot settlement guard, and rolls back on invalid body/file/topic failures before acquiring the upload contract and saving (`apps/web/src/app/api/admin/lr/upload/route.ts:111-160`).
- The upload-processing contract helper uses a dedicated MySQL connection, handles `GET_LOCK` failures as a null lock, and releases on every lock outcome (`apps/web/src/lib/upload-processing-contract-lock.ts:9-74`).
- Queue processing uses per-image advisory locks (`apps/web/src/lib/image-queue.ts:446-473`) and restore quiescence pauses, clears, waits for idle, drains side effects, and resets bootstrap state (`apps/web/src/lib/image-queue.ts:1036-1090`).

Restore and migrations:

- Restore holds the DB restore lock, upload-processing lock, and color-backfill lock before setting maintenance, then flushes shared-group view counts and quiesces the queue before import (`apps/web/src/app/[locale]/admin/db-actions.ts:297-393`).
- Restore failures keep or release maintenance according to the verified lifecycle flags and release advisory locks in the nested finally path (`apps/web/src/app/[locale]/admin/db-actions.ts:389-410`).
- The process-local maintenance flag is intentionally simple and covered by the upload/restore contract in the single-process topology (`apps/web/src/lib/restore-maintenance.ts:21-56`).

Rate limits and public surfaces:

- The rate-limit module documents rollback choices by surface and uses atomic DB upsert/decrement helpers for persistent buckets (`apps/web/src/lib/rate-limit.ts:1-58`, `apps/web/src/lib/rate-limit.ts:436-507`).
- Static route gates passed for admin API auth, mutating server-action same-origin checks, and public mutating route rate limits.
- Semantic/similar search were reviewed as protected public read flows; no unbounded body, missing origin, or unprocessed-image data-flow issue was found in the traced code paths.

Cache and invalidation:

- Mutating image/share/topic/tag/settings paths use targeted path revalidation or full app revalidation through the shared helper surface. No stale-cache write-after-read bug was confirmed in the traced regions.
- Shared-group view-count buffering swaps and drains through `currentFlushPromise`, so shutdown/restore drains do not mistake a post-swap empty buffer for a completed write (`apps/web/src/lib/data.ts:65-71`).

## Validation Evidence

Commands run:

- `git ls-tree -r --name-only HEAD apps/web/src apps/web/scripts apps/web/drizzle apps/web/e2e apps/web/nginx | wc -l` -> 572 app-relevant files inventoried.
- `git grep` sweeps over HEAD for `void record`, `setTimeout`, `setInterval`, `globalThis`, `Symbol.for`, `GET_LOCK`, `RELEASE_LOCK`, `FOR UPDATE`, `transaction(`, `db.insert`, `db.update`, `db.delete`, `revalidateAllAppData`, `revalidateLocalizedPaths`, `unstable_cache`, `cacheTag`, `updateTag`, and `revalidateTag`.
- `npm run lint:api-auth --workspace=apps/web` -> passed.
- `npm run lint:action-origin --workspace=apps/web` -> passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.

I did not run the full test suite because this lane was a review-only tracer pass with no production-code changes. The three static gates above were run because they directly validate the auth/origin/rate-limit surfaces in scope.

## Final Missed-Issues Sweep

Rechecked before writing:

- browser upload vs restore maintenance start
- Lightroom upload quota settlement vs multipart and topic failures
- upload quota claim rollback vs awaited disk/topic checks
- restore advisory-lock release on early returns and final returns
- queue quiescence order and side-effect drain before DB restore
- per-image processing lock and retry/bootstrap state reset
- public analytics target validation and fire-and-forget semantics
- topic delete check/delete interleaving with concurrent upload
- public route/action rate-limit order and rollback contract
- admin API wrapping and same-origin enforcement
- process-local state against documented single-instance deployment
- cache/revalidation calls on image/share/topic/tag/settings mutations

No source file in the inventory was intentionally skipped. I did not inspect generated images, runtime upload/data directories, or unrelated static media because the user asked for current HEAD repository code.
