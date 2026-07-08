# Run-10 Cycle 38/100 Deferred Findings

Date: 2026-07-08 KST
Aggregate: `.context/reviews/_aggregate.md`
Status: OPEN

## Repo Rules Read Before Deferral

- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`
- Current Cycle 38 reviews under `.context/reviews/*.md`
- `README.md`
- `apps/web/README.md`

No `.cursorrules` or `CONTRIBUTING.md` file exists in this checkout.

Security, correctness, and data-loss items that were safe and narrow in this recovery were scheduled in `plan.md` (`AGG-C38-02`, `AGG-C38-03`, `AGG-C38-04`). The rows below are deferred because they are broad architecture, operator topology, product policy, or test-infrastructure changes that need separate design/measurement. They remain bound by repo git, test, deploy, and documentation rules when reopened.

## Deferred Items

### AGG-C38-05 - Background capacity budgeting is fragmented across independent queues

- Original severity/confidence: High / High.
- Citations: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/admin-backfill-runner.ts`; `apps/web/src/lib/background-db-writes.ts`; `apps/web/src/app/actions/embeddings.ts`; `apps/web/src/lib/clip-model.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: broad shared-resource architecture across image queue, admin backfill, analytics writes, semantic work, and CLIP inference. It is a performance/topology risk, not a confirmed data-loss or security bug in the current single-writer deployment.
- Exit criterion: schedule when changing queue/backfill/semantic concurrency, observing DB pool waits or foreground latency during overlapping background work, or when the carry-forward age budget requires reclassification.

### AGG-C38-06 - Single-writer topology is critical but production enforcement is warn-only

- Original severity/confidence: High / High.
- Citations: `CLAUDE.md`; `apps/web/docker-compose.yml`; `apps/web/src/lib/single-writer-guard.ts`; `apps/web/src/instrumentation.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: topology-policy decision. Converting the guard to fail-closed can affect rolling deploys and recovery operations, and horizontal scale would require shared durable state first.
- Exit criterion: schedule when changing deployment topology, adding `GALLERYKIT_ENFORCE_SINGLE_WRITER`, or seeing evidence of concurrent live web processes.

### AGG-C38-07 - Live edge/nginx policy is documented but not source-proved at deploy time

- Original severity/confidence: Medium / High.
- Citations: `apps/web/nginx/default.conf`; `apps/web/deploy.sh`; `scripts/check-proxy-topology.mjs`; `CLAUDE.md`; `.context/reviews/_aggregate.md`.
- Reason for deferral: host/live-topology validation risk. Adding `nginx -T` checksum checks or host preflight requires operator access and agreement on the infra ownership boundary.
- Exit criterion: schedule when editing nginx/proxy docs, deploy preflights, or moving behind a new CDN/LB/real-IP topology.

### AGG-C38-08 - Public projection ownership remains split across hand-mirrored field sets

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/data.ts`; `apps/web/src/lib/data-timeline.ts`; `apps/web/src/lib/search-enrichment-fields.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: shared data-access refactor across public gallery, timeline, map, and search surfaces. Requires broad parity tests and careful privacy review.
- Exit criterion: schedule when adding/changing public image fields or refactoring public projection modules.

### AGG-C38-09 - Semantic/similar search duplicate brute-force request-path ranking

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/app/api/search/semantic/route.ts`; `apps/web/src/app/api/search/similar/[id]/route.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: performance architecture change requiring ranking/index design and production-like measurement.
- Exit criterion: schedule when semantic/similar latency or scale becomes active work, or when introducing shared vector/ranking infrastructure.

### AGG-C38-10 - Public map can hydrate large marker/list payloads and lacks map-specific query proof

- Original severity/confidence: Medium / High for payload risk; Medium for index risk.
- Citations: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx`; `apps/web/src/components/map/map-client.tsx`; `apps/web/src/db/schema.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: map clustering/paging and schema index changes need browser traces and production-sized `EXPLAIN` evidence before implementation.
- Exit criterion: schedule when map rows approach thousands, map traces show long tasks, or map query/index work is otherwise opened.

### AGG-C38-11 - SQL restore is fenced, but file-state consistency is outside the app boundary

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts`; `CLAUDE.md`; upload/resource directories; `.context/reviews/_aggregate.md`.
- Reason for deferral: operator backup/reconciliation boundary. Current docs already state DB restore is SQL-only; full file rollback requires host backup tooling outside this app cycle.
- Exit criterion: schedule when designing full backup/restore, file reconciliation, or host-level rollback workflows.

### AGG-C38-12 - Storage abstraction remains quarantined but looks usable

- Original severity/confidence: Low / High.
- Citations: `apps/web/src/lib/storage/*`; `.context/reviews/_aggregate.md`.
- Reason for deferral: product decision needed before adding non-local storage support.
- Exit criterion: schedule when storage-provider support becomes explicit roadmap work.

### AGG-C38-13 - Migration reconcile coverage is source-based, not structural parity proof

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/scripts/migrate.js`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: requires disposable MySQL parity harness comparing migrated vs reconciled schemas. This is test-infrastructure work, not a known schema mismatch.
- Exit criterion: schedule when adding migration infrastructure or before the next schema-heavy migration series.

### AGG-C38-14 - Deploy failure path can skip disk cleanup on a constrained host

- Original severity/confidence: Medium / High.
- Citations: `apps/web/deploy.sh`; `apps/web/src/__tests__/deploy-script-contract.test.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: deploy-script failure-path cleanup needs careful ordering to preserve logs and avoid destructive cleanup semantics. Current successful deploy path still prunes safely after `up -d`.
- Exit criterion: schedule when editing deploy disk hygiene, health-check failure handling, or host disk pressure mitigation.

### AGG-C38-15 - Smart collection authoring bypasses validated actions in the documented workflow

- Original severity/confidence: Medium / Medium.
- Citations: `CLAUDE.md`; `apps/web/src/app/actions/collections.ts`; `apps/web/src/lib/smart-collections.ts`; public collection route/tests; `.context/reviews/_aggregate.md`.
- Reason for deferral: product/operator workflow choice. Fix needs an admin UI or import/validation script, not a narrow code comment.
- Exit criterion: schedule when building Collections admin UX or smart-collection import tooling.

### AGG-C38-16 - CLIP production-readiness proof is outside normal blocking gates

- Original severity/confidence: Medium / High.
- Citations: `apps/web/package.json`; `.github/workflows/quality.yml`; `.github/workflows/clip-preflight.yml`; CLIP tests/runbook; `.context/reviews/_aggregate.md`.
- Reason for deferral: CI model-weight availability and cost decision. Production CLIP activation remains operator-gated.
- Exit criterion: schedule when CLIP paths change, CI can cache/access weights, or semantic-search production activation is being changed.

### AGG-C38-17 - Browser upload and GPS stripping still have empirical memory/transport assumptions

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/app/actions/images.ts`; upload config; GPS strip/process paths; `.context/reviews/_aggregate.md`.
- Reason for deferral: requires measurement and possibly route/API redesign. No active OOM or upload failure was reproduced in this cycle.
- Exit criterion: schedule when changing browser upload limits/GPS strip strategy or after memory traces on near-limit uploads.

### AGG-C38-18 - Site-config carries Atik production defaults into copied builds

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/site-config.json`; `apps/web/src/site-config.example.json`; `apps/web/scripts/ensure-site-config.mjs`; README files; `.context/reviews/_aggregate.md`.
- Reason for deferral: this invocation targets `gallery.atik.kr`; changing tracked production defaults is a packaging/product decision.
- Exit criterion: schedule when preparing public distribution mode or requiring explicit deployment-specific config opt-in.

### AGG-C38-19 - Sidecar and semantic writers do not share one host-wide capacity/ownership gate

- Original severity/confidence: Medium / Medium-High.
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts`; `apps/web/scripts/backfill-color-pipeline.ts`; `apps/web/scripts/backfill-alt-text.ts`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/clip-model.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: cross-process host/DB budget design. Current advisory locks prevent duplicate sidecars but not all capacity contention.
- Exit criterion: schedule when editing sidecar concurrency, CLIP backfill ownership, or host-level sidecar preflight.

### AGG-C38-20 - Admin PATs can be issued without expiry

- Original severity/confidence: Low-Medium / High.
- Citations: `apps/web/src/lib/admin-tokens.ts`; admin Tokens page/actions; `.context/reviews/_aggregate.md`.
- Reason for deferral: security/product policy decision. Operators can currently revoke/rotate tokens; default expiry requires UX and compatibility decisions.
- Exit criterion: schedule when editing PAT lifecycle/security policy.

### AGG-C38-21 - Database backups are plaintext at rest

- Original severity/confidence: Medium / High.
- Citations: DB backup/download/restore docs and scripts; `.context/reviews/_aggregate.md`.
- Reason for deferral: host/operator storage-control boundary. App-level backup encryption requires separate key-management design.
- Exit criterion: schedule when changing backup storage, export encryption, or operational security docs.

### AGG-C38-22 - Test strategy still has source-contract and browser-matrix gaps

- Original severity/confidence: Medium / High.
- Citations: image queue tests, upload E2E fixtures, nav visual E2E, Playwright config, Vitest coverage config; `.context/reviews/_aggregate.md`.
- Reason for deferral: broad test-infrastructure work with runtime/flakiness implications.
- Exit criterion: schedule when adding behavior tests for queue cleanup, realistic upload fixtures, visual assertions, browser matrix, or coverage ratchets.

### AGG-C38-23 - API middleware comment can mislead future admin API authors

- Original severity/confidence: Low / High.
- Citations: `apps/web/src/lib/api-auth.ts`; `.context/reviews/_aggregate.md`.
- Reason for deferral: low-risk comment cleanup; the wrapper and lint gate already enforce `withAdminAuth(...)`.
- Exit criterion: schedule when editing API auth docs/comments or adding admin API authoring guidance.
