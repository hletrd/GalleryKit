# Debugger Review - Cycle 19

Date: 2026-07-08 KST
Lane: `debugger`
Scope: latent-bug and failure-mode review of the repository. Review-only: no source fixes, no commits, no deploys.

## Invariants Read

- `AGENTS.md`: commit/deploy rules, migration journal rules, quality gates, privacy-field omit contract, restore/deploy constraints.
- `CLAUDE.md`: single web-instance / single-writer topology, local filesystem storage layout, private originals vs public derivatives, upload-processing contract, restore maintenance barrier, advisory-lock destroy-on-release-failure discipline, CLIP production activation, and operational runbooks.
- `README.md`, root/workspace `package.json`, app scripts, `.context/README.md`, and `.context` review/plan conventions.

I observed unrelated dirty review files and left them untouched. The only write made by this lane is this artifact.

## Bug-Surface Inventory Built First

- Routes/actions: public localized pages, admin pages, server actions, admin API routes, Lightroom upload route, semantic/similar search APIs, OG/feed/sitemap/health/upload fallback routes.
- Data layer: `data.ts`, timeline helpers, smart collections, gallery config/cache, revalidation, background writes.
- DB/schema/migrations: Drizzle schema, committed SQL migrations, `_journal.json`, `scripts/migrate.js`, legacy reconcile/baseline logic.
- Image processing/queues: upload queue, retry/backoff maps, processing claims, side effects, caption/embedding writes, derivative cleanup, topic-image temp cleanup, shutdown/restore drain.
- Upload/restore: browser uploads, LR multipart uploads, upload tracker/contract lock, filesystem path resolution, restore maintenance/durable marker, SQL restore scanner, DB backup/restore actions.
- Auth/session/rate-limit: cookie admin auth, PAT auth, session revocation, admin mutation barrier, public/admin rate-limit helpers and lint gates.
- Client components: upload/admin settings/search/tag-filter/mobile interactions and touch-target-sensitive UI surfaces.
- Tests/gate scripts: ESLint custom scanners, typecheck/typegen helpers, Vitest/e2e scripts, migration/hash checks.
- Deploy/runtime scripts: deploy helper, container entrypoint, docker-compose, backup/backfill scripts, pruning policy.

## Findings

### DBG-C19-01 - LR multipart parse slot leaks if PAT usage marking fails

Severity: High  
Confidence: High  
Status: Confirmed source-path failure

Files/regions:

- `apps/web/src/app/api/admin/lr/upload/route.ts:60-73` defines the process-local `lrMultipartParseInFlight` slot counter and release closure.
- `apps/web/src/app/api/admin/lr/upload/route.ts:152-160` acquires the only multipart parse slot, then awaits `markAdminAuthTokenUsed(request)`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:180-188` releases the slot only in the later `request.formData()` `finally`.
- `apps/web/src/lib/api-auth.ts:23-28` shows `markAdminAuthTokenUsed()` awaits `markTokenUsed(verified.id)` and can reject on DB/token-store failure.

Failure scenario:

`POST /api/admin/lr/upload` accepts a valid PAT and passes the header/content-length/rate-limit checks. It then acquires the singleton multipart parse slot at `route.ts:152`. If `markAdminAuthTokenUsed(request)` rejects before `request.formData()` begins, control exits the handler through the `withAdminAuth` wrapper. The release callback at `route.ts:187` never runs because the protected `try/finally` starts after the throwing await. `lrMultipartParseInFlight` remains `1` in that Node process, and every later Lightroom upload returns 429 `"Another Lightroom upload is being parsed; retry shortly"` until process restart.

This is production-relevant because `markTokenUsed()` touches persistent token metadata. A transient DB outage, dropped pooled connection, migration lock, or token-table write failure on one authenticated LR upload can wedge the entire LR upload endpoint for the lifetime of the process, independent of whether later DB operations are healthy.

Suggested fix:

Start the release-protected region immediately after acquiring the slot, or move token usage marking before slot acquisition. A safe shape is:

```ts
const releaseMultipartParseSlot = tryAcquireLrMultipartParseSlot();
if (!releaseMultipartParseSlot) return ...

try {
  await markAdminAuthTokenUsed(request);
  formData = await request.formData();
} catch (...) {
  ...
} finally {
  releaseMultipartParseSlot();
}
```

Add a focused route/unit test that mocks `markTokenUsed()` to reject after a slot is acquired, asserts the request fails without leaving the slot held, then asserts a following LR upload can pass the parse-slot gate.

## Manual-Validation Risks

No manual-only risk was promoted to a finding. External host state, production filesystem permissions, MySQL runtime state, NGINX/proxy headers, and actual CLIP weight files were not validated from this static lane; those require operator/runtime checks outside the repository.

## Final Sweep

Examined categories: routes/actions, data layer, DB/schema/migrations, image processing/queues, upload/restore, auth/session/rate-limit, client components, tests/gate scripts, deploy/runtime scripts, and cross-file interactions among queue/backfill/restore/auth/upload contracts.

Skipped categories: none in repository source. Runtime-only production state was out of scope for this review lane.

Validation evidence: static source review with targeted line reads across the listed surfaces. No tests were run because this lane was explicitly review-only and did not implement fixes.
