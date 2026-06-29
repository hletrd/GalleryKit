# Cycle 10 Critic Review

Review target: current `master` HEAD `4fd8bf3b`.

Scope: PROMPT 1 only. I did not edit application source. This report is the only file changed.

## Inventory and Evidence

Repository guidance reviewed:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/` prior review/report surface

Inventory built before findings:
- App routes and pages: `apps/web/src/app/**`
- Public/admin actions: `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Public/admin APIs: `apps/web/src/app/api/**`
- Core image/data/security libraries: `apps/web/src/lib/**`
- Schema and migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`
- Backfill and operational scripts: `apps/web/scripts/**`
- Tests for touched surfaces: `apps/web/src/__tests__/**`
- Build/deploy/runtime surfaces: `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/scripts/build-sw.ts`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`

Focused files examined for cross-file interactions:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/lib/process-image.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/view-retention.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/drizzle/0027_analytics_retention_indexes.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/process-image-variant-scan.test.ts`
- `apps/web/src/__tests__/process-image-post-encode-verification.test.ts`
- `apps/web/src/__tests__/backfill-color-pipeline.test.ts`
- `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts`
- `apps/web/src/__tests__/admin-backfill-runner-deleted-mid-reencode.test.ts`

Validation evidence:
- `git status --short --branch` was clean before writing this report.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- I did a final missed-issues sweep across the public analytics action tests, derivative-generation cleanup path, queue/backfill callers, migration journal/schema reconciliation, privacy selectors, admin DB restore flow, LR upload route, semantic search routes, service worker build, Dockerfile, and deploy script.

## Findings

### C10-CRIT-01 - Confirmed: public analytics rate limiting happens after attacker-controlled DB lookups

Severity: High

Confidence: High

Status: Confirmed

Code regions:
- `apps/web/src/app/actions/public.ts:364-374` validates `imageId`, checks maintenance, then performs a DB lookup at `367-370` before calling `headers()`, `buildViewParams()`, and `isViewRecordRateLimited()` at `372-374`.
- `apps/web/src/app/actions/public.ts:387-402` does the same for topic slugs: syntactic validation first, DB lookup at `395-398`, limiter at `400-402`.
- `apps/web/src/app/actions/public.ts:414-430` does the same for shared groups, with a joined visibility lookup at `417-426`, limiter at `428-430`.
- These functions are public server-action entry points from `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:22,164-165`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:2,164`, and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:2,130`.
- The test suite currently codifies the blind spot: `apps/web/src/__tests__/public-actions.test.ts:253-268` expects valid-but-not-public targets to perform three DB selects while never calling `headers()`, so no IP bucket is touched. `apps/web/src/__tests__/public-actions.test.ts:292-301` only proves the limiter blocks inserts after repeated valid public-photo calls; it does not prove repeated unknown valid IDs/slugs/groups stop causing DB reads.

Failure scenario:
An unauthenticated client can repeatedly invoke the public analytics actions with syntactically valid but nonexistent image IDs, topic slugs, or group IDs. Every call bypasses the per-IP view-recorder budget until after the visibility lookup, so the attacker gets unmetered indexed DB reads and, for groups, a joined lookup. The insert is skipped, but the expensive and concurrency-relevant DB work already happened. This is especially risky under the documented single-instance / single-MySQL-writer topology where process-local rate limits are the main public abuse brake.

Why reviewers might miss it:
The route-level scanner passes because these are server actions, and `lint:action-origin` explicitly recognizes them as public rate-limited actions. The action does have a limiter, but it is placed after the database lookup. The existing unit test labels the pre-limiter DB lookup for valid non-public targets as expected behavior.

Concrete fix:
Move `headers()`, `buildViewParams()`, and `isViewRecordRateLimited(params.ip, Date.now())` before any DB visibility lookup in all three recorders, after only cheap type/shape validation and restore-maintenance checks. If preserving analytics budget for nonexistent targets is desired, use a two-stage limiter: a cheap pre-lookup bucket that always guards DB work, plus the existing insert bucket after visibility succeeds. Update `public-actions.test.ts` so valid-but-missing targets consume or trip the pre-lookup limiter, and add an exhaustion regression where calls with valid unknown IDs stop before `db.select`.

### C10-CRIT-02 - Confirmed: failed re-encode can delete previously good public derivatives

Severity: High

Confidence: High

Status: Confirmed

Code regions:
- `apps/web/src/lib/process-image.ts:1136-1145` writes each sized derivative to a temp path and then `fs.rename(tmpPath, outputPath)`. On POSIX this atomically replaces an existing public derivative at `outputPath`.
- `apps/web/src/lib/process-image.ts:1298-1300` records the just-renamed sized derivative in `writtenSizedPaths[format]`.
- `apps/web/src/lib/process-image.ts:1313-1341` creates or replaces the base format path and also records it in `writtenSizedPaths[format]`.
- `apps/web/src/lib/process-image.ts:1346-1358` runs WebP, AVIF, and JPEG generation concurrently and throws if any format rejects.
- `apps/web/src/lib/process-image.ts:1385-1401` catches any rejection and unlinks every path recorded in `writtenSizedPaths` across all formats.
- Re-encode callers include `apps/web/scripts/backfill-color-pipeline.ts:200-236` and `apps/web/src/lib/admin-backfill-runner.ts:500-523`, both of which return an encode failure without repairing old derivative files after `processImageFormats` fails.

Failure scenario:
A photo already has good public derivatives from a prior successful upload or backfill. A later force re-encode/backfill starts. WebP and JPEG succeed first and rename over the existing public files, while AVIF fails later due to encoder error, resource pressure, or bad metadata. The catch block then unlinks every path it recorded, including paths that were previously valid and were merely replaced during this invocation. The database row can remain processed/current, but public image files are now missing, causing broken gallery images. This violates the comment at `apps/web/src/lib/process-image.ts:1392-1395`, which claims prior successful run files are not touched; the code cannot distinguish an overwritten old file from a brand-new file once it has renamed into the final public path.

Why reviewers might miss it:
The write helper is correctly atomic for concurrent readers, and the catch block looks like responsible partial-output cleanup. The hidden assumption is that "paths we wrote" means "files that did not exist before this call." Because the final destination path is reused during re-encode, that assumption is false. Existing tests cover partial variant cleanup and deleted-mid-reencode cleanup, but I did not find a regression that pre-creates public derivatives, forces one format to fail after another format overwrites, and asserts the old files still exist.

Concrete fix:
Change `processImageFormats` to stage every derivative under invocation-unique staging paths or a staging directory, verify all formats/sizes/base files and post-encode metadata there, then atomically promote the complete set into public paths only after the whole encode succeeds. Cleanup should delete only staging files. If staging is too invasive, snapshot pre-existing paths before overwrite and restore them on failure, but staging-then-promote is less error-prone. Add a regression around `processImageFormats` or a backfill caller: pre-create WebP/AVIF/JPEG derivative files, force one format to reject after at least one sibling format writes, and assert the pre-existing public derivative files remain present and unchanged.

## Missed-Issues Sweep Notes

No additional confirmed findings from the final sweep:
- Migration `0027_analytics_retention_indexes.sql` is represented in `meta/_journal.json`, the `when` ordering is monotonic, schema indexes match, and `scripts/migrate.js` reconciles the indexes for legacy baseline.
- The privacy selector surface in `data.ts` and the symmetric `privacy-fields.test.ts` guard still omit the expected sensitive/admin-only fields from public outputs.
- Admin restore has explicit DB/upload/backfill locks and calls queue quiesce/resume around restore; I did not find a confirmed lifecycle leak in that path.
- LR upload and browser upload both snapshot processing settings, validate topic existence before insert, enqueue after DB insert, and use the upload tracker/finalization path.
- Semantic and similar-search public routes have same-origin checks, body/shape limits, semantic feature gates, and public route rate limiting before expensive semantic work.
- Service worker generation, Docker standalone build, and deploy disk-prune behavior match the project rules I reviewed.

The two confirmed issues above both sit in reviewer blind spots: one passes the custom lint gates while preserving a pre-limiter DB read, and the other looks like careful cleanup while quietly breaking the "leave previous derivatives intact on failed retry" contract.
