# Cycle 16/100 Deferred Findings

Date: 2026-06-30 KST
Status: OPEN

Repo rules reviewed before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, current `.context` review/plan history. No `.cursorrules`, `CONTRIBUTING.md`, or `docs/` policy files were present. These deferrals do not alter repo policies for future work: commits remain GPG-signed Conventional Commits with gitmoji, pushes require `git pull --rebase`, no force-push/destructive action without confirmation, and all quality gates remain blocking.

## Deferred Items

### C16-D01 - Demo domain can become a self-hosted deployment identity

- Finding: AGG-C16-01
- Citation: `apps/web/src/site-config.json:4`, `apps/web/scripts/ensure-site-config.mjs:12-21`, `apps/web/nginx/default.conf:21-24`, `README.md:8`, `README.md:148`
- Original severity/confidence: High / High
- Reason for deferral: The orchestrator explicitly selected the live `gallery.atik.kr` target for this per-cycle deployment. Replacing or rejecting the checked-in demo host without coordinating the live deployment environment can break the requested deploy path. This is a self-hosted packaging/product-identity risk, not a security, correctness, or data-loss bug for the selected target.
- Re-open criterion: Re-open before publishing generic self-hosted release artifacts, changing canonical-origin handling, or when the live demo deploy guarantees `BASE_URL`/host overrides independent of tracked config.

### C16-D02 - Batch image deletion repeats full derivative-directory scans

- Finding: AGG-C16-14
- Citation: `apps/web/src/app/actions/images.ts:807-845`, `apps/web/src/lib/process-image.ts:575-664`
- Original severity/confidence: Medium / High
- Reason for deferral: Admin I/O performance refactor requiring a new batch cleanup helper and failure aggregation semantics. It is not a security, correctness, or data-loss issue in ordinary delete volumes.
- Re-open criterion: Re-open when high-volume delete workflows are scheduled, deletion latency is observed, or derivative cleanup is redesigned.

### C16-D03 - GPS stripping materializes large originals in memory

- Finding: AGG-C16-15
- Citation: `apps/web/src/lib/process-image.ts:1738-1822`, `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:364-378`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance/memory architecture work requiring streaming scrubber design or a process-wide memory limiter and large-file fixtures. It is not a current correctness/security/data-loss defect.
- Re-open criterion: Re-open when upload OOM/GC pressure is observed, upload size limits change, or GPS stripping becomes default/high-volume.

### C16-D04 - Public map can hydrate/render up to 10k markers and fallback links

- Finding: AGG-C16-16
- Citation: `apps/web/src/lib/data.ts:1640-1676`, `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`, `apps/web/src/components/map/map-client.tsx:76-144`
- Original severity/confidence: Medium / Medium-High
- Reason for deferral: Scale/performance architecture item requiring bbox API, clustering, fallback-list design, and production-like browser evidence.
- Re-open criterion: Re-open when GPS-enabled public galleries approach the cap, map performance is measured as poor, or map API/index work is scheduled.

### C16-D05 - Semantic/similar search full decode/full sort scan cost

- Finding: AGG-C16-17
- Citation: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/lib/clip-embeddings.ts:135-168`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:143-177`
- Original severity/confidence: Low / Medium
- Reason for deferral: Performance optimization with bounded current defaults and rate limits. Not a correctness/security defect at current corpus/cap assumptions.
- Re-open criterion: Re-open when raising `SEMANTIC_SCAN_LIMIT`, observing search CPU/latency pressure, or implementing vector-index work.

### C16-D06 - Touch-target audit budgets by counts

- Finding: AGG-C16-20
- Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:183-199`, `apps/web/src/__tests__/touch-target-audit.test.ts:229-238`, `apps/web/src/__tests__/touch-target-audit.test.ts:764-788`
- Original severity/confidence: Low / High
- Reason for deferral: Test-design hardening for existing known-violation accounting. No current newly confirmed sub-44 target was identified.
- Re-open criterion: Re-open when changing touch-target audit budgets, removing known violations, or adding exemption-marker infrastructure.

### C16-D07 - RTL support remains only partially future-proofed

- Finding: AGG-C16-27
- Citation: `apps/web/src/app/[locale]/layout.tsx:94-110`, `apps/web/src/components/nav-client.tsx:90-178`, `apps/web/src/components/home-client.tsx:442-455`, `apps/web/src/components/photo-navigation.tsx:156-244`
- Original severity/confidence: Low / High
- Reason for deferral: Current supported locales (`en`, `ko`) are LTR. This is future-locale readiness work, not a current user-facing defect.
- Re-open criterion: Re-open before adding any RTL locale or introducing locale-aware previous/next navigation semantics.

### C16-D08 - Timeline/year queries use non-sargable date functions

- Finding: AGG-C16-28
- Citation: `apps/web/src/lib/data-timeline.ts:125-145`, `apps/web/src/lib/data-timeline.ts:152-214`
- Original severity/confidence: Low / High shape, data-size-dependent impact
- Reason for deferral: Performance risk explicitly dependent on data size and production query plans.
- Re-open criterion: Re-open with slow-query evidence, large timeline datasets, or planned index/generated-column tuning.

### C16-D09 - Feed conditional GETs build feed before returning 304

- Finding: AGG-C16-29
- Citation: `apps/web/src/app/feed.xml/route.ts:29-167`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:49-167`
- Original severity/confidence: Low / Medium
- Reason for deferral: Low-impact performance optimization; current row limit is small and conditional semantics remain correct.
- Re-open criterion: Re-open when feed-reader traffic grows or feed request cost appears in profiling.

### C16-D10 - Photo metadata/body may duplicate image lookup

- Finding: AGG-C16-30
- Citation: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:54-59`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:142-149`, `apps/web/src/lib/data.ts:1690`
- Original severity/confidence: Low / Low-Medium
- Reason for deferral: Manual framework-caching validation risk; React `cache()` should dedupe within render contexts today.
- Re-open criterion: Re-open after Next/React caching upgrades or if query logging shows duplicate photo lookups.

### C16-D11 - Backup download reopens a validated path by pathname

- Finding: AGG-C16-31
- Citation: `apps/web/src/app/api/admin/db/download/route.ts:43-76`, `apps/web/src/app/[locale]/admin/db-actions.ts:138-147`, `apps/web/src/__tests__/backup-download-route.test.ts:103-170`
- Original severity/confidence: Low / Medium
- Reason for deferral: Host-trust/manual-validation risk requiring same-UID write access to `data/backups`. `CLAUDE.md` documents DB backups as app-private plaintext under the operator host/storage boundary; no in-app arbitrary symlink/write path was identified.
- Re-open criterion: Re-open when hardening against same-UID local compromise, changing backup storage location, or adding encrypted/descriptor-backed backup serving.

### C16-D12 - Process-local coordination assumes one active web process

- Finding: AGG-C16-32
- Citation: `CLAUDE.md:228`, `apps/web/docker-compose.yml:11-16`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-78`, `apps/web/src/lib/image-queue.ts:76-90`, `apps/web/src/lib/rate-limit.ts:112-121`, `apps/web/src/lib/data.ts:24-71`
- Original severity/confidence: High if topology changes / High; Low for current documented deployment
- Reason for deferral: Repo docs explicitly define the shipped Docker Compose deployment as a single web-instance/single-writer topology. This is not a current defect under that repo rule.
- Re-open criterion: Re-open before horizontal scaling, queue/process splitting, or changing deploy topology.

### C16-D13 - Semantic search remains bounded brute force in request path

- Finding: AGG-C16-33
- Citation: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`, `apps/web/src/lib/clip-model.ts:53-70`
- Original severity/confidence: Medium if caps/data grow / Medium
- Reason for deferral: Architecture scaling risk with explicit current caps/rate limits and documented production constraints. Not a present correctness/security/data-loss issue.
- Re-open criterion: Re-open when semantic search corpus/caps grow, search becomes a primary workflow, or vector-index work is scheduled.

### C16-D14 - Dockerfile native package pins can drift from lockfile versions

- Finding: AGG-C16-34
- Citation: `apps/web/Dockerfile:50-56`, `apps/web/package.json:35-43`
- Original severity/confidence: Low / Medium
- Reason for deferral: Build-maintenance risk that manifests on dependency upgrades, not current HEAD.
- Re-open criterion: Re-open when upgrading Next/SWC/Sharp/native packages or adding Dockerfile lockfile consistency checks.

### C16-D15 - Durable analytics writes are intentionally best-effort

- Finding: AGG-C16-35
- Citation: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:163-165`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:132-137`, `apps/web/src/app/actions/public.ts:357-452`
- Original severity/confidence: Low / Medium
- Reason for deferral: Product semantics risk; analytics are documented as approximate/best-effort, and no billing/audit-grade requirement exists.
- Re-open criterion: Re-open if analytics become contractual, billing-grade, or required for exact reporting.

### C16-D16 - Deploy command override is arbitrary shell

- Finding: AGG-C16-36
- Citation: `scripts/deploy-remote.sh:61-72`, `.env.deploy.example:13-14`
- Original severity/confidence: Low / Medium
- Reason for deferral: Operator-controlled, gitignored `.env.deploy` trust boundary. This is operational hygiene, not a current code vulnerability under repo policy.
- Re-open criterion: Re-open when automating `.env.deploy` generation, accepting deploy config from untrusted sources, or hardening local deploy safety.

### C16-D17 - SQL restore safety depends on regex scanning and restore drills

- Finding: AGG-C16-37
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:491-519`, `apps/web/src/lib/sql-restore-scan.ts:113-155`
- Original severity/confidence: Low / Medium
- Reason for deferral: Manual operational validation for a destructive admin-only restore path. Current scanner is test-covered; no specific bypass was confirmed.
- Re-open criterion: Re-open when changing dump format, SQL scanner logic, restore workflow, or adding disposable-DB restore drills.

### C16-D18 - DB backups and MySQL child credentials rely on host-level trust

- Finding: AGG-C16-38
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:140-172`, `apps/web/src/app/[locale]/admin/db-actions.ts:540-550`, `apps/web/src/app/api/admin/db/download/route.ts:22-87`
- Original severity/confidence: Low / High
- Reason for deferral: `CLAUDE.md` explicitly documents plaintext SQL backups at rest as the operator host/storage boundary. No in-app exposure path was identified.
- Re-open criterion: Re-open when threat model requires encrypted app-level backups, lower-trust host users, or alternate MySQL credential delivery.

### C16-D19 - Full integration validation remains gated

- Finding: AGG-C16-39
- Citation: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15`, `apps/web/src/__tests__/db-restore.test.ts:42-65`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:7-31`, `apps/web/e2e/admin.spec.ts:6-12`
- Original severity/confidence: Medium validation risk / High
- Reason for deferral: Integration infrastructure work requiring disposable DBs, seeded model weights, admin E2E credentials, and destructive-operation isolation. Default gates still run this cycle.
- Re-open criterion: Re-open before relying on LR upload, DB restore, real CLIP, or authenticated admin browser flows as release-critical surfaces without opt-in integration lanes.
