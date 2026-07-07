# Cycle 15/100 Deferred Findings - Recovery Run

Status: OPEN
Source: `.context/reviews/_aggregate.md` at HEAD `6256a988`

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, current `.context/reviews/_aggregate.md`, and current `.context/plans/**` indexes. No `.context/project/`, `.context/development/`, `.cursorrules`, `CONTRIBUTING.md`, or docs style/policy files were present in this checkout. Deferred work remains bound by repo policy: GPG-signed Conventional Commits with gitmoji, `git pull --rebase` before push, no force-push, no `--no-verify`, full quality gates, and approved deploy flow when picked up.

Security/correctness/data-loss handling: concrete auth/session, restore, privacy, SQL scanner, and state-reset defects are scheduled in `.context/plans/cycle-15-2026-07-08-plan.md`. Items below are deferred because they are performance/scale work, broad schema/architecture work, UX/product design, validation infrastructure, or explicit operator-boundary risks documented by repo policy. Severity/confidence is preserved.

## Deferred Items

### C15-D01 - Byte-impacting settings commit before derivatives are regenerated

- Finding: `AGG-C15-10`
- Citation: `.context/reviews/_aggregate.md:153`; source citations include `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/src/lib/settings-hash.ts:1-20`, `apps/web/src/lib/serve-upload.ts:240-258`, `apps/web/next.config.ts:60-72`
- Original severity/confidence: Medium / High
- Reason for deferral: Repo policy explicitly documents this as an operational gotcha rather than an immediate code-fix mandate: `CLAUDE.md` states flipping color/quality/size settings does not invalidate existing static derivative bytes until a backfill re-encode runs. A durable derivative-generation redesign is broad media architecture work.
- Exit criterion: Re-open when implementing derivative generations/versioned filenames, when a settings-save flow needs first-class pending-regeneration state, or if operators report mixed bytes after settings changes despite following the backfill runbook.

### C15-D02 - Single-writer invariant is warn-only while state is process-local

- Finding: `AGG-C15-11`
- Citation: `.context/reviews/_aggregate.md:164`; source citations include `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/rate-limit.ts`
- Original severity/confidence: High if scale-out occurs / High
- Reason for deferral: `CLAUDE.md` "Runtime topology" explicitly defines the shipped deployment as a single web-instance / single-writer topology and states process-local state weakens under scale-out. Failing readiness on contention or moving state to durable coordination is a product/ops architecture decision, not a safe narrow cycle patch.
- Exit criterion: Re-open before horizontal scaling, blue/green multi-live deployment, or if live evidence shows more than one writer process.

### C15-D03 - Background image queue and backfill capacity budgets do not compose

- Finding: `AGG-C15-12`, `AGG-C15-13`
- Citation: `.context/reviews/_aggregate.md:175`, `.context/reviews/_aggregate.md:186`; source citations include `apps/web/src/db/index.ts:21-41`, `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/scripts/backfill-color-pipeline.ts:383-387`
- Original severity/confidence: High / High
- Reason for deferral: Performance/resource architecture requiring a shared capacity semaphore or maintenance lease across web and sidecar processes. It is not an auth/security/data-loss defect under the documented single-admin operational model, and sidecar work is operator-run.
- Exit criterion: Re-open when a background-capacity design cycle is scheduled, if pool starvation is observed, or before raising any background concurrency defaults.

### C15-D04 - Public map can hydrate up to 10,000 markers plus duplicate list rows

- Finding: `AGG-C15-14`
- Citation: `.context/reviews/_aggregate.md:197`; source citations include public map route and map client/list rendering
- Original severity/confidence: High / High
- Reason for deferral: Scale/performance UX architecture requiring clustering, viewport APIs, virtualization, and representative GPS-heavy data. No current security/data-loss defect is identified.
- Exit criterion: Re-open when GPS-enabled public galleries approach the cap, when map performance is measured as poor, or when map API/index work is scheduled.

### C15-D05 - Public dynamic route flood protection depends on live host nginx state

- Finding: `AGG-C15-15`
- Citation: `.context/reviews/_aggregate.md:208`; source citations include `apps/web/nginx/default.conf` and deploy helper docs
- Original severity/confidence: High if host config is stale / Medium
- Reason for deferral: `CLAUDE.md` "Applying host-nginx config changes" explicitly states deploys do not touch host nginx and host apply/verify is operator-owned. This cycle is authorized to run `npm run deploy`, not manual host-nginx reload/probe work.
- Exit criterion: Re-open when an operator applies or changes host nginx, when adding a deploy topology probe, or if edge limiter state is uncertain before a release.

### C15-D06 - Docker production image is not built by normal quality workflow and native pins can drift

- Finding: `AGG-C15-17`, `AGG-C15-18`
- Citation: `.context/reviews/_aggregate.md:230`, `.context/reviews/_aggregate.md:241`; source citations include `.github/workflows/quality.yml`, `apps/web/Dockerfile`, `package-lock.json`
- Original severity/confidence: Medium / High
- Reason for deferral: CI/Docker workflow expansion is broader release-infrastructure work. Per-cycle deploy still builds the production image through the repo deploy helper, so this is a pre-merge/CI detection gap rather than an unfixed runtime bug in this cycle.
- Exit criterion: Re-open when editing Dockerfile/native dependencies, changing CI gates, or after any native package drift incident.

### C15-D07 - Public shared-group reads still have view-count write side effects

- Finding: `AGG-C15-19`
- Citation: `.context/reviews/_aggregate.md:252`
- Original severity/confidence: Medium / High
- Reason for deferral: Boundary cleanup may alter analytics semantics and needs a focused data-access refactor. No concrete data-loss/security failure is shown in current documented best-effort analytics behavior.
- Exit criterion: Re-open when refactoring shared-group analytics or if SSR/read-path side effects cause a correctness incident.

### C15-D08 - Public listing and smart-collection pages aggregate tags before page limits

- Finding: `AGG-C15-20`
- Citation: `.context/reviews/_aggregate.md:263`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Query-shape optimization requiring careful SQL/test coverage across listing and collection paths; no current correctness or security defect.
- Exit criterion: Re-open with slow-query evidence or a planned listing query optimization cycle.

### C15-D09 - Home On This Day query is non-sargable

- Finding: `AGG-C15-21`
- Citation: `.context/reviews/_aggregate.md:274`; source citation includes `apps/web/src/components/on-this-day-widget.tsx:15-22`
- Original severity/confidence: Medium / High
- Reason for deferral: Requires generated columns or schema/index migration; repo migration rules require SQL file, journal `when`, Drizzle schema, and reconcile updates. Not safe to fold into this restore/auth correctness cycle.
- Exit criterion: Re-open during a schema/index cycle or if home render latency is measured from this query.

### C15-D10 - Color-pipeline backfill candidate scans lack an index

- Finding: `AGG-C15-22`
- Citation: `.context/reviews/_aggregate.md:285`
- Original severity/confidence: Medium / High
- Reason for deferral: Requires schema/index migration and production-like query validation. It is an operator/admin backfill performance issue, not data loss.
- Exit criterion: Re-open during a backfill/index migration cycle or if backfill candidate scans are slow at production scale.

### C15-D11 - Batch deletion repeats full derivative-directory scans

- Finding: `AGG-C15-23`
- Citation: `.context/reviews/_aggregate.md:296`
- Original severity/confidence: Medium / High
- Reason for deferral: Admin I/O performance refactor with filesystem failure aggregation semantics. Current behavior is correct but inefficient.
- Exit criterion: Re-open for high-volume deletion work or if deletion latency becomes operationally significant.

### C15-D12 - Admin analytics concurrent aggregates contend for DB pool

- Finding: `AGG-C15-24`
- Citation: `.context/reviews/_aggregate.md:307`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Admin analytics workload budgeting/caching design overlaps with the broader background-capacity work and needs measurement.
- Exit criterion: Re-open with analytics latency/pool contention evidence or when redesigning admin analytics.

### C15-D13 - Timeline year discovery uses `YEAR(capture_date)`

- Finding: `AGG-C15-25`
- Citation: `.context/reviews/_aggregate.md:318`
- Original severity/confidence: Low / Medium
- Reason for deferral: Low-priority query/index optimization that needs migration/index planning if fixed with generated columns.
- Exit criterion: Re-open during timeline/index work or if timeline year discovery is measured slow.

### C15-D14 - Public text search and smart-collection contains predicates are scan-oriented

- Finding: `AGG-C15-26`
- Citation: `.context/reviews/_aggregate.md:329`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Search architecture work requiring full-text/index strategy or product/operator limits. No immediate correctness/security failure.
- Exit criterion: Re-open when search latency grows, when adding full-text support, or when changing smart-collection predicate design.

### C15-D15 - Semantic search brute-forces embeddings inside the web process

- Finding: `AGG-C15-27`
- Citation: `.context/reviews/_aggregate.md:340`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Vector retrieval/ANN architecture. `CLAUDE.md` already documents `SEMANTIC_SCAN_LIMIT` as the bounded newest-first brute-force scan and production CLIP as operator-enabled.
- Exit criterion: Re-open when embedded corpus exceeds the scan limit, when semantic latency is measured high, or when vector-index work is scheduled.

### C15-D16 - Large multipart uploads use framework `FormData`

- Finding: `AGG-C15-28`
- Citation: `.context/reviews/_aggregate.md:351`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Streaming multipart parser adoption is a broad upload-route refactor with memory/RSS testing. Current limits and nginx caps are documented in `CLAUDE.md`.
- Exit criterion: Re-open with upload RSS/OOM evidence, before increasing upload limits, or when a streaming upload refactor is planned.

### C15-D17 - Semantic mode changes are not coordinated with long-running embedding writers

- Finding: `AGG-C15-29`
- Citation: `.context/reviews/_aggregate.md:362`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Semantic mode/backfill coordination design overlaps with multi-version embedding schema work already in carry-forward. Requires product/operator policy.
- Exit criterion: Re-open when enabling/changing production semantic search, when adding embedding leases, or when implementing multi-model embedding history.

### C15-D18 - Upload route duplicates browser upload orchestration

- Finding: `AGG-C15-31`
- Citation: `.context/reviews/_aggregate.md:384`
- Original severity/confidence: Medium / High
- Reason for deferral: Shared orchestration extraction is broad and risky around upload privacy/quota/HDR/GPS semantics. This cycle schedules concrete privacy/upload-path defects first.
- Exit criterion: Re-open when either upload path changes next, or when building branch-parity tests for upload workflows.

### C15-D19 - Coverage and browser validation strategy gaps

- Finding: `AGG-C15-47`, `AGG-C15-48`, `AGG-C15-49`, `AGG-C15-50`, `AGG-C15-51`, `AGG-C15-52`, `AGG-C15-53`, `AGG-C15-54`, `AGG-C15-55`, `AGG-C15-56`
- Citation: `.context/reviews/_aggregate.md:560`, `.context/reviews/_aggregate.md:571`, `.context/reviews/_aggregate.md:582`, `.context/reviews/_aggregate.md:593`, `.context/reviews/_aggregate.md:604`, `.context/reviews/_aggregate.md:615`, `.context/reviews/_aggregate.md:626`, `.context/reviews/_aggregate.md:637`, `.context/reviews/_aggregate.md:648`, `.context/reviews/_aggregate.md:659`
- Original severity/confidence: Medium/High through Low/Medium as recorded in aggregate
- Reason for deferral: Test strategy/browser matrix/coverage-policy work can create broad gate fallout and requires fixture, baseline, credentials, model-weight, or CI-capacity decisions. This cycle adds targeted tests for scheduled correctness fixes rather than adopting new global quality policy.
- Exit criterion: Re-open in a dedicated quality-infrastructure cycle, before requiring these gates as release criteria, or after a regression escapes the existing test suite.

### C15-D20 - Admin image-management UX backlog

- Finding: `AGG-C15-57`
- Citation: `.context/reviews/_aggregate.md:670`; source citations include `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/tag-input.tsx`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Existing UX backlog requiring authenticated browser validation, admin IA redesign, and responsive/a11y work. Current current-cycle designer lane did not add a new defect.
- Exit criterion: Re-open during an admin UX cycle or if authenticated runtime evidence reconfirms clipping/table-workbench failure.

### C15-D21 - Process/documentation overhead

- Finding: `AGG-C15-58`
- Citation: `.context/reviews/_aggregate.md:681`
- Original severity/confidence: Informational / n/a
- Reason for deferral: Informational process observation, not an implementation defect. This cycle partially addresses it by updating current aggregate and plan index.
- Exit criterion: Re-open if artifact navigation causes a concrete missed finding or stale-plan incident.
