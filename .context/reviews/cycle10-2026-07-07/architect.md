# Cycle 10 Architecture Review — 2026-07-07

Scope: repository-wide architecture/design risk review for `/Users/hletrd/flash-shared/gallery`, focused on layering, coupling, data flow, migration boundaries, deployment boundaries, and long-term maintainability.

Mode: read-only source review. I did not edit application source.

## File Inventory

Initial inventory was built before selecting review targets.

- Repository status at start: `## master...origin/master`; later sweep showed two pre-existing untracked cycle-10 reviewer artifacts, which I left untouched.
- `rg --files` returned 909 paths including generated/vendor outputs. Owned-file summary excluding `node_modules`, `.next`, `test-results`, and transient state:
  - `apps/`: 718 files
  - `plan/`: 182 files
  - `docs/`: 2 files
  - `scripts/`: 1 file
  - root docs/config: `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, `package-lock.json`, `LICENSE`
- Main source inventory under `apps/web/src`:
  - `src/__tests__`: 350 files
  - `src/lib`: 111 files
  - `src/app`: 81 files
  - `src/components`: 61 files
  - `src/db`: 3 files
  - plus `proxy.ts`, `instrumentation.ts`, `i18n`, `types`, and site config examples.
- Large architectural hot spots by line count:
  - `apps/web/src/lib/data.ts`: 1863 lines
  - `apps/web/src/lib/process-image.ts`: 1829 lines
  - `apps/web/src/app/actions/images.ts`: 1368 lines
  - `apps/web/src/lib/image-queue.ts`: 1311 lines
  - `apps/web/scripts/migrate.js`: 1050 lines
  - `apps/web/src/db/schema.ts`: 317 lines

## Reviewed Areas

- Project docs and operating model: `AGENTS.md`, `CLAUDE.md`, `README.md`, root/app `package.json`.
- Schema/migration boundary: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration/source-contract tests.
- Data access and privacy layering: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, privacy tests, client/server boundary tests.
- Runtime lifecycle: `apps/web/src/instrumentation.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, restore-maintenance and restore flow.
- Public API/search/data flow: semantic and similar search routes, smart-collection compiler, upload serving/path modules.
- Deployment boundary: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`.
- Prior-review context: cycle/reviewer notes under `.context/reviews`, especially recent cycle-10 artifacts and older architecture findings that shaped the current code.

## Findings

### ARCH-C10-01 — Drizzle schema lies about the physical semantic embedding type

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/db/schema.ts:271-291`, `apps/web/drizzle/0012_image_embeddings.sql:5-8`, `apps/web/scripts/migrate.js:684-692`

The authoritative TypeScript schema declares `image_embeddings.embedding` as `text("embedding")`, while both the migration and legacy reconcile path create the column as `mediumblob`. The comments explicitly document this as an approximation and require application code to remember that mysql2 returns `Buffer`, not string.

Failure scenario: a future maintainer uses the Drizzle schema as an authority for migration generation, schema diffing, or type-driven refactoring. The toolchain sees `text`, production has `MEDIUMBLOB`, and a later migration/diff may propose or apply a text conversion. That can corrupt binary vectors through charset handling, truncate/churn schema definitions, or perpetuate the need for `unknown` casts and defensive decode paths across writers/readers.

Concrete fix: replace the approximation with a Drizzle MySQL `customType` or local binary-column helper that emits `mediumblob` and exposes the runtime value as `Buffer`. Keep `embeddingToBuffer`/`decodeEmbeddingColumn` for boundary validation, but remove the schema lie and writer casts. Add a regression test that fails if `imageEmbeddings.embedding` is modeled as `text("embedding")` while committed SQL/reconcile create `mediumblob`.

### ARCH-C10-02 — Legacy reconcile is a second schema authority with name-only coverage

- Severity: Medium
- Confidence: High
- Location: `apps/web/scripts/migrate.js:348-730`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-18`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-102`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-171`

`reconcileLegacySchema` hand-writes the full database shape in JavaScript DDL. The coverage test is useful, but it explicitly says it is a “SOURCE tripwire” that cannot verify types or defaults; the actual assertions check only table/column/index-name presence in comment-stripped source. That leaves column definitions, nullability, defaults, `ON UPDATE`, foreign-key actions, and index column order as manually synchronized knowledge.

Failure scenario: a future migration changes an existing column default/type or index definition, and `migrate.js` merely mentions the same column or index name. The source tripwire passes, but a fresh or rebaselined database created through reconcile differs from a database that applied all migrations. The next failure appears only in production-like bootstrap/restore paths, for example wrong boolean defaults, missing timestamp `ON UPDATE`, or an index with the right name but wrong key order.

Concrete fix: add a structural schema-equivalence gate. The strongest version spins two disposable MySQL schemas: one produced by applying committed migrations, one produced by the reconcile/baseline path, then compares `information_schema` for column type, nullability, defaults, extra flags, indexes with ordered columns, and FK update/delete rules. If a live DB is too heavy for every unit run, keep the source tripwire but add a CI/integration job and targeted parser checks for high-risk tables such as `images`, `image_embeddings`, analytics tables, and auth/session tables. Longer term, generate reconcile DDL from migrations or a schema snapshot instead of maintaining a second authority by hand.

### ARCH-C10-03 — Maintenance scheduler startup has no production shutdown owner

- Severity: Low
- Confidence: High
- Location: `apps/web/src/instrumentation.ts:7-10`, `apps/web/src/instrumentation.ts:49-59`, `apps/web/src/lib/maintenance-scheduler.ts:56-88`

The app starts the maintenance scheduler during Node instrumentation startup before bootstrapping the image queue. Shutdown drains the image queue, shared-group view-count buffer, background DB writes, and the single-writer guard, but it does not stop the maintenance interval or await an active maintenance sweep. The scheduler exposes `drainMaintenanceSweepsForRestore()` and `stopMaintenanceSchedulerForTests()`, but no production stop/drain path.

Failure scenario: current maintenance tasks are idempotent cleanup work, so the immediate user impact is limited. Still, a SIGTERM during an audit/rate-limit/session/view-retention sweep can be reported as a clean drain while scheduler DB work is still in flight or about to be truncated by `process.exit()`. More importantly, future code may add non-idempotent maintenance work to this scheduler and inherit an asymmetric lifecycle contract.

Concrete fix: promote a production shutdown API such as `stopMaintenanceScheduler({ timeoutMs })` that clears the interval and awaits `activeMaintenanceSweeps` using the existing restore-drain logic. Call it from `instrumentation.ts` inside the existing shutdown `Promise.all`, and add a source-contract test next to `maintenance-scheduler-source.test.ts` that asserts startup and shutdown ownership stay paired.

### ARCH-C10-04 — Shared-group view-count buffering still lives inside the broad data layer

- Severity: Low
- Confidence: High
- Location: `apps/web/src/lib/data.ts:13-249`, `apps/web/src/instrumentation.ts:49-57`

`data.ts` is both the broad query/read-model module and the owner of a process-lifetime debounced write buffer with timers, retry maps, outage backoff, chunking, shutdown flushing, and restore suppression. The implementation has many hardening comments and targeted tests, but the lifecycle state remains hidden in a 1800+ line data-access file that otherwise looks like query composition and select-field ownership.

Failure scenario: a future query-layer refactor or privacy/select-field change in `data.ts` accidentally touches timer/buffer behavior, or another background write path copies this pattern into the data layer instead of using the explicit lifecycle modules. The app already needs instrumentation shutdown to know about this special state, which is a sign the module boundary is doing two jobs.

Concrete fix: extract the buffer into a dedicated module such as `lib/shared-group-view-count-buffer.ts` or `lib/view-count-buffer.ts`. Keep public call sites stable by re-exporting a narrow function from `data.ts` if necessary, but move timer state, retry caps, and shutdown flush ownership into the lifecycle-named module. This is mostly a maintainability/layering fix, not a current correctness bug.

### ARCH-C10-05 — Host nginx changes remain outside the deploy boundary

- Severity: Medium
- Confidence: High
- Location: `CLAUDE.md:483-495`, `apps/web/deploy.sh:51-55`, `apps/web/nginx/default.conf:1-29`

The repository contains nginx policy that materially affects public traffic shaping and edge behavior, including `zone=public`, `zone=nextimage`, connection limits, and real-IP caveats. The runbook clearly states that deploys do not touch host nginx and that committed config changes are inert until an operator applies them manually. `deploy.sh` only rebuilds/starts Docker Compose and performs health checks/pruning.

Failure scenario: a security or performance fix lands in `apps/web/nginx/default.conf`, `npm run deploy` succeeds, and the team treats the finding as closed because the repo is current. Production still runs the old host nginx config, so public SSR/image optimizer rate limits, body caps, or forwarding fixes are absent or stale until a separate manual operation happens. This is especially risky because the app and deploy policy otherwise present `npm run deploy` as the per-iteration production path.

Concrete fix: keep host nginx manual if that is the desired operational boundary, but make drift visible and blocking enough to prevent false closure. Add a deploy-time or CI check that compares the committed template hash/version against a recorded deployed hash, then prints or fails with “nginx prod-apply pending” when they differ. If config ownership should move into the deploy path, gate it behind explicit env configuration and run `nginx -t` before reload; otherwise record the pending apply state in the cycle ledger automatically.

## Final Missed-Issues Sweep

I performed a final sweep after the targeted inspection:

- Searched for architectural warning markers and deferred-work hints with `rg "TODO|FIXME|HACK|XXX|temporary|workaround|defer|manual apply|not implemented"` across docs/source/reviews, excluding generated/vendor outputs.
- Rechecked deployment docs and nginx/deploy line references.
- Rechecked schema/reconcile/test line references for migration-boundary claims.
- Rechecked lifecycle startup/shutdown line references for scheduler ownership.
- Rechecked current git status to avoid touching unrelated untracked reviewer artifacts.

I did not run the full lint/typecheck/test/build gates because this was a no-source-edit architecture review. The evidence above is from static repository inspection and source-contract review.
