# Cycle 19 Tracer Review

Role: tracer
Cycle: review-plan-fix 19/100, prompt 1
Scope: causal tracing of upload -> processing -> queue -> DB -> public rendering; auth/session -> admin actions/API; rate limit -> request identity; backup/restore -> maintenance -> migration; semantic search/backfill -> embeddings; UI route -> data layer -> privacy projection. No source code changes were made.

## Review Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, root `README.md`, root/package scripts, `apps/web/README.md`, `.context/plans/README.md`, `.context/plans/cycle-19-plan.md`, `.context/plans/cycle-19-deferred.md`, and the previous tracer artifact.

Traced files and owners:

- Upload and public delivery: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, upload-serving route handlers.
- Processing and queue: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Auth/session/admin APIs: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, admin API routes under `apps/web/src/app/api/admin/**`.
- Rate limit and request identity: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, public search/share/feed/action routes.
- Backup/restore/migration: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/**`.
- Semantic search/backfill: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/lib/clip-*`, `apps/web/src/lib/search-enrichment-fields.ts`.
- UI/privacy projection: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, public page routes, map/share/feed/search presentation paths, privacy tests and source-contract tests.

## Findings

### TRC19-01: CLIP embedding backfill can stop quietly before later embeddable rows

Severity: Medium
Confidence: High
Status: Confirmed code path; likely production/operator impact

Code regions:
- `apps/web/src/app/actions/embeddings.ts:141-168` uses `SEMANTIC_SCAN_LIMIT - attemptedEmbeddings` as the SQL page limit, `apps/web/src/app/actions/embeddings.ts:179-187` increments that budget only after a resolvable original/encoder attempt, and `apps/web/src/app/actions/embeddings.ts:211` treats `pending.length < BACKFILL_BATCH_SIZE` as end-of-backlog.
- `apps/web/scripts/backfill-clip-embeddings.ts:159-189` has the same budget-limited SQL page, `apps/web/scripts/backfill-clip-embeddings.ts:201-210` leaves missing-original rows out of `attemptedEmbeddings`, `apps/web/scripts/backfill-clip-embeddings.ts:239-244` logs the scan-limit message only after attempted embeddings reach the limit and otherwise stops on `rows.length < BATCH_SIZE`.
- `apps/web/README.md:85` and `CLAUDE.md:599` tell operators to repeat the sidecar only when it logs that `SEMANTIC_SCAN_LIMIT` was reached, while also documenting that missing-original candidates can be skipped without consuming the attempt budget.
- Coverage does not exercise this edge: `apps/web/src/__tests__/embeddings-action-behavior.test.ts:237-255` proves the in-app action can pass one skipped row to a later valid row in the same page, but the source-contract tests pin the risky shape instead of a behavioral near-budget case (`apps/web/src/__tests__/cycle-6-source-contracts.test.ts:9-17`).

Why the causal chain fails:
The backfill loop mixes two different cursors: the SQL page size is bounded by remaining embedding attempts, but the end-of-backlog check compares the returned row count to the full batch size. When the remaining attempt budget is smaller than `BACKFILL_BATCH_SIZE`/`BATCH_SIZE`, the query is guaranteed to return fewer than the full batch size even if more candidate rows exist after the page. If that limited page contains only missing-original rows, `attemptedEmbeddings` does not reach `SEMANTIC_SCAN_LIMIT`, the "Reached SEMANTIC_SCAN_LIMIT" continuation message is not emitted, and the loop exits as if the backlog is complete.

Competing hypotheses checked:

- Hypothesis A: this is intentional because `SEMANTIC_SCAN_LIMIT` is an embedding-attempt budget, not a row-scan budget. That explains why missing originals do not increment `attemptedEmbeddings`, but it does not justify using the reduced attempt budget as the SQL fetch size or using the full batch size as the terminal condition.
- Hypothesis B: a repeat run will naturally continue later. This is unlikely for the same broken-row prefix/window: the cursor is process-local to the run and starts at `0`, so a repeat can revisit the same missing-original rows and hit the same quiet short-page exit.
- Hypothesis C: queue bootstrap fills the gap. It helps only when semantic search is already enabled in the live web process. The documented pre-enable sidecar flow explicitly exists to seed production rows before flipping the setting, so relying on bootstrap leaves the operator runbook incomplete.

Concrete failure scenario:
1. `SEMANTIC_SCAN_LIMIT=2000`, `BATCH_SIZE=100`, and 1995 embeddings have already been attempted in the current sidecar/action run.
2. The next five candidate rows have `filename_original = NULL` or missing original files; later IDs in the same backlog have valid originals.
3. The next query uses `.limit(5)`, returns those five skipped candidates, advances the cursor, and performs zero embedding attempts.
4. `attemptedEmbeddings` remains `1995`, so no scan-limit log is printed. `rows.length < BATCH_SIZE` is true, so the run reports `Done`/`ok` even though later valid rows still need embeddings.
5. The operator follows the docs and does not repeat because there was no scan-limit message; production semantic search has holes that only appear as missing or weaker results.

Suggested fix:
Decouple scan pagination from the embedding-attempt budget. Always fetch a full scan page, advance the cursor over scanned candidates, and check the remaining attempt budget immediately before actual encoder/stub work. Terminate on "no rows returned" or a page shorter than the requested scan page, not a page shortened by the remaining attempt budget. Emit an explicit continuation message whenever the run stops because the attempt budget is exhausted, including when the final page was skip-heavy. Add behavioral tests for both the in-app action and the sidecar shape: remaining budget smaller than batch size, a skip-only short page, and valid candidates after that page.

## Traced Without New Findings

- Upload -> processing -> queue -> DB -> public rendering: browser uploads check restore/origin/admin mutation barriers (`apps/web/src/app/actions/images.ts:129-143`), lock the upload/processing contract before settings snapshot (`apps/web/src/app/actions/images.ts:198-212`), strip GPS from DB and retained originals (`apps/web/src/app/actions/images.ts:409-422`), re-check restore before insert (`apps/web/src/app/actions/images.ts:425-437`), insert unprocessed rows with processing settings snapshots (`apps/web/src/app/actions/images.ts:439-490`), and enqueue all queue settings (`apps/web/src/app/actions/images.ts:526-558`). Lightroom upload mirrors those gates, including route-local maintenance before token usage and tracker claim (`apps/web/src/app/api/admin/lr/upload/route.ts:84-164`), a second maintenance/contract-lock gate after multipart parse (`apps/web/src/app/api/admin/lr/upload/route.ts:254-282`), GPS/original cleanup (`apps/web/src/app/api/admin/lr/upload/route.ts:407-452`), and enqueue/audit/revalidate after commit (`apps/web/src/app/api/admin/lr/upload/route.ts:532-620`). Queue processing rechecks pending rows, validates originals, verifies all derivatives before `processed=true`, and cleans derivatives if the row is deleted mid-processing (`apps/web/src/lib/image-queue.ts:805-921`).
- Auth/session -> admin actions/API: token auth is scoped and request-local, with pre-auth throttling before DB token verification (`apps/web/src/lib/api-auth.ts:80-99`); cookie fallback requires same-origin before session auth (`apps/web/src/lib/api-auth.ts:122-129`). The prior PAT/maintenance trace failure is fixed in the Lightroom route because `markAdminAuthTokenUsed(request)` now runs after the first maintenance/header/quota/parse-slot gates (`apps/web/src/app/api/admin/lr/upload/route.ts:94-160`).
- Rate limit -> request identity: proxy headers are only used behind `TRUST_PROXY`; otherwise the code falls back to `unknown` and logs a production warning if proxy headers are present (`apps/web/src/lib/rate-limit.ts:180-205`). Admin token auth throttling pre-increments by resolved client IP before `verifyToken()` (`apps/web/src/lib/rate-limit.ts:247-263`).
- Backup/restore -> maintenance -> migration: restore takes restore, upload-contract, color-backfill, and semantic-backfill locks before durable maintenance (`apps/web/src/app/[locale]/admin/db-actions.ts:431-543`), drains queue/background/sweeps/admin mutation writers before import (`apps/web/src/app/[locale]/admin/db-actions.ts:545-584`), releases/clears/resumes in the finalizer only under the intended lifecycle state (`apps/web/src/app/[locale]/admin/db-actions.ts:594-633`), and keeps maintenance on unsafe import/migration failures (`apps/web/src/app/[locale]/admin/db-actions.ts:824-884`). I did not find a new restore/write causal break beyond already-deferred scale-out assumptions.
- Semantic online routes -> embeddings -> enrichment: semantic search charges the limiter before DB config lookup and body parsing (`apps/web/src/app/api/search/semantic/route.ts:173-206`), bounds body/query sizes and aborts real inference on request abort (`apps/web/src/app/api/search/semantic/route.ts:213-260`), and uses a shared compile-guarded public enrichment projection (`apps/web/src/lib/search-enrichment-fields.ts:29-47`). The finding above is limited to offline/in-app backfill completion semantics.
- UI route -> data layer -> privacy projection: `publicSelectFields` omits location, original filenames, admin color/HDR/internal fields (`apps/web/src/lib/data.ts:368-407`), map projection is the only public latitude/longitude selector and is guarded by `topics.map_visible` (`apps/web/src/lib/data.ts:409-487`, `apps/web/src/lib/data.ts:1784-1811`), and viewer reads only switch to `adminSelectFields` when the caller explicitly asks for admin fields (`apps/web/src/lib/data.ts:1235-1237`).

## Manual-Validation Risks

- Known deferred risks remain manual/topology-bound and were not re-filed as new findings: restore maintenance assumes the current single-web-instance deployment, token-auth throttling is process-local, and IPv6 clients are not coalesced to `/64`.
- Backup/restore remains SQL-only by design; uploaded originals/derivatives are not part of the SQL dump. I treated that as documented operational scope, not a new causal defect.

## Final Sweep

Examined all requested high-level flows. No requested flow was intentionally skipped. I did not run the full quality gates because this prompt required a review artifact only and no source changes; validation evidence here is source, docs, and test-contract tracing.
