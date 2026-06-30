# Cycle 42 Performance / Architecture Review

Reviewer lane: performance / architecture.
HEAD reviewed: `6efd00a8`.
Scope: review only. Source code was not edited; the only write from this lane is this review artifact.

## Inventory Built

- Current project guidance: `AGENTS.md`, `CLAUDE.md`.
- Latest aggregate/deferred state: `.context/reviews/_aggregate.md`, `.context/reviews/cycle-41-2026-07-01/_aggregate.md`, `.context/plans/cycle-41-2026-07-01-plan.md`, `.context/plans/cycle-41-2026-07-01-deferred.md`, and carried Cycle 29 deferrals.
- Image processing and background work: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`.
- DB/query paths and schema: `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, semantic-search routes, feed/sitemap/map/search paths.
- Cache/SW/upload serving: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/next.config.ts`.
- Scanner/lint architecture: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, related tests.
- Runtime/deploy topology: `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`, `apps/web/nginx/default.conf`, `apps/web/src/instrumentation.ts`.

## Findings

### PA-42-01 - `lint:action-origin` misses protected relational reads behind namespace `@/db` imports

Severity: Medium. Confidence: High.

Evidence: `collectDbReadNames()` only seeds the literal `db` name and named imports from the exact `@/db` module; it does not collect namespace imports such as `import * as database from '@/db'` (`apps/web/scripts/check-action-origin.ts:190` through `apps/web/scripts/check-action-origin.ts:209`). The protected-read matcher then requires the relational read shape to be `identifier.query.<table>.findFirst/findMany`, with that identifier present in the collected set (`apps/web/scripts/check-action-origin.ts:455` through `apps/web/scripts/check-action-origin.ts:470`). Existing coverage proves bare `db.query...` and named aliases, but not namespace `database.db.query...` (`apps/web/src/__tests__/check-action-origin.test.ts:520` through `apps/web/src/__tests__/check-action-origin.test.ts:533`, `apps/web/src/__tests__/check-action-origin.test.ts:1126` through `apps/web/src/__tests__/check-action-origin.test.ts:1150`). I verified the gap with `checkActionSource`: the named alias probe fails with `EXEMPT READ WITHOUT AUTH`, while the equivalent namespace import is reported as `SKIP (exempt comment)`. A current-source grep found no existing namespace `@/db` usage, so this is a guardrail false negative for future edits rather than a live route exposure.

Failure scenario: a future read-only admin server action can be exempted and written as:

```ts
import * as database from '@/db';

/** @action-origin-exempt: read-only admin lookup */
export async function loadSessions() {
  return database.db.query.sessions.findMany();
}
```

That reads protected session rows before `isAdmin()`, `getCurrentUser()`, or `requireSameOriginAdmin()`, but the lint gate treats the action as an acceptable exemption. This reopens the same scanner class as the recently fixed aliased named import, just through a different legal TypeScript import form.

Fix: extend `check-action-origin.ts` to collect namespace imports from `@/db` and recognize `namespace.db.query.<table>.findFirst/findMany` as protected reads. Add regression tests for unauthenticated and authenticated namespace shapes. If the scanner should fail closed instead, reject namespace `@/db` imports inside exempt action modules unless an auth check precedes every protected read.

### PA-42-02 - Production CLIP catch-up can run inside the web process without the semantic backfill lock

Severity: Medium. Confidence: Medium-High.

Evidence: the operator runbook makes production CLIP activation a deliberate sidecar flow: seed weights, run `scripts/backfill-clip-embeddings.ts --production --force`, repeat when `SEMANTIC_SCAN_LIMIT` is reached, then enable `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and set `semantic_search_mode='production'` (`CLAUDE.md:526` through `CLAUDE.md:553`). The sidecar serializes that work with `LOCK_SEMANTIC_EMBEDDING_BACKFILL` (`apps/web/src/lib/advisory-locks.ts:46` through `apps/web/src/lib/advisory-locks.ts:47`, `apps/web/scripts/backfill-clip-embeddings.ts:103` through `apps/web/scripts/backfill-clip-embeddings.ts:119`). Database restore also acquires the same semantic backfill lock before entering maintenance (`apps/web/src/app/[locale]/admin/db-actions.ts:429` through `apps/web/src/app/[locale]/admin/db-actions.ts:447`).

The web bootstrap path does not participate in that lock. Every queue bootstrap starts `bootstrapMissingActiveEmbeddings()` as a side effect (`apps/web/src/lib/image-queue.ts:975` through `apps/web/src/lib/image-queue.ts:981`). That function resolves the active semantic mode, selects processed rows missing the active model embedding in batches of 50, loops until no rows remain, and calls `storeImageEmbeddingForMode()` for each candidate (`apps/web/src/lib/image-queue.ts:395` through `apps/web/src/lib/image-queue.ts:450`). In production mode, `storeImageEmbeddingForMode()` calls `embedImageReal()` (`apps/web/src/lib/image-queue.ts:353` through `apps/web/src/lib/image-queue.ts:367`), which loads/runs the real ONNX CLIP encoder in the Node process with only the local inference queue as a concurrency bound (`apps/web/src/lib/clip-model.ts:53` through `apps/web/src/lib/clip-model.ts:64`, `apps/web/src/lib/clip-model.ts:273` through `apps/web/src/lib/clip-model.ts:324`). There is no semantic backfill advisory-lock check and no per-boot scan limit in this web-process catch-up path.

Failure scenario: an operator enables production after a sidecar run hits `SEMANTIC_SCAN_LIMIT`, or restarts the container while a production backfill/re-embed is still running. The sidecar believes it owns the semantic backfill lock, but the web process can select the same missing rows and run duplicate CLIP inference in parallel. On the single-host topology, that competes with request handling, uploads, Sharp image processing, and the sidecar itself for CPU/RSS; it can also make deploy/restart behavior depend on the size of the unfilled embedding backlog rather than on the documented sidecar completion point.

Fix: make production-mode `bootstrapMissingActiveEmbeddings()` acquire `LOCK_SEMANTIC_EMBEDDING_BACKFILL` non-blockingly before doing real CLIP catch-up, and skip/log when the lock is unavailable. Preferably keep automatic bootstrap catch-up for stub mode and recent upload side-effect recovery, but require the sidecar/admin backfill path for bulk production catch-up. Add a hard per-boot cap or reuse `SEMANTIC_SCAN_LIMIT` if the web path remains enabled, and add source/tests proving the web bootstrap cannot run production CLIP work concurrently with the sidecar/restore lock.

## Clean / Rechecked Surfaces

- Did not re-raise carried deferred items without new evidence: request-thread semantic/similar vector scoring (`D29-01`), map marker scale (`D29-02`), leading-wildcard public search scans (`D29-03`), exact count windows (`D29-06`), service-worker synchronous HEAD probes (`D29-08`), deploy liveness vs DB readiness (`D29-16`), feed/sitemap and pipeline-version index migrations (`PERF-C39-03`, `PERF-C39-04`), broad imported-helper side-effect classification (`AGG-C38-07`), and color sidecar keyset/memory work (`AGG-C38-08`).
- Image processing path still has bounded Sharp concurrency, disabled Sharp cache, per-image advisory locks, delete-race cleanup, restore-maintenance quiescing, and conditional processed-row updates. No new correctness/concurrency issue found beyond the production CLIP catch-up lock gap.
- DB/query/index review found only the already-carried scale issues above. Current schema/reconcile coverage and migration rules were inspected; no new journal/reconcile drift was found in this pass.
- Service worker/upload serving still separate admin bypass, derivative SWR, revocable HTML bypass, settings-hash ETags, and bounded image/HTML caches. No new cache correctness issue found beyond the already-carried synchronous HEAD tradeoff.
- Deploy/runtime scripts still reflect the documented single web service, bind-mounted persistent directories, health polling, and post-up Docker prune ordering. No new deploy-script finding was found in this pass.

## Validation Evidence

- `npm run lint:action-origin --workspace=apps/web` passed on current HEAD.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed on current HEAD.
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/image-queue-embed-wiring.test.ts src/__tests__/backfill-clip-embeddings-reembed.test.ts` passed: 3 files, 92 tests.
- Ad hoc scanner probes against `checkActionSource()` confirmed PA-42-01: named `db as database` relational reads fail as expected, but namespace `database.db.query.sessions.findMany()` under a reasoned `@action-origin-exempt` comment is skipped.
- Current-source grep found no live namespace `@/db` imports or `database.db.query...find*` reads under `apps/web/src` or `apps/web/scripts`; PA-42-01 is a scanner architecture risk for future edits.

## Final Sweep

New actionable findings: 2.
Source code edits: none.
Review artifact written: `.context/reviews/cycle-42-2026-07-01/perf-architect.md`.
