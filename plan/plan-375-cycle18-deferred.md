# Plan 375 - Cycle 18 Deferred Findings

Status: TODO / deferred
Cycle: 18/100
Source review aggregate: `.context/reviews/_aggregate.md`

Repo rules checked before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, `docs/**`, root/app README files. Deferred work remains bound by repo policy: GPG-signed commits, Conventional Commit + gitmoji, `git pull --rebase` before push, no `--no-verify`, required quality gates, migration checklist, and deployment rules.

Repo rules quoted where they permit deferral:

- CLAUDE.md Runtime topology: "The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store."
- CLAUDE.md Database Security: "Dumps are plaintext SQL at rest; host/storage encryption is the operator boundary."
- AGENTS.md Working agreements: "Keep diffs small, reviewable, and reversible" and "Prefer deletion, existing utilities, and existing patterns before new abstractions; add dependencies only when explicitly requested."

## Deferred Findings

1. AGG-C18-04 - Browser and Lightroom uploads duplicate the ingest transaction owner
   - Original severity/confidence: High / High.
   - Citation: `apps/web/src/app/actions/images.ts:350-531`, `apps/web/src/app/api/admin/lr/upload/route.ts:243-516`.
   - Reason: current review identifies a future drift architecture risk, not a confirmed live upload defect. The proposed shared ingest service is a broad abstraction and conflicts with the repo rule to keep diffs small unless the abstraction removes current complexity safely. Existing source-contract tests cover recent Lightroom parity regressions.
   - Exit criterion: reopen before adding any upload-time DB column, queue-job field, processing setting, or metadata/privacy invariant, or when a dedicated ingest-service refactor is scheduled.

2. AGG-C18-05 - One-row-per-image embeddings make model cutovers destructive
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/db/schema.ts:280-294`, `apps/web/scripts/backfill-clip-embeddings.ts:123-183`, semantic/similar routes.
   - Reason: schema migration and rollout design are broader than this cycle and no active model migration is currently requested. Changing this requires a new migration, journal entry, reconcile mirror, backfill logic, serving pointer, cleanup policy, and production operator runbook.
   - Exit criterion: reopen before introducing a new production embedding model version, changing `PRODUCTION_MODEL_VERSION`, or scheduling semantic-search schema hardening.

3. AGG-C18-06 - Single-process coordination is not runtime-enforced
   - Original severity/confidence: Medium if scaled / High.
   - Citation: `CLAUDE.md:227-230`, process-local restore/upload/rate-limit/queue/view-count/backfill state files.
   - Reason: permitted by the quoted CLAUDE.md single web-instance/single-writer topology. This is not a defect while the shipped and selected deployment remains one web process.
   - Exit criterion: reopen before blue/green overlap, Node clustering, multiple web containers, or horizontal scaling.

4. AGG-C18-13 - Initial listing pages combine tag aggregation with `COUNT(*) OVER()` on the hot path
   - Original severity/confidence: Medium-High / High.
   - Citation: `apps/web/src/lib/data.ts` listing query regions cited in `perf-reviewer.md`.
   - Reason: performance-scale optimization; current behavior is correct and no production latency data was supplied.
   - Exit criterion: reopen on slow initial listing SSR, crawler DB pressure, or gallery scale beyond a few thousand images.

5. AGG-C18-14 - Public keyword search can run multiple leading-wildcard scans per admitted query
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/app/actions/public.ts:236-318`, `apps/web/src/lib/data.ts:1537-1613`.
   - Reason: performance-scale issue requiring search/index design; current query limits and rate limits bound abuse.
   - Exit criterion: reopen on slow-query evidence or when search indexing is prioritized.

6. AGG-C18-15 - Batch image deletion repeats full derivative-directory scans per image and format
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/app/actions/images.ts:807-845`, `apps/web/src/lib/process-image.ts:575-664`.
   - Reason: performance optimization for large deletes; current correctness favors exhaustive cleanup.
   - Exit criterion: reopen when bulk deletes are slow or when derivative cleanup is refactored.

7. AGG-C18-16 - GPS stripping materializes large originals in memory
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/lib/process-image.ts:1738-1822`, upload and Lightroom GPS-strip paths.
   - Reason: memory/performance hardening requiring streaming parser design. Existing upload caps bound memory and public GPS fields are stripped.
   - Exit criterion: reopen on memory pressure during large GPS-stripped uploads or when streaming scrubbers are introduced.

8. AGG-C18-17 - Lightroom uploads parse the full multipart body before streaming to disk
   - Original severity/confidence: Medium / Medium-High.
   - Citation: `apps/web/src/app/api/admin/lr/upload/route.ts:93-155`, `apps/web/src/lib/upload-limits.ts:1-6`.
   - Reason: performance/memory hardening requiring multipart streaming parser changes; current request caps and nginx caps bound input size.
   - Exit criterion: reopen on memory pressure or when Lightroom upload transport is refactored.

9. AGG-C18-18 - Service-worker cached image hits wait on synchronous `HEAD` revalidation
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/public/sw.template.js:34-38`, `apps/web/public/sw.template.js:223-285`.
   - Reason: deliberate freshness/performance tradeoff around mutable derivatives; no correctness bug proven.
   - Exit criterion: reopen if warm-cache waterfalls show visible tile delays or derivative freshness policy changes.

10. AGG-C18-19 - Gallery load-more keeps every loaded image in React state and DOM
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`.
    - Reason: virtualization is UX/scroll-state-sensitive and no measured jank was supplied.
    - Exit criterion: reopen when long sessions produce mobile jank or masonry virtualization is prioritized.

11. AGG-C18-20 - Public map can serialize and hydrate 10,000 markers plus fallback links
    - Original severity/confidence: Medium / Medium-High.
    - Citation: `apps/web/src/lib/data.ts:1648-1677`, map page/client.
    - Reason: performance-scale feature work requiring clustering/viewport loading design; current behavior is correct.
    - Exit criterion: reopen when map-visible GPS rows approach thousands or map clustering is prioritized.

12. AGG-C18-21 - Timeline/archive predicates use non-sargable date functions
    - Original severity/confidence: Low-Medium / High.
    - Citation: `apps/web/src/lib/data-timeline.ts:97-145`, `apps/web/src/lib/data-timeline.ts:186-207`.
    - Reason: accepted personal-gallery scale optimization; no slow-query evidence.
    - Exit criterion: reopen on slow-query evidence or major gallery growth.

13. AGG-C18-22 - Admin dashboard and analytics fanout can exhaust the small shared pool
    - Original severity/confidence: Low-Medium / Medium.
    - Citation: `apps/web/src/db/index.ts`, dashboard/analytics page regions cited in `perf-reviewer.md`.
    - Reason: scale-sensitive operational risk; current single-instance pool budget is documented and no outage evidence was supplied.
    - Exit criterion: reopen on pool starvation evidence or dashboard/analytics query expansion.

14. AGG-C18-23 - Semantic and similar search decode and score every scanned embedding in process
    - Original severity/confidence: Low-Medium / Medium.
    - Citation: semantic/similar route scan regions and `apps/web/src/lib/clip-embeddings.ts`.
    - Reason: scan limit bounds work today; vector index adoption is larger product/infrastructure work.
    - Exit criterion: reopen when scan caps are raised, latency grows, or vector indexing is scheduled.

15. AGG-C18-24 - Upload dropzone renders object URLs and full preview cards for every selected file
    - Original severity/confidence: Low-Medium / Medium.
    - Citation: upload dropzone regions cited in `perf-reviewer.md`.
    - Reason: UI performance optimization; current file-count caps bound the surface.
    - Exit criterion: reopen on preview jank or when upload batching UX is redesigned.

16. AGG-C18-25 - Middleware CSP/header wiring lacks behavior tests
    - Original severity/confidence: Medium / High.
    - Citation: middleware/header regions cited in `test-engineer.md`.
    - Reason: coverage gap only; existing source contracts and security tests are passing.
    - Exit criterion: reopen when changing middleware headers/CSP or adding route-level header behavior tests.

17. AGG-C18-26 - Lightroom upload route behavior is protected mostly by source-contract tests
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`.
    - Reason: coverage gap; no confirmed runtime defect. The broader duplicate-ingest refactor is separately deferred.
    - Exit criterion: reopen when touching Lightroom upload behavior or when adding route-level API tests.

18. AGG-C18-27 - Migration reconcile coverage is a source tripwire, not schema equivalence
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`, `apps/web/scripts/migrate.js`.
    - Reason: coverage/tooling improvement requiring test DB schema equivalence harness; no migration drift is currently confirmed.
    - Exit criterion: reopen when adding a migration or introducing schema-equivalence test infrastructure.

19. AGG-C18-28 - PWA manifest and generated icon assets lack installability tests
    - Original severity/confidence: Low / High.
    - Citation: manifest/icon files cited in `test-engineer.md`.
    - Reason: low-risk coverage gap.
    - Exit criterion: reopen when PWA assets/manifest change.

20. AGG-C18-29 - Reserved topic route segments are duplicated without a sync test
    - Original severity/confidence: Low / Medium.
    - Citation: reserved segment code/tests cited in `test-engineer.md`.
    - Reason: coverage gap; current reserved routes were recently fixed and no live collision cited.
    - Exit criterion: reopen when public route siblings or topic validation change.

21. AGG-C18-30 - Admin token auth rate-limit wrapper path lacks wrapper-level test coverage
    - Original severity/confidence: Medium / High.
    - Citation: admin token auth/rate-limit regions cited in `test-engineer.md`.
    - Reason: coverage gap only; no wrapper defect confirmed.
    - Exit criterion: reopen when admin token auth or rate-limit wrappers change.

22. AGG-C18-31 - Repo-local `.env.deploy` is the default deploy secret path
    - Original severity/confidence: Low / High.
    - Citation: deploy helper/docs cited in `security-reviewer.md`.
    - Reason: low-severity local-operator secret hygiene. `.env.deploy` is gitignored and deployment policy intentionally reads it from repo root.
    - Exit criterion: reopen if `.env.deploy` appears in git status/history or deploy secret handling changes.

23. AGG-C18-32 - Deploy env allows arbitrary shell command overrides without a separate guard
    - Original severity/confidence: Low / Medium.
    - Citation: `scripts/deploy-remote.sh` regions cited in `security-reviewer.md`.
    - Reason: local operator-controlled deploy helper; changing override semantics could break the explicitly selected deploy path.
    - Exit criterion: reopen before exposing deploy config to untrusted users or changing deploy helper override behavior.

24. AGG-C18-33 - Docker build-time env and runtime `.env.local` are split
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/docker-compose.yml:7-21`, `apps/web/deploy.sh:15-31`, `apps/web/Dockerfile:65-70`, `apps/web/next.config.ts`.
    - Reason: operational alignment improvement. Current per-cycle deploy path is already configured by the operator and changing env propagation can alter production build semantics.
    - Exit criterion: reopen when build-time env is changed, when `IMAGE_BASE_URL`/body limit build behavior fails, or when deploy helper is revised.

