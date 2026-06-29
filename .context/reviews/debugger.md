# Debugger Review - Cycle 9

Scope: latent bugs, failure modes, regressions, exception cleanup, races, stale artifacts, queue/backfill/restore behavior, upload/delete retry edges, API route error behavior, client state, and tests that can mask failures in `/Users/hletrd/flash-shared/gallery`.

Constraints honored:
- Read `AGENTS.md` and `CLAUDE.md` before repository review.
- Review-only lane: no source-code or plan edits.
- Existing dirty sibling review files were left untouched.

## Inventory

Built a review-relevant inventory before findings:
- `554` review-relevant tracked files across `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, migrations, app configs, and committed context docs/plans/reviews.
- Approx. `83,287` lines in the code/script/test/migration inventory.
- Key surfaces traced: upload/LR upload, queue bootstrap and retry, delete cleanup, restore maintenance, in-app and sidecar backfills, public/admin API routes, semantic/OG rate-limit contracts, client search/load-more/admin state, service worker generation, tests that rely on source-grep fixtures.

## Confirmed Issues

### DBG9-01 - `retryFailedImage` reports success after a rejected queue enqueue

Severity: Medium  
Confidence: High  
Status: Confirmed issue

Code regions:
- `apps/web/src/app/actions/images.ts:1196-1199` clears `processing_error`, `failed_at`, and writes a fresh `processing_settings_json`.
- `apps/web/src/app/actions/images.ts:1203-1207` clears in-memory permanent-failure/retry state.
- `apps/web/src/app/actions/images.ts:1210-1239` calls `enqueueImageProcessing(...)` but ignores its boolean result and always returns `{ success: true }`.
- `apps/web/src/lib/image-queue.ts:388-400` documents and implements `false` returns for rejected jobs: shutdown, restore maintenance, invalid filenames, or permanently failed state.
- `apps/web/src/lib/image-queue.ts:828` makes bootstrap select only `processed=false AND processing_error IS NULL`, so a retry that cleared the error but failed to enqueue moves the row out of the failed-images surface.
- `apps/web/src/__tests__/failed-image-retry.test.ts:99-105` only source-greps that an enqueue call exists and that success can be returned; it does not assert rejected enqueue behavior.
- `apps/web/src/__tests__/retry-failed-image-auth.test.ts:125-157` covers auth gates only, so it cannot catch this queue-return regression.

Concrete failure scenario:
A restored or repaired DB row is in the failed state but carries invalid derivative filename metadata. The admin clicks Retry. `retryFailedImage` clears the failure columns and local retry maps, then `enqueueImageProcessing` rejects the job at `image-queue.ts:398-400`. The action still returns success. The row is no longer visible in `getFailedImages()` because `processing_error` is now null, yet it is not queued. Future bootstrap scans can rediscover it, but the same filename guard rejects it again without restoring a visible failure state, leaving an admin-facing "retry succeeded" result for a still-unprocessed image.

Suggested fix:
Validate the job filenames before clearing failure state, or capture the `enqueueImageProcessing` return value and return an error while preserving/restoring `processing_error` when enqueue is rejected. Add a behavioral test where `enqueueImageProcessingMock.mockReturnValue(false)` asserts the action does not return success and does not silently remove the row from the failed state.

## Likely Issues

### DBG9-02 - Sidecar deleted-mid-reencode cleanup can make a committed batch fail

Severity: Low  
Confidence: Medium  
Status: Likely issue

Code regions:
- `apps/web/scripts/backfill-color-pipeline.ts:400-436` commits the DB batch transaction.
- `apps/web/scripts/backfill-color-pipeline.ts:439-459` detects rows deleted mid-reencode and then awaits cleanup after the DB transaction.
- `apps/web/scripts/backfill-color-pipeline.ts:127-132` implements `cleanupDeletedMidReencodeVariants` as raw `Promise.all(...)` with no local catch.
- `apps/web/src/lib/admin-backfill-runner.ts:430-439` has the safer sibling behavior: cleanup errors are caught and logged because this cleanup is best-effort.

Concrete failure scenario:
During a sidecar run, an image is deleted after its derivatives are re-encoded but before the sidecar `UPDATE images ... WHERE id = ?` batch commits. The batch correctly records `affectedRows=0` and attempts orphan derivative cleanup. If one unlink path throws anything other than the ENOENT-tolerant path, for example EACCES/EPERM from a filesystem permission drift, the post-commit `Promise.all` rejects. The DB updates for sibling rows are already committed, but the sidecar treats the cleanup miss as a fatal flush failure and can abort the remaining run. The in-app runner explicitly avoids this escalation for the same cleanup class.

Suggested fix:
Mirror `admin-backfill-runner.ts`: catch cleanup failures inside `cleanupDeletedMidReencodeVariants`, log a warning with enough filename/id context, and continue the sidecar summary. If the operator needs non-zero visibility for incomplete cleanup, track a separate cleanup failure counter rather than throwing after committed DB work.

## Stale Artifacts / Tests That Can Mislead

### DBG9-03 - Semantic/OG rate-limit comments disagree with current locked behavior

Severity: Low  
Confidence: High  
Status: Stale artifact / test-contract risk

Code regions:
- `apps/web/src/lib/rate-limit.ts:17-30` describes `/api/search/semantic` as Pattern 2 rollback for branches that never reach the guarded resource.
- `apps/web/src/lib/rate-limit.ts:323-340` says callers must rollback on early returns before expensive work and names invalid body/query-too-short as rollback examples.
- `apps/web/src/app/api/search/semantic/route.ts:12-16` says malformed post-read bodies intentionally stay charged.
- `apps/web/src/app/api/search/semantic/route.ts:181-230` pre-increments before body read and returns malformed-body/invalid-query errors without `rollbackSemanticAttempt`.
- `apps/web/src/__tests__/semantic-search-route.test.ts:187`, `:237`, `:249`, and `:344` assert no rollback on several semantic route branches, matching the route rather than the old `rate-limit.ts` prose.
- `apps/web/src/__tests__/og-photo-fallback.test.ts:9-10` says all-sizes-fail fallback rolls back the OG rate-limit budget.
- `apps/web/src/__tests__/og-photo-fallback.test.ts:53-75` and `apps/web/src/app/api/og/photo/[id]/route.tsx:126-131` correctly lock the opposite: all-sizes-fail remains charged after DB/internal fetch work.

Concrete failure scenario:
A future maintainer follows the central `rate-limit.ts` docstring and adds semantic rollbacks for invalid post-read bodies or restores OG all-sizes-fail rollback. The existing source-grep tests partially protect the actual behavior, but the top-level comments point in the other direction and make the failure mode look like a fix. This is especially risky because both routes are unauthenticated public surfaces where rollback policy is part of the DoS/enumeration boundary.

Suggested fix:
Update the `rate-limit.ts` semantic pattern docs to distinguish pre-body/pre-config refunds from post-body charged malformed requests, or move `/api/search/semantic` into a distinct "charged after body materialization" pattern. Update the `og-photo-fallback.test.ts` header so it matches the actual assertions at lines 53-75. Prefer behavioral route tests over source-grep where practical.

## Risks Needing Manual Validation

- `apps/web/scripts/backfill-color-pipeline.ts:36-43` documents a known per-image-lock gap for the sidecar. Current predicates reduce the live retry collision: the sidecar selects already-processed rows, while `retryFailedImage` selects `processed=false AND processing_error IS NOT NULL` at `apps/web/src/app/actions/images.ts:1179`. I did not find a current retry-vs-sidecar double-encode path, but the sidecar still lacks the in-app runner's per-image claim and remains worth operator validation before any future predicate broadening.
- `apps/web/src/app/api/admin/lr/upload/route.ts:238-523` has deeply nested cleanup scopes and indentation that makes review difficult, but the route preserves quota settling, original cleanup, late restore checks, lock release in `finally`, and JSON error responses across the traced throw paths. No confirmed bug found; keep this path under focused tests when touched.

## False Positives / Already Fixed

- Prior `DBG-C7-01` is fixed. `apps/web/src/lib/process-image.ts:1061-1068` now reads fresh dimensions and assigns `processingBaseWidth = freshBaseWidth`; the derivative loop uses `processingBaseWidth` at `apps/web/src/lib/process-image.ts:1149-1152`.
- Prior `DBG-C7-02` is fixed. `apps/web/src/components/tag-filter.tsx:10-22` accepts canonical `currentTags` and derives `canonicalTags` from props, not raw `useSearchParams().get('tags')`; active state and URL mutation use `canonicalTags` at lines `29-40` and `64-97`.
- The service worker stamp lag is still a non-finding. `apps/web/package.json:10` runs `scripts/build-sw.ts` in prebuild, and `apps/web/public/sw.js` differs from the template only by the expected stamped version marker.
- Restore upload/processing lock sequencing was rechecked around `apps/web/src/app/[locale]/admin/db-actions.ts` and the queue restore helpers; no new restore-maintenance regression was confirmed in this pass.

## Verification Evidence

Commands run:
- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed.
- `npm test --workspace=apps/web -- failed-image-retry retry-failed-image-auth semantic-search-route og-photo-fallback sw-template-contract` — 5 files passed, 61 tests passed.

Final missed-issue sweep:
- Full inventory via `rg --files` over app/lib/components/scripts/tests/migrations/config/context.
- Targeted sweeps for `KNOWN GAP`, `TODO`, `FIXME`, `rollback`, `retryFailedImage`, queue/bootstrap retry maps, cleanup/unlink paths, sidecar/in-app backfill differences, generated service worker drift, API route auth/rate-limit gates, and source-grep tests that can mask behavior.
- Reviewed dirty sibling review artifacts only as context; did not edit or stage them.

No new Critical or High findings were confirmed in this lane.
