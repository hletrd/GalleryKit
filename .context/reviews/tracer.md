# Cycle 11 Tracer Review

HEAD reviewed: `a4af7992` (`docs(review): add cycle 11 verifier review`).

Mode: read-only causal tracing review. I did not edit production code; this report is the only intended artifact.

## Scope And Method

Read first, per workspace rule:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory target: suspicious request/data lifecycles, lock boundaries, retry/rollback symmetry, process-local state, schema/migration cursor behavior, public expensive endpoints, and cross-file route/cache invalidation. The app inventory contained 567 files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/messages`; I narrowed review-relevant tracing to the files below.

## Review-Relevant Inventory

Upload, processing, retry, and side-effect lifecycle:
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`

Restore, migration, and schema cursor lifecycle:
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/src/__tests__/migration-journal.test.ts`
- `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`

Admin mutation, sharing, route segment, and cache lifecycle:
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/advisory-locks.ts`

Public request, analytics, search, and semantic lifecycle:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

## Confirmed Findings

None found in the current tree.

Evidence: browser and Lightroom uploads both acquire the upload-processing contract lock before save/insert/enqueue and settle quota across pre-insert failure paths (`apps/web/src/app/actions/images.ts:177-184`, `apps/web/src/app/actions/images.ts:238-292`, `apps/web/src/app/actions/images.ts:556-584`, `apps/web/src/app/api/admin/lr/upload/route.ts:121-137`, `apps/web/src/app/api/admin/lr/upload/route.ts:231-254`, `apps/web/src/app/api/admin/lr/upload/route.ts:431-454`). Queue processing uses per-image advisory claims, conditional processed updates, delete-during-processing cleanup, and tracked side-effect drains (`apps/web/src/lib/image-queue.ts:440-467`, `apps/web/src/lib/image-queue.ts:647-669`, `apps/web/src/lib/image-queue.ts:672-740`, `apps/web/src/lib/image-queue.ts:806-819`). Restore acquires restore, upload-contract, and backfill locks, enters maintenance, flushes analytics, quiesces queue work, and releases/resumes in finally blocks (`apps/web/src/app/[locale]/admin/db-actions.ts:279-399`). Topic slug rewrites update FK children and exact smart-collection topic predicates inside one transaction (`apps/web/src/app/actions/topics.ts:255-340`). Migration journal non-monotonic history is mitigated by per-entry hash baselining plus a loud missing-hash postcondition and tests (`apps/web/scripts/migrate.js:686-785`, `apps/web/src/__tests__/migration-journal.test.ts:73-114`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:63-119`).

## Likely Findings

None found.

## Risks

### TRC11-RISK-01 - Semantic search recall is bounded to the most recently updated embedding rows

Severity: Medium
Confidence: High
Status: Risk

Code region:
- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/app/api/search/semantic/route.ts:256-268`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-150`

Failure scenario:
`SEMANTIC_SCAN_LIMIT` defaults to 2,000 and clamps at 25,000. Both natural-language semantic search and similar-image search then read embeddings ordered by `updated_at DESC` and stop at that hard cap. Once the gallery has more active embeddings than the cap, older embedded photos are never candidates. A user can search for a scene whose best match is an older photo and receive no result even though the row has a valid production embedding.

Suggested fix:
Expose an admin/runtime health signal when active embeddings exceed `SEMANTIC_SCAN_LIMIT`, and label the feature as a bounded recent-embedding scan while that remains true. For full-gallery behavior, move to an ANN/vector index or a paginated top-k scan with an explicit recall contract.

### TRC11-RISK-02 - Dark in-app CLIP backfill can report success after one capped candidate set

Severity: Low
Confidence: Medium
Status: Risk

Code region:
- `apps/web/src/app/actions/embeddings.ts:79-80`
- `apps/web/src/app/actions/embeddings.ts:103-124`
- `apps/web/src/app/actions/embeddings.ts:129-172`
- `apps/web/scripts/backfill-clip-embeddings.ts:113-117`

Failure scenario:
The action explicitly says no UI currently wires it and the sidecar is canonical. If a future admin UI calls `backfillClipEmbeddings()` directly, the action selects one `SEMANTIC_SCAN_LIMIT`-bounded set of missing rows, processes only that fixed set, and returns `{ status: 'ok', processed, skipped }` with no `hasMore` or remaining-count signal. A gallery with more missing embeddings than the cap could be presented as fully backfilled. The sidecar script is safer operationally because it warns when the scan limit is reached and tells the operator to re-run.

Suggested fix:
Keep the action unwired, remove it, or make it keyset-paginated like the sidecar and return `hasMore` plus a remaining count. Add a source-level test/contract that prevents future UI wiring from treating a one-shot capped action as completion.

### TRC11-RISK-03 - Several correctness guards depend on the documented single web-instance topology

Severity: Medium
Confidence: High
Status: Risk

Code region:
- `apps/web/src/lib/restore-maintenance.ts:1-55`
- `apps/web/src/lib/image-queue.ts:250-323`
- `apps/web/src/lib/upload-tracker-state.ts:7-79`
- `apps/web/src/lib/data.ts:12-70`
- `apps/web/src/app/actions/public.ts:323-341`
- `apps/web/src/lib/advisory-locks.ts:8-15`

Failure scenario:
The current deployment is documented as a single web instance, and the reviewed code is coherent under that topology. If the service is later scaled horizontally, process-local state stops being authoritative: restore maintenance is per process, queue/enqueued/retry maps are per process, upload quota windows are per process, public view-record rate limits are per process, and buffered shared-group view counts can be lost per process. A second instance could accept uploads during another instance's restore maintenance window, multiply public analytics budgets, or undercount shared-group views after a crash.

Suggested fix:
Before any scale-out, move restore maintenance state, upload quota tracking, queue coordination, public view-record rate limits, and shared-group view buffering into shared DB/Redis-backed state, or add a startup/runtime guard that fails fast when more than one web instance is configured.

## Competing Hypotheses Ruled Down

- Upload/settings race: both browser and Lightroom upload paths hold the same upload-processing contract lock through the accepted save/insert/enqueue window; setting changes acquire the same lock before changing byte/privacy-impacting settings.
- Upload quota leak after pre-claim: post-claim disk/topic checks settle on early return or throw, and the per-file loop reconciles the pre-claim to actual successes before returning.
- Delete while processing: queue processing conditionally marks `processed=true` and scans/removes all derivative variants when the DB row disappeared mid-processing.
- Restore/upload interleave: restore acquires DB restore, upload-contract, and color-backfill locks before entering maintenance and quiescing queue work.
- Topic slug rename data loss: the recreate transaction repoints `images.topic`, `topic_aliases.topic_slug`, `topic_views.topic`, and exact smart-collection topic predicates before deleting the old topic row.
- Share-key enumeration via metadata: share pages keep metadata generic and perform the rate-limited DB lookup only in the page body.
- Public route/action guard drift: admin API route exports use `withAdminAuth`; public mutating API route scans are covered or intentionally exempted; mutating server actions carry same-origin checks or explicit public read/analytics exemptions.
- Migration silent-skip recurrence: the historic journal inversion is known; fresh/current migrations after idx 18 must beat prior global max, and `migrate.js` asserts every journal hash is recorded after migration.

## Final Missed-Issue Sweep

Final sweep covered:
- Upload maintenance checks, quota claim/settle paths, disk preflight rollback, strict config snapshots, topic-existence rollback, original-file cleanup, enqueue rejection behavior, and browser/Lightroom parity.
- Queue bootstrap, per-image advisory claims, retry/claim retry maps, permanent-failure persistence, delete-during-processing cleanup, caption/embedding side effects, and restore/shutdown drains.
- Restore advisory locks, maintenance begin/end, dump scanning, mysql child-process failure paths, queue quiescence order, and migration postconditions.
- Topic route-segment locking, alias conflicts, topic-view and smart-collection remaps, topic image lifecycle cleanup, and revalidation failure containment.
- Share-key atomic update/revoke, group-share transaction boundaries, public share-key lookup throttling, metadata non-disclosure, and public analytics write ordering.
- Public search/load-more rate-limit ordering, semantic body-read ordering, semantic mode gates, model-version filters, embedding scan cap, and enrichment privacy fields.
- Schema/migration journal monotonicity, migration reconcile coverage, deployment bind-mount assumptions, and process-local topology assumptions.

Validation: static review and source inspection only. No production source changed, so I did not run the full lint/type/test/build gate for this artifact-only review.
