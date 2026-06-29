# Cycle 17/100 Deferred Findings

Date: 2026-06-30 KST  
Status: OPEN

Repo rules reviewed before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, current `.context` review/plan history, and `docs/superpowers/**`. No `.cursorrules` or `CONTRIBUTING.md` were present. These deferrals do not alter repo policy for future work: commits remain GPG-signed Conventional Commits with gitmoji, pushes require `git pull --rebase`, destructive actions require confirmation, and all quality gates remain blocking.

## Deferred Items

### C17-D01 - Backup download reopens a validated path by pathname

- Finding: AGG-C17-12
- Citation: `apps/web/src/app/api/admin/db/download/route.ts:43-75`
- Original severity/confidence: Low / Medium
- Reason for deferral: Host-local TOCTOU hardening requiring fd-based streaming design. `CLAUDE.md` defines plaintext DB backups under the operator host/storage boundary, and no app-level arbitrary write or unauthenticated exploit was identified.
- Re-open criterion: Re-open when hardening against same-UID local compromise, changing backup storage, or adding descriptor-backed/encrypted backup serving.

### C17-D02 - CLIP inference admission has an unbounded wait queue

- Finding: AGG-C17-13
- Citation: `apps/web/src/lib/clip-model.ts:53-71`, `apps/web/src/app/api/search/semantic/route.ts:248-255`, `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`
- Original severity/confidence: High / High
- Reason for deferral: Performance/availability architecture work requiring bounded cancellable semaphore design and admission policy. It is not data-loss/security/correctness for the current small production corpus and rate-limited public surface.
- Re-open criterion: Re-open when semantic traffic grows, backfill/search contention is observed, or process-wide model queue metrics are added.

### C17-D03 - Listing pages use `COUNT(*) OVER()` after tag joins/grouping

- Finding: AGG-C17-14
- Citation: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1409-1453`
- Original severity/confidence: Medium-High / High
- Reason for deferral: Hot-path query redesign requiring EXPLAIN against production-like data, keyset ID-first query split, and possible index migration.
- Re-open criterion: Re-open with slow-query evidence, large gallery cardinalities, or planned listing-query/index work.

### C17-D04 - Batch image deletion repeats derivative-directory scans

- Finding: AGG-C17-15
- Citation: `apps/web/src/app/actions/images.ts:807-845`, `apps/web/src/lib/process-image.ts:575-664`
- Original severity/confidence: Medium / High
- Reason for deferral: Admin I/O performance refactor needing a batch cleanup helper and failure aggregation semantics. Current behavior preserves deletion correctness.
- Re-open criterion: Re-open when high-volume delete workflows are scheduled or delete latency/cleanup I/O becomes observable.

### C17-D05 - GPS stripping materializes large originals in memory

- Finding: AGG-C17-16
- Citation: `apps/web/src/lib/process-image.ts:1738-1822`, `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-381`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance/memory architecture work separate from the scheduled privacy correctness fix in C17-P03. A streaming scrubber or process-wide memory semaphore needs design and large-file fixtures.
- Re-open criterion: Re-open when upload OOM/GC pressure is observed, upload size limits change, or GPS stripping becomes default/high-volume.

### C17-D06 - Public keyword search uses leading-wildcard scans

- Finding: AGG-C17-17
- Citation: `apps/web/src/app/actions/public.ts:236-318`, `apps/web/src/lib/data.ts:1537-1613`
- Original severity/confidence: Medium / High
- Reason for deferral: Search-index architecture work. Existing validation/rate limits bound current abuse; no correctness/security bug was identified.
- Re-open criterion: Re-open when corpus/search traffic grows, search latency appears in profiling, or full-text/ngram search work is scheduled.

### C17-D07 - Service worker synchronous HEAD revalidation can delay cached images

- Finding: AGG-C17-18
- Citation: `apps/web/public/sw.template.js:34-38`, `apps/web/public/sw.template.js:223-285`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance tradeoff intentionally preserving fast freshness for derivative rewrites. Not a correctness defect; separate from scheduled revocable photo-page cache fix.
- Re-open criterion: Re-open with LCP/field evidence or when redesigning derivative cache freshness.

### C17-D08 - Gallery client accumulates loaded images in state/DOM

- Finding: AGG-C17-19
- Citation: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-421`, `apps/web/src/components/load-more.tsx:41-133`
- Original severity/confidence: Medium / High
- Reason for deferral: Virtualized masonry or paginated browsing is significant UI architecture work. Current personal-gallery scale has no measured regression.
- Re-open criterion: Re-open when large-scroll memory/INP regressions are measured or route pagination/virtualization is scheduled.

### C17-D09 - Lightroom upload materializes large multipart bodies

- Finding: AGG-C17-20
- Citation: `apps/web/src/app/api/admin/lr/upload/route.ts:93-155`, `apps/web/src/lib/upload-limits.ts:1-6`
- Original severity/confidence: Medium / Medium-High
- Reason for deferral: Requires streaming multipart parser and global active-byte semaphore; no current upload OOM evidence was supplied.
- Re-open criterion: Re-open when Lightroom upload concurrency grows, RSS pressure is observed, or upload parser architecture is revisited.

### C17-D10 - Public map can hydrate up to 10,000 markers and links

- Finding: AGG-C17-21
- Citation: `apps/web/src/lib/data.ts:1648-1677`, `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`, `apps/web/src/components/map/map-client.tsx:76-143`
- Original severity/confidence: Medium / Medium-High
- Reason for deferral: Scale/performance architecture item requiring bbox API, clustering, fallback-list redesign, and index work.
- Re-open criterion: Re-open when GPS-visible galleries approach the cap or map performance is measured as poor.

### C17-D11 - Timeline/archive date predicates are non-sargable

- Finding: AGG-C17-22
- Citation: `apps/web/src/lib/data-timeline.ts:97-145`, `apps/web/src/lib/data-timeline.ts:186-207`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: Data-size-dependent performance risk requiring query/index tuning, not a current correctness defect.
- Re-open criterion: Re-open with slow-query evidence, large timeline datasets, or planned generated-column/index tuning.

### C17-D12 - Admin dashboard/analytics DB fanout can consume the pool

- Finding: AGG-C17-23
- Citation: `apps/web/src/db/index.ts:23-38`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`, `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-36`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: Admin-only performance risk without observed pool exhaustion. Fix would require query consolidation or separate pool strategy.
- Re-open criterion: Re-open when pool queue errors/latency occur during admin analytics/dashboard usage.

### C17-D13 - Semantic/similar search scans and full-sorts embeddings

- Finding: AGG-C17-24
- Citation: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: Bounded performance risk under current caps. Vector index/top-K heap is future scaling work.
- Re-open criterion: Re-open before raising `SEMANTIC_SCAN_LIMIT`, observing CPU latency, or adding vector-index work.

### C17-D14 - Touch-target audit can miss replacement violations

- Finding: AGG-C17-25
- Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:151-238`, `apps/web/src/__tests__/touch-target-audit.test.ts:764-788`
- Original severity/confidence: Low / High
- Reason for deferral: Test-governance hardening. No current new sub-44 target was found; targeted UI tests passed this cycle.
- Re-open criterion: Re-open when changing touch-target budgets, removing known violations, or adding exemption signatures.

### C17-D15 - Reconcile migration tests are source tripwires

- Finding: AGG-C17-26
- Citation: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/scripts/migrate.js:307-702`
- Original severity/confidence: Medium / High
- Reason for deferral: Requires disposable MySQL schema-equivalence infrastructure. Default migration postconditions still run at deploy.
- Re-open criterion: Re-open before major schema work or when disposable DB integration testing is added.

### C17-D16 - Real CLIP production behavior is skipped in default tests

- Finding: AGG-C17-27
- Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/lib/clip-model.ts:98-118`
- Original severity/confidence: Medium validation risk / High
- Reason for deferral: Requires seeded model weights and opt-in integration CI. Not a source correctness bug for default gates.
- Re-open criterion: Re-open when changing CLIP model id/revision/runtime, seeded weights, or production semantic activation.

### C17-D17 - Docker base images and apt packages are not digest/version pinned

- Finding: AGG-C17-28
- Citation: `apps/web/Dockerfile:1-16`
- Original severity/confidence: Low / High
- Reason for deferral: Supply-chain reproducibility risk that conflicts with the user-level latest-version preference unless a pinned-image update workflow is designed.
- Re-open criterion: Re-open when adding image scanning or intentional production base-image pinning.

### C17-D18 - Historical checked-in secrets need operational rotation validation

- Finding: AGG-C17-29
- Citation: `CLAUDE.md:84-86`, `README.md:144-146`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Credential rotation is destructive/credential-gated and outside local code authority. Current docs already warn to rotate historical values.
- Re-open criterion: Re-open with operator approval to audit/rotate deployed secrets.

### C17-D19 - Semantic embeddings are one-row-per-image

- Finding: AGG-C17-37
- Citation: `apps/web/src/db/schema.ts:280-295`, `apps/web/scripts/backfill-clip-embeddings.ts:80-183`
- Original severity/confidence: Medium / High
- Reason for deferral: Schema/migration architecture change for future model cutovers. Current production model is active and not mid-upgrade.
- Re-open criterion: Re-open before changing production embedding model version or planning multi-version semantic cutover.

### C17-D20 - Process-local coordination assumes one active web process

- Finding: AGG-C17-38
- Citation: `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-78`, `apps/web/src/lib/image-queue.ts:76-325`, `apps/web/src/lib/data.ts:13-63`
- Original severity/confidence: High if scaled / High; Low under current topology
- Reason for deferral: `CLAUDE.md` explicitly defines the shipped deployment as single web-instance/single-writer. This is not a current defect under that repo rule.
- Re-open criterion: Re-open before horizontal scaling, queue splitting, serverless deployment, or multi-process runtime.

### C17-D21 - Container startup can recursively chown persistent data

- Finding: AGG-C17-39
- Citation: `apps/web/scripts/entrypoint.sh:4-13`, `apps/web/docker-compose.yml:23-27`
- Original severity/confidence: Low / Medium
- Reason for deferral: Operational startup-latency risk requiring deploy/provisioning policy design. No current ownership incident was reported.
- Re-open criterion: Re-open when changing deploy/provisioning or after any restart latency from ownership repair.

### C17-D22 - Demo domain defaults in reusable deployment artifacts

- Finding: AGG-C17-40
- Citation: `apps/web/src/site-config.json:1-10`, `apps/web/src/site-config.example.json:4`, `apps/web/nginx/default.conf:21-29`, `README.md:148-149`
- Original severity/confidence: High product trust / High; Low architecture risk / High
- Reason for deferral: The orchestrator explicitly selected the live `gallery.atik.kr` target for this per-cycle deployment. Replacing the tracked demo URL/domain in this cycle can break or complicate the requested live deploy path; this is a self-hosted packaging/product-identity risk for other installs, not current selected-target correctness.
- Re-open criterion: Re-open before publishing generic self-hosted release artifacts or once live demo deploy config is decoupled from tracked defaults.

### C17-D23 - Admin category/tag validation is toast-only

- Finding: AGG-C17-42
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:81-104`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-66`
- Original severity/confidence: Medium / Medium-High
- Reason for deferral: UX/accessibility improvement requiring form-state refactor across admin dialogs. Not a current security/correctness/data-loss issue.
- Re-open criterion: Re-open when refactoring admin forms or when screen-reader validation complaints are observed.

### C17-D24 - Photo-page swipe navigation is attached to `window`

- Finding: AGG-C17-48
- Citation: `apps/web/src/components/photo-navigation.tsx:47-133`, `apps/web/src/components/photo-viewer.tsx:687-694`
- Original severity/confidence: Medium / High
- Reason for deferral: Gesture-scope UX fix requiring touch e2e coverage and careful interaction with browser-edge navigation. Not security/correctness/data-loss.
- Re-open criterion: Re-open when working on photo mobile interactions or adding touch regression infrastructure.

### C17-D25 - Primary photo surface is exposed as generic zoom button

- Finding: AGG-C17-49
- Citation: `apps/web/src/components/image-zoom.tsx:343-362`, `apps/web/src/components/photo-viewer.tsx:467-531`, `apps/web/src/components/photo-viewer.tsx:720-723`
- Original severity/confidence: Medium / High
- Reason for deferral: Accessibility/interaction design change requiring careful label strategy and screen-reader verification. Not a current data/security issue.
- Re-open criterion: Re-open when touching photo viewer accessibility or zoom controls.

### C17-D26 - First-time desktop photo pages hide info/download/color details

- Finding: AGG-C17-50
- Citation: `apps/web/src/components/photo-viewer.tsx:103-108`, `apps/web/src/components/photo-viewer.tsx:736-999`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Product/UX tradeoff between immersive photo viewing and metadata disclosure. Needs user preference decision.
- Re-open criterion: Re-open when revisiting photo-page IA or direct-link client workflows.

### C17-D27 - Admin image management is a wide table on mobile

- Finding: AGG-C17-51
- Citation: `apps/web/src/components/image-manager.tsx:421-579`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`
- Original severity/confidence: Medium / High
- Reason for deferral: Significant responsive admin redesign. Admin mobile management is not currently the highest-risk workflow.
- Re-open criterion: Re-open when making admin mobile first-class or redesigning image management.

### C17-D28 - Local public browser validation blocked by missing seeded MySQL

- Finding: AGG-C17-52
- Citation: local browser runs against `/en`, `/en/map`; dev logs `ECONNREFUSED 127.0.0.1:3306`
- Original severity/confidence: Medium review risk / High
- Reason for deferral: Validation infrastructure work requiring local seeded DB/fixture mode, not a product runtime defect.
- Re-open criterion: Re-open when creating deterministic UI review fixtures or improving local dev/test setup.

### C17-D29 - Deploy command override executes arbitrary shell

- Finding: AGG-C17-53
- Citation: `scripts/deploy-remote.sh:61-72`, `.env.deploy.example:13-14`
- Original severity/confidence: Low / Medium
- Reason for deferral: Operator-controlled gitignored `.env.deploy` trust boundary. Current per-cycle deploy uses this established helper.
- Re-open criterion: Re-open when accepting deploy config from untrusted sources or hardening local deploy safety.

### C17-D30 - Analytics are intentionally best-effort

- Finding: AGG-C17-55
- Citation: `apps/web/src/app/actions/public.ts:363-461`, `apps/web/src/lib/data.ts:49-145`, `apps/web/src/lib/data.ts:222-248`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: Product semantics risk; analytics are documented as approximate/best-effort, not billing/audit grade.
- Re-open criterion: Re-open if analytics become contractual, billing-grade, or required for exact reporting.
