# Cycle 1 Group A — Tracer Review

Date: 2026-07-18 KST
Review HEAD: `64f6ac63`
Role: causal/data-flow tracing, competing hypotheses, cross-system invariants
Mode: review-only.

## Trace inventory

I read `AGENTS.md` and `CLAUDE.md`, inventoried all 709 app/script/migration/e2e files, and built causal traces for: request headers → client IP → rate limit/GeoIP → analytics rows; upload multipart → quota claim → original → GPS scrub → queue → derivatives/embedding → DB state; delete → retry ledger → filesystem; restore request → advisory locks → durable marker → drains → SQL import → reconciliation; queue/admin/sidecar concurrency → DB pool/CPU; semantic mode → model queue → embedding writers → public ranking; schema migration/journal → reconcile/baseline; and deploy → build/container health → pruning. Binary fixtures/generated output/live state were excluded.

## Findings

### TRC-A-01 — GeoIP error propagation is intentionally severed before durable analytics

- Severity: Medium
- Confidence: High
- Classification: confirmed causal observability gap; new in this review
- Trace: `apps/web/next.config.ts:54-59` external package contract → `apps/web/src/instrumentation.ts:12-20` swallowed prewarm error → `apps/web/src/lib/analytics.ts:36-61` swallowed/memoized lookup failure → `apps/web/src/app/actions/public.ts:415-425` `country_code` construction → analytics table inserts.
- Failure scenario: package/data resolution breaks. Both error boundaries collapse the cause into the legitimate sentinel `XX`; view insertion continues successfully, so no later layer can distinguish “unknown IP country” from “GeoIP subsystem broken.” A single startup failure therefore contaminates all country summaries without an alarm.
- Fix: preserve the cause as process health/telemetry state. Validate the runtime DB once at startup, log a production error, and expose a non-sensitive readiness diagnostic; do not log visitor IPs.

### TRC-A-02 — Background connection reservations do not compose

- Severity: High
- Confidence: High
- Classification: confirmed causal resource bug; unresolved carry-forward
- Trace: `apps/web/src/db/index.ts:31-42` ten-connection shared pool → `apps/web/src/lib/image-queue.ts:121-153` queue cap assuming its own reserve → `apps/web/src/lib/admin-backfill-runner.ts:109-142` second cap assuming the same reserve → `apps/web/src/lib/background-db-writes.ts:34-75` two analytics writers.
- Failure scenario: queue processing and admin backfill overlap. The backfill pins one run lock plus up to two connections per worker; queue workers can likewise hold claims plus transient updates. Analytics adds two requests. The “five free” conclusion in either module is false under composition, and public page fan-outs queue behind encoding work.
- Fix: replace per-module reserve arithmetic with a shared weighted admission ledger and an overlap proof at the default pool size.

### TRC-A-03 — Semantic backfill ownership does not reach live embedding writers

- Severity: Medium
- Confidence: High
- Classification: confirmed coordination gap; unresolved carry-forward
- Trace: `apps/web/scripts/backfill-clip-embeddings.ts:109-131` acquires `LOCK_SEMANTIC_EMBEDDING_BACKFILL` → `apps/web/src/lib/image-queue.ts:501-539` post-upload writer checks only restore maintenance → `apps/web/src/lib/image-queue.ts:542-637` missing-embedding scan does the same → `apps/web/src/lib/clip-model.ts` shared inference queue/model.
- Failure scenario: a forced sidecar backfill and live bootstrap choose the same missing image. Primary-key upsert prevents corruption, but both spend image decode/inference and DB capacity while public text/similar requests compete for inference slots. The semantic advisory lock serializes sidecars/restores, not the full writer set its name implies.
- Fix: make live writers observe the lease or place all writes in one durable job queue; reserve public inference separately if live writes must continue.

### TRC-A-04 — SQL restore has no causal reconciliation edge to mutable file stores

- Severity: Medium
- Confidence: High
- Classification: explicit consistency boundary/manual-validation risk; unresolved carry-forward
- Trace: DB restore action and migration/reconcile in `apps/web/src/app/[locale]/admin/db-actions.ts` → SQL row state; independent binds in `apps/web/docker-compose.yml:24-32` → originals, derivatives, topic resources.
- Failure scenario: restoring an older SQL snapshot reintroduces rows for files removed since the dump and removes rows for files created since it. Locks/drains make the SQL transition internally safe, but no post-restore manifest links the database generation to the filesystem generation.
- Fix: add an operator reconciliation report/manifest and document the required paired host snapshot generation. Full atomic restore requires one coordinated backup product boundary.

### TRC-A-05 — Deploy failure bypasses the only automatic disk-pressure relief

- Severity: Medium
- Confidence: High
- Classification: confirmed recovery-flow gap; unresolved carry-forward
- Trace: `apps/web/deploy.sh:51-55` build/up → `apps/web/deploy.sh:57-76` health gate/exit → `apps/web/deploy.sh:79-104` prune.
- Failure scenario: build or health fails after producing unused layers. The script exits before prune, so the failure itself consumes more disk and increases the chance that the next pull/build cannot run. This is a positive feedback loop on the host whose documented incident mode is disk exhaustion.
- Fix: collect failure evidence, then run the same safe unused-artifact cleanup in a trap. Preserve prune-after-up on success and the no-`-a` volume rule.

## Competing hypotheses resolved

- GeoIP is not currently absent: `.next/standalone/node_modules/geoip-lite/data` exists and contains country/city DB files. The broken edge is error observability.
- Semantic duplicate writers do not corrupt rows because the write is an idempotent primary-key/model-version upsert. The confirmed effect is duplicate resource consumption and public inference contention.
- Restore does not miss a currently known in-process writer: queue side effects, background DB writes, maintenance, buffered group counts, and admin mutations are drained; sidecars are covered by advisory locks/durable-marker checks.
- Upload quota check/claim is synchronous before post-claim awaits, and early awaited validation failures settle the claim.
- Delete/reencode races preserve cleanup through the pending-deletion ledger and affected-row/orphan cleanup checks.

## Final sweep

The closing trace sweep covered auth/origin → mutation, public limiter → expensive work, upload → disk/DB/queue, queue → embedding, delete → retry, restore → every known writer, migration cursor → SQL application, cache ETag → file replacement, request IP → analytics, and deploy → host recovery. No additional causal break was confirmed.
