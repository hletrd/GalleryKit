# Run-10 Cycle 38 Aggregate Review

Date: 2026-07-08 KST
Repo: `/Users/hletrd/flash-shared/gallery`
Scope: Prompt 1 aggregate over Cycle 38 review lanes.
Start HEAD: `54083a2c`
Recovery note: the Cycle 38 subagent hit a usage-limit error after partial review and implementation. The orchestrator preserved the emitted review files, finished aggregation/planning, added narrow fixes, and completed gates/deploy.

## Agent Coverage

Completed review files:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/architect.md`
- `.context/reviews/critic.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/verifier.md`

AGENT FAILURES:

- Cycle 38 subagent `019f40d4-b1c0-7001-a783-838ab00e92d1` errored with a usage-limit message before returning an end-of-cycle report. The partial review/implementation artifacts were recovered in the main session.

## Deduplicated Findings

### AGG-C38-01 - Admin subpages remained left-clustered inside the centered admin shell

- Severity: Medium
- Confidence: High
- Status: Confirmed UI consistency issue
- Source findings: recovered partial Cycle 38 implementation, aligned with Cycle 37 admin centering fixes
- Regions: `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- Failure scenario: after Cycle 36/37 centered the admin shell and some subpages, Password, Tokens, and Users still used narrow `max-w-*` wrappers without `mx-auto`, leaving content visually stuck to the left inside the centered container.
- Resolution: implemented in `5c6a45a5`.

### AGG-C38-02 - Analytics privacy claim ignored temporary DB rate-limit IP storage

- Severity: Medium
- Confidence: High
- Status: Confirmed documentation/code-comment issue
- Source findings: `VER-C38-01`
- Regions: `apps/web/src/app/actions/public.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/rate-limit.ts:491-506`, `apps/web/src/db/schema.ts:244-251`
- Failure scenario: maintainers read "Full IPs are never stored" as a system-wide analytics privacy invariant, while `rate_limit_buckets.ip` can temporarily persist the raw client IP for abuse-control buckets.
- Resolution: comments now narrow the claim to analytics event rows and disclose temporary rate-limit bucket IP retention.

### AGG-C38-03 - Touch-target audit missed default raw text inputs

- Severity: Medium
- Confidence: High
- Status: Confirmed scanner gap
- Source findings: `VER-C38-02`
- Regions: `apps/web/src/__tests__/touch-target-audit.test.ts`
- Failure scenario: a future `<input className="h-8" />` defaults to a text input in HTML but could bypass the raw-input scanner because the scanner only looked for explicit text-like `type=` attributes.
- Resolution: added a default-input scanner pattern and fixtures for violating/compliant default text inputs.

### AGG-C38-04 - Privacy docs overstated GPS exclusion without the public-map exception

- Severity: Medium
- Confidence: High
- Status: Confirmed documentation mismatch
- Source findings: `DOC-C38-01`
- Regions: `CLAUDE.md:237`, `apps/web/src/lib/data.ts:1768-1816`, `apps/web/src/app/[locale]/(public)/map/page.tsx`
- Failure scenario: docs say GPS coordinates are excluded from public API responses, but public map projections intentionally expose coordinates for topics with `map_visible=true`.
- Resolution: `CLAUDE.md` now states the normal public API exclusion and the explicit public-map opt-in exception.

### AGG-C38-05 - Background capacity budgeting is fragmented across independent queues

- Severity: High
- Confidence: High
- Status: Confirmed architecture/performance risk
- Source findings: `CR38-01`, `PERF-C38-02`, `ARCH-38-01`, `TRC-C38-01`
- Regions: `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/clip-model.ts`
- Failure scenario: image queue, admin backfill, analytics writes, semantic work, and CLIP inference each enforce local caps but share DB/CPU capacity, so combined work can consume foreground headroom.
- Disposition: deferred; requires a shared resource coordinator and capacity policy.

### AGG-C38-06 - Single-writer topology is critical but production enforcement is warn-only

- Severity: High
- Confidence: High
- Status: Manual-validation topology risk
- Source findings: `ARCH-38-02`, `RISK38-01`
- Regions: `CLAUDE.md`, `apps/web/docker-compose.yml`, `apps/web/src/lib/single-writer-guard.ts`, `apps/web/src/instrumentation.ts`
- Failure scenario: a second process can keep serving against the same DB while process-local queues, rate limits, and restore fences assume a singleton writer.
- Disposition: deferred; needs operator topology decision or shared-state migration.

### AGG-C38-07 - Live edge/nginx policy is documented but not source-proved at deploy time

- Severity: Medium
- Confidence: High
- Status: Manual-validation operations risk
- Source findings: `ARCH-38-03`, `CRT38-04`, `SEC-C38-MV-01`, `TE-C38-04`, `M1`, `M2`
- Regions: `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/check-proxy-topology.mjs`, `CLAUDE.md`
- Failure scenario: app deploys can pass while host nginx/real-IP policy is stale or mismatched, causing missing public-page edge throttles or collapsed client-IP buckets.
- Disposition: deferred; needs host evidence/preflight design.

### AGG-C38-08 - Public projection ownership remains split across hand-mirrored field sets

- Severity: Medium
- Confidence: High
- Status: Confirmed maintainability/privacy risk
- Source findings: `ARCH-38-04`
- Regions: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`
- Failure scenario: future image columns or privacy decisions can drift between gallery, timeline, map, and search projections.
- Disposition: deferred; requires projection-module consolidation.

### AGG-C38-09 - Semantic/similar search duplicate brute-force request-path ranking

- Severity: Medium
- Confidence: High
- Status: Likely performance risk
- Source findings: `ARCH-38-05`, `PERF-C38-04`
- Regions: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Failure scenario: public routes repeatedly scan/decode/score embeddings in-process, duplicating ranking/enrichment logic and tying latency to scan limits.
- Disposition: deferred; needs shared ranking/index strategy.

### AGG-C38-10 - Public map can hydrate large marker/list payloads and lacks map-specific query proof

- Severity: Medium
- Confidence: High for payload risk; Medium for index risk
- Status: Confirmed/likely performance risk
- Source findings: `CR38-03`, `CR38-04`, `PERF-C38-03`, `ARCH-38-06`
- Regions: `apps/web/src/lib/data.ts:1766-1816`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/map-client.tsx`, `apps/web/src/db/schema.ts`
- Failure scenario: `/map` can render thousands of markers plus fallback rows in one request, while DB filtering depends on GPS/map-visible predicates without production-sized query proof.
- Disposition: deferred; needs clustering/paging and EXPLAIN evidence.

### AGG-C38-11 - SQL restore is fenced, but file-state consistency is outside the app boundary

- Severity: Medium
- Confidence: High
- Status: Manual-validation operations risk
- Source findings: `ARCH-38-07`
- Regions: `apps/web/src/app/[locale]/admin/db-actions.ts`, upload/resource directories, `CLAUDE.md`
- Failure scenario: DB restore can roll rows back without rolling host files back, leaving operators dependent on host-level file backups/reconciliation.
- Disposition: deferred; existing docs note SQL-only restore, but full rollback needs operator tooling.

### AGG-C38-12 - Storage abstraction remains quarantined but looks usable

- Severity: Low
- Confidence: High
- Status: Maintainability risk
- Source findings: `ARCH-38-08`
- Regions: `apps/web/src/lib/storage/*`
- Failure scenario: future agents may wire the placeholder storage abstraction into runtime despite the current local-filesystem-only deployment contract.
- Disposition: deferred; requires product decision before storage-provider work.

### AGG-C38-13 - Migration reconcile coverage is source-based, not structural parity proof

- Severity: Medium
- Confidence: Medium
- Status: Test-depth gap
- Source findings: `ARCH-38-09`, `VER-C38-03`
- Regions: `apps/web/scripts/migrate.js`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`
- Failure scenario: a fresh/reconciled DB can differ in types/defaults/indexes while source tripwires still pass because names appear in `migrate.js`.
- Disposition: deferred; needs disposable MySQL schema parity test/script.

### AGG-C38-14 - Deploy failure path can skip disk cleanup on a constrained host

- Severity: Medium
- Confidence: High
- Status: Confirmed operations risk
- Source findings: `CRT38-01`
- Regions: `apps/web/deploy.sh`, `apps/web/src/__tests__/deploy-script-contract.test.ts`
- Failure scenario: failed health checks can exit before safe Docker cleanup runs, leaving cache/image pressure that makes the next recovery harder.
- Disposition: deferred; needs careful failure-path cleanup contract.

### AGG-C38-15 - Smart collection authoring bypasses validated actions in the documented workflow

- Severity: Medium
- Confidence: Medium
- Status: Likely product/testability issue
- Source findings: `CRT38-02`
- Regions: `CLAUDE.md`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/lib/smart-collections.ts`, public collection route/tests
- Failure scenario: direct DB inserts can create invalid smart-collection JSON that later becomes a silent public 404.
- Disposition: deferred; needs admin UI or operator validation script.

### AGG-C38-16 - CLIP production-readiness proof is outside normal blocking gates

- Severity: Medium
- Confidence: High
- Status: Manual-validation operations risk
- Source findings: `CRT38-03`, `VER-C38-04`, `TE-C38-07`
- Regions: `apps/web/package.json`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, CLIP tests/runbook
- Failure scenario: CLIP-touching changes can pass standard CI without real model-weight load/ranking proof.
- Disposition: deferred; needs path-filtered preflight or activation artifact.

### AGG-C38-17 - Browser upload and GPS stripping still have empirical memory/transport assumptions

- Severity: Medium
- Confidence: Medium
- Status: Manual-validation risk
- Source findings: `CRT38-05`, `L1`, `L2`
- Regions: `apps/web/src/app/actions/images.ts`, Server Action upload config, GPS strip/process paths
- Failure scenario: near-limit browser uploads can double-buffer during GPS stripping and plural-file upload UI can imply a contract larger than the Server Action cap.
- Disposition: deferred; needs empirical RSS measurement and possible upload-path redesign.

### AGG-C38-18 - Site-config carries Atik production defaults into copied builds

- Severity: Medium
- Confidence: High
- Status: Confirmed packaging/branding risk
- Source findings: `CR38-02`, `DOC-C38-03`
- Regions: `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`, README files
- Failure scenario: a copied worktree can build with Atik metadata/links unless the operator checks/replaces the tracked config.
- Disposition: deferred; this invocation explicitly targets `gallery.atik.kr`; public distribution policy needs a separate decision.

### AGG-C38-19 - Sidecar and semantic writers do not share one host-wide capacity/ownership gate

- Severity: Medium
- Confidence: Medium-High
- Status: Likely/manual-validation operations risk
- Source findings: `CR38-05`, `TRC-C38-02`, `TRC-C38-MV-01`
- Regions: `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-alt-text.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/clip-model.ts`
- Failure scenario: live queue embedding/bootstrap or sidecars can compete with operator backfills and public CLIP inference for DB/model capacity despite per-task advisory locks.
- Disposition: deferred; needs cross-process budget/lease policy.

### AGG-C38-20 - Admin PATs can be issued without expiry

- Severity: Low-Medium
- Confidence: High
- Status: Operational security risk
- Source findings: `SEC-C38-MV-03`
- Regions: `apps/web/src/lib/admin-tokens.ts`, admin Tokens page/action paths
- Failure scenario: long-lived Lightroom/API tokens rely entirely on operator rotation/revocation discipline.
- Disposition: deferred; needs product/security policy on default expiry.

### AGG-C38-21 - Database backups are plaintext at rest

- Severity: Medium
- Confidence: High
- Status: Manual-validation security/operations boundary
- Source findings: `SEC-C38-MV-02`
- Regions: DB backup/download/restore docs and scripts
- Failure scenario: SQL backups rely on host/operator filesystem controls rather than application-level encryption.
- Disposition: deferred; needs backup storage/encryption policy.

### AGG-C38-22 - Test strategy still has source-contract and browser-matrix gaps

- Severity: Medium
- Confidence: High
- Status: Test-depth gap
- Source findings: `TE-C38-01`, `TE-C38-02`, `TE-C38-03`, `TE-C38-05`, `TE-C38-06`
- Regions: image queue tests, upload E2E fixtures, nav visual E2E, Playwright config, Vitest coverage config
- Failure scenario: source-shape tests can miss behavior regressions, upload E2E uses unrealistic images, screenshot artifacts are not visual oracles, and CI is desktop Chromium only.
- Disposition: deferred; requires broader test-infrastructure work.

### AGG-C38-23 - API middleware comment can mislead future admin API authors

- Severity: Low
- Confidence: High
- Status: Documentation/comment risk
- Source findings: `DOC-C38-02`
- Regions: `apps/web/src/lib/api-auth.ts`
- Failure scenario: wording around historical `isAdmin()` checks can be misread as suggesting direct `isAdmin()` use for new admin APIs instead of `withAdminAuth(...)`.
- Disposition: deferred; low-risk comment cleanup.

## Scheduled In Cycle 38

- `AGG-C38-01` admin page centering.
- `AGG-C38-02` analytics privacy wording.
- `AGG-C38-03` default raw input touch-target audit.
- `AGG-C38-04` GPS docs public-map exception.
- Cycle 38 provenance recovery: review aggregate, plan/deferred register, gates, signed push, deploy, and live smoke.

## Deferred

All other aggregate rows are recorded in `.context/plans/run10-cycle38/deferred.md` with severity/confidence, citations, reasons, and exit criteria.
