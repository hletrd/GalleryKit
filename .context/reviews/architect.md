# Cycle 1 Group A — Architect Review

Date: 2026-07-18 KST
Review HEAD: `64f6ac63`
Role: boundaries, ownership, layering, deployment topology, data consistency
Mode: review-only.

## Architecture inventory

After reading `AGENTS.md` and `CLAUDE.md`, I mapped the runtime into these ownership domains and inspected their implementation/configuration and interaction tests: Next App Router public/admin surfaces; server actions and route-handler gates; Drizzle/MySQL pool and schema; process-local queue/rate-limit/maintenance state; advisory-lock ownership; upload/original/derivative stores; image/CLIP processing; public data projections; migration+journal+legacy reconcile; Next standalone packaging; Docker/host-nginx deployment; and restore/backup operations. All 709 app/script/migration/e2e files were inventoried; relevant modules in each domain were examined, with binary fixtures, generated/dependency output, historical archives, and live host state excluded.

## Findings

### ARCH-A-01 — A correctness-critical single-writer invariant is enforceable only by logs

- Severity: High
- Confidence: High
- Classification: confirmed topology risk; unresolved carry-forward
- Citations: `apps/web/docker-compose.yml:12-27`; `apps/web/src/lib/single-writer-guard.ts:218-235`; `apps/web/src/lib/single-writer-guard.ts:277-309`; `apps/web/src/instrumentation.ts:22-31`
- Problem: process-local restore fencing, upload quota state, queue ownership, rate-limit fast paths, backfill status, and buffered counts all rely on one web process. The guard detects a second instance but explicitly continues serving, and even guard initialization failure is non-fatal.
- Failure scenario: an operator briefly launches a second container during manual recovery or changes orchestration to two replicas. Both accept mutations against the same DB while holding independent in-memory coordinators. The warning may be missed, allowing weakened rate limits, competing queue jobs, and restore/write races at the topology boundary.
- Concrete fix: add an explicit production enforcement mode that fails readiness/startup after the rolling-deploy reprobe window when another holder persists. Keep warn-only as an intentional opt-out for recovery, or migrate every process-local correctness state to shared durable coordination before supporting replicas.

### ARCH-A-02 — Background resource ownership is local to modules rather than the process

- Severity: High
- Confidence: High
- Classification: confirmed resource-architecture flaw; unresolved carry-forward
- Citations: `apps/web/src/db/index.ts:21-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`; `apps/web/src/lib/background-db-writes.ts:3-75`; `apps/web/src/lib/clip-model.ts`
- Problem: the upload queue, admin color backfill, analytics queue, embedding bootstrap, and CLIP inference each own separate concurrency controls while sharing the same ten DB connections, CPU, libvips threads, and process RSS. Module-local caps cannot prove a process-wide foreground reserve.
- Failure scenario: two independently safe background modes overlap and consume nearly all DB connections and CPU. Public reads then queue behind long encoding/inference tasks, despite comments in each module claiming half-pool headroom.
- Concrete fix: introduce one process-wide weighted scheduler with explicit DB-connection, CPU, and memory costs. Foreground work should own a non-borrowable reserve; background lanes should expose pause/drain semantics through this coordinator.

### ARCH-A-03 — Semantic embedding has several writers but no shared ownership protocol

- Severity: Medium
- Confidence: High
- Classification: confirmed coordination gap with performance consequences; unresolved carry-forward
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:109-131`; `apps/web/src/app/actions/embeddings.ts`; `apps/web/src/lib/image-queue.ts:501-539`; `apps/web/src/lib/image-queue.ts:542-637`; `apps/web/src/lib/clip-model.ts`
- Problem: the sidecar/admin backfill observes `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, but live post-upload embedding and `bootstrapMissingActiveEmbeddings()` only observe restore maintenance. Idempotent upsert avoids row corruption, yet ownership of inference/model/DB capacity remains split.
- Failure scenario: an operator runs a forced production embedding backfill while the live queue scans missing rows and public semantic queries need the same model resources. Duplicate inference work increases queue timeouts/503s and extends activation convergence.
- Concrete fix: route all embedding writes through a durable job/lease owner, or require live bootstrap to observe the semantic backfill lease and defer. If uploads must continue, reserve separate public inference capacity and prove it under backfill load.

### ARCH-A-04 — Public data contracts are split across hand-mirrored modules

- Severity: Medium
- Confidence: High
- Classification: maintainability/privacy architecture risk; unresolved carry-forward
- Citations: `apps/web/src/lib/data.ts:251-488`; `apps/web/src/lib/data-timeline.ts:17-80`; `apps/web/src/lib/search-enrichment-fields.ts:1-46`
- Problem: each public surface defines its own projection. Compile-time deny guards are valuable but operate after a column has been classified sensitive and do not provide one positive owner for public fields or aggregations.
- Failure scenario: a schema evolution updates gallery cards but not timeline/search, or a new sensitive field is copied into a public mirror before the sensitive-key union is extended. Different routes expose inconsistent data while each local type guard passes.
- Concrete fix: derive public projections from a canonical module with narrow typed extensions (map coordinates behind opt-in, search metadata, admin diagnostics). Make a schema change update one owner and retain runtime privacy fixtures.

### ARCH-A-05 — Migration correctness has dual implementations without structural parity proof

- Severity: Medium
- Confidence: Medium-High
- Classification: test/architecture gap; unresolved carry-forward
- Citations: `apps/web/scripts/migrate.js`; `apps/web/drizzle/meta/_journal.json`; `apps/web/src/db/schema.ts`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:1-19`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:76-180`
- Problem: current schema is represented in Drizzle schema/migrations and again in `reconcileLegacySchema`. Tests largely prove that names appear in executable source, with a few structural pins; they do not compare types, nullability, defaults, collations, complete indexes, or foreign-key actions in two disposable databases.
- Failure scenario: a new column exists in both places but has a different default/type, so normal migration upgrades and legacy/fresh reconcile installs behave differently while source-name tripwires pass.
- Concrete fix: create two disposable MySQL schemas—one migrated normally and one reconciled/baselined—and diff normalized `information_schema` tables, columns, indexes, and constraints as a blocking integration gate.

### ARCH-A-06 — Database restore and file-state restore have separate operational owners

- Severity: Medium
- Confidence: High
- Classification: explicit operational consistency boundary; unresolved carry-forward/manual validation
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts`; `apps/web/docker-compose.yml:24-32`; `CLAUDE.md` “Database Security” and “Important Notes”
- Problem: the app correctly fences and restores SQL rows, but original uploads, derivatives, and topic resources are independent bind-mounted state. The product exposes database restore without a paired manifest/reconciliation mechanism for those stores.
- Failure scenario: an operator restores yesterday’s SQL dump against today’s files. Rows can reference absent originals/derivatives or current files can become unreferenced; the SQL operation succeeds because file rollback is intentionally outside its transaction.
- Concrete fix: keep the SQL-only label, but add an operator-owned backup manifest/reconciliation command that reports missing and orphaned files before/after restore. A future full backup feature should snapshot DB and mutable stores under one maintenance window.

## Architectural non-findings

- Restore lock ordering and drain coverage are coherent at current HEAD: durable maintenance, queue side effects, background writes, maintenance sweeps, view buffers, and admin mutation slots are all covered before import.
- The current standalone build contains `geoip-lite` data after externalization; no new package-boundary violation was found.
- Admin-only image metadata remains protected by type and fixture guards, and the map coordinates remain a narrow `map_visible=true` extension.
- Docker persistence remains bind-mounted and automatic volume pruning still omits `-a`.

## Final sweep

The missed-architecture sweep covered circular dependencies, shared mutable globals, worker/sidecar ownership, distributed topology assumptions, schema evolution, cache invalidation, public projection boundaries, restore/file consistency, external package tracing, and deploy/host ownership. No additional architectural issue was confirmed.
