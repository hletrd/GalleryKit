# Plan 377 - Cycle 19 Deferred Findings

Status: TODO / deferred
Cycle: 19/100
Source review aggregate: `.context/reviews/_aggregate.md`

Repo rules checked before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, `docs/**`, root/app README files. Deferred work remains bound by repo policy: GPG-signed commits, Conventional Commit + gitmoji, `git pull --rebase` before push, no `--no-verify`, required quality gates, migration checklist, and deployment rules.

Repo rules quoted where they permit deferral:

- CLAUDE.md Runtime topology: "The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store."
- CLAUDE.md Database Security: "Dumps are plaintext SQL at rest; host/storage encryption is the operator boundary."
- AGENTS.md Working agreements: "Keep diffs small, reviewable, and reversible" and "Prefer deletion, existing utilities, and existing patterns before new abstractions; add dependencies only when explicitly requested."
- AGENTS.md deploy rules preserve the selected config-driven deployment path and warn not to hardcode hostnames or key paths.

## Deferred Findings

1. AGG-C19-02 - Browser upload and Lightroom upload duplicate the same ingest transaction contract
   - Original severity/confidence: High / High.
   - Citation: `apps/web/src/app/actions/images.ts:114-190`, `apps/web/src/app/actions/images.ts:350-531`, `apps/web/src/app/api/admin/lr/upload/route.ts:225-516`.
   - Reason: high-severity architectural drift risk, but no confirmed live defect in current browser/LR parity. Extracting a shared ingest service touches two upload adapters, transaction/cleanup semantics, queue jobs, and tests; this violates the small/reversible cycle scope absent an active upload-contract change.
   - Exit criterion: reopen before adding any upload-time DB column, queue-job field, processing setting, metadata/privacy invariant, or upload adapter behavior.

2. AGG-C19-10 - Docker build-time env can diverge from runtime `.env.local`
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/docker-compose.yml:7-21`, `apps/web/deploy.sh:15-31`, `apps/web/Dockerfile:65-70`, `apps/web/next.config.ts:28`, `apps/web/next.config.ts:92-105`.
   - Reason: operational deployment semantics are explicitly config-driven and the user selected the current `npm run deploy` path for this cycle. Changing compose build env propagation can affect production build behavior and should be handled in a dedicated deploy-contract change.
   - Exit criterion: reopen before changing build-time env reads, CDN/image config, body-size build limits, Dockerfile build args, or deploy helper env sourcing.

3. AGG-C19-11 - Single-process coordination is documented but not runtime-enforced
   - Original severity/confidence: Medium if scaled; Low under current deployment / High.
   - Citation: `CLAUDE.md:227-230`, `apps/web/src/lib/restore-maintenance.ts:1-22`, `apps/web/src/lib/upload-tracker-state.ts:7-78`, `apps/web/src/lib/rate-limit.ts:77-121`.
   - Reason: permitted by the quoted CLAUDE.md single web-instance/single-writer topology. Current shipped deployment remains one web process; startup lease design is broader than this cycle.
   - Exit criterion: reopen before blue/green overlap, Node clustering, multiple web containers, autoscaling, or startup topology guard work.

4. AGG-C19-12 - Image queue can starve the shared MySQL pool while holding advisory-lock connections
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/db/index.ts:23-38`, `apps/web/src/lib/image-queue.ts:446-630`.
   - Reason: scale/operational performance issue tied to raised `QUEUE_CONCURRENCY`; default concurrency is 1 and no current outage evidence was supplied. Replacing processing claims is a broad queue design change.
   - Exit criterion: reopen on pool starvation evidence, queue concurrency increase, or image-processing claim refactor.

5. AGG-C19-13 - Initial listing and smart-collection pages combine tag aggregation with `COUNT(*) OVER()`
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/lib/data.ts:878-914`, `apps/web/src/lib/data.ts:1409-1453`.
   - Reason: performance-scale query redesign; current behavior is correct and no slow-query evidence was supplied.
   - Exit criterion: reopen on slow initial listing SSR, crawler DB pressure, or gallery scale beyond a few thousand images.

6. AGG-C19-14 - Public keyword search uses leading-wildcard scans after admission
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/app/actions/public.ts:236-318`, `apps/web/src/lib/data.ts:1482-1624`.
   - Reason: performance-scale search/index design; current limits and rate limits bound admitted work.
   - Exit criterion: reopen on slow-query evidence or when search indexing/fulltext work is prioritized.

7. AGG-C19-17 - Fresh installs can publish generic GalleryKit identity into SEO/social surfaces
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/site-config.json:2-9`, `apps/web/src/lib/data.ts:1721-1741`, `apps/web/src/app/[locale]/layout.tsx:22-58`.
   - Reason: product onboarding enhancement, not a correctness or privacy defect in an already customized deployment. This should be handled with a dedicated launch-readiness/admin UX plan.
   - Exit criterion: reopen when building first-run onboarding, admin SEO warnings, or launch-readiness checklist.

8. AGG-C19-21 - Desktop photo metadata/download/color disclosure is hidden by default
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/components/photo-viewer.tsx:103-108`, `apps/web/src/components/photo-viewer.tsx:736-999`.
   - Reason: product/UX tradeoff between immersive viewing and persistent disclosure. Needs design decision and screenshot/browser iteration; no broken control or a11y failure was proven.
   - Exit criterion: reopen for photo-page IA redesign, client download discoverability complaints, or color/HDR disclosure UX work.

9. AGG-C19-22 - Admin image management remains a 9-column desktop table on narrow screens
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/components/image-manager.tsx:421-591`.
   - Reason: broad responsive admin redesign. Current table remains functional with horizontal scroll and touch targets; implementing a mobile card/list surface is beyond this cycle's narrow fix budget.
   - Exit criterion: reopen before admin mobile workflow redesign or after event-day/mobile management usability evidence.

10. AGG-C19-24 - Topic slug remains a mutable natural key with manual fan-out
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/db/schema.ts:4-33`, `apps/web/src/app/actions/topics.ts:255-339`.
    - Reason: structural schema migration risk, not a confirmed current rename defect. Moving to surrogate IDs requires migration, reconcile mirror, route/data changes, and production rollout.
    - Exit criterion: reopen before adding any new topic-slug FK/store/JSON reference or scheduling topic identity migration.

11. AGG-C19-25 - Upload quota settlement remains comment-enforced control flow
    - Original severity/confidence: Medium / Medium-High.
    - Citation: `apps/web/src/app/actions/images.ts:238-293`, `apps/web/src/app/actions/images.ts:536-596`, `apps/web/src/lib/upload-tracker.ts:19-33`.
    - Reason: future-maintenance risk; no current quota leak was reproduced and recent TOCTOU tests cover the current shape. A window-identity rewrite is broader than this cycle.
    - Exit criterion: reopen before adding awaits in the post-claim upload window, changing upload tracker windows, or refactoring upload quota settlement.

12. AGG-C19-27 - IPv6 clients can rotate public rate-limit buckets
    - Original severity/confidence: Low / High for gap, Medium for impact.
    - Citation: `apps/web/src/lib/rate-limit.ts:123-194`.
    - Reason: defense-in-depth resource-control hardening. Current per-IP limits, body caps, and production topology bound impact; IPv6 prefix policy needs operator/CDN decision.
    - Exit criterion: reopen when configuring CDN/proxy IPv6 behavior or hardening public CPU/DB abuse controls.

13. AGG-C19-28 - Semantic/similar search decode and score every scanned embedding in process
    - Original severity/confidence: Low-Medium / High.
    - Citation: `apps/web/src/app/api/search/semantic/route.ts:259-303`, `apps/web/src/app/api/search/similar/[id]/route.ts:142-175`.
    - Reason: performance-scale/vector-index design. Current scan cap bounds work and this cycle schedules abort cancellation for wasted inference.
    - Exit criterion: reopen when raising scan caps, seeing semantic latency, or adopting vector indexing/worker scoring.

14. AGG-C19-29 - GPS stripping materializes large retained originals in memory
    - Original severity/confidence: Low-Medium / High.
    - Citation: `apps/web/src/lib/process-image.ts:1737-1818`, `apps/web/src/lib/gps-exif-strip.ts:222-575`.
    - Reason: performance/memory hardening requiring streaming/container rewrite or global semaphore design. Current upload caps bound input size.
    - Exit criterion: reopen on memory pressure during GPS-stripped uploads or when implementing streaming scrubbers.

15. AGG-C19-30 - Batch image deletion repeats derivative-directory scans per image and format
    - Original severity/confidence: Low-Medium / High.
    - Citation: `apps/web/src/app/actions/images.ts:818-842`, `apps/web/src/lib/process-image.ts:575-664`.
    - Reason: bulk-delete performance optimization; current correctness favors exhaustive historical variant cleanup.
    - Exit criterion: reopen when bulk deletes are slow or derivative cleanup is refactored.

16. AGG-C19-31 - Public map can serialize and hydrate up to 10,000 markers and fallback links
    - Original severity/confidence: Low-Medium / Medium-High.
    - Citation: `apps/web/src/lib/data.ts:1641-1677`, map page/client regions.
    - Reason: scale/product feature work requiring clustering and paged/bbox API design.
    - Exit criterion: reopen when map-visible GPS rows approach thousands or map clustering is prioritized.

17. AGG-C19-32 - Timeline/archive predicates use non-sargable date functions
    - Original severity/confidence: Low-Medium / High.
    - Citation: `apps/web/src/lib/data-timeline.ts:88-207`.
    - Reason: accepted personal-gallery scale optimization; no slow-query evidence.
    - Exit criterion: reopen on timeline/year slow-query evidence or archive indexing work.

18. AGG-C19-33 - Service-worker cached image hits wait on synchronous HEAD revalidation
    - Original severity/confidence: Low-Medium / High.
    - Citation: `apps/web/public/sw.template.js:31-38`, `apps/web/public/sw.template.js:224-286`.
    - Reason: deliberate freshness/performance tradeoff around mutable derivatives; no correctness bug proven.
    - Exit criterion: reopen if warm-cache waterfalls show visible tile delays or derivative freshness policy changes.

19. AGG-C19-34 - Infinite masonry keeps all loaded cards in state and DOM
    - Original severity/confidence: Low-Medium / High.
    - Citation: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-409`, `apps/web/src/components/load-more.tsx:41-133`.
    - Reason: virtualization changes scroll restoration, masonry behavior, and perceived browsing flow. No measured jank was supplied.
    - Exit criterion: reopen when long sessions produce mobile jank or masonry virtualization is prioritized.

20. AGG-C19-35 - Admin dashboard/analytics fanout can consume most of the shared DB pool
    - Original severity/confidence: Low-Medium / Medium.
    - Citation: dashboard/analytics fanout regions and `apps/web/src/lib/analytics-data.ts:28-208`.
    - Reason: scale-sensitive operational risk; no pool starvation evidence was supplied.
    - Exit criterion: reopen on pool starvation evidence or dashboard/analytics query expansion.

21. AGG-C19-38 - Nginx config relies on external TLS while listening on cleartext port 80
    - Original severity/confidence: Low / Medium.
    - Citation: `apps/web/nginx/default.conf:21-71`, `apps/web/docker-compose.yml:14-22`.
    - Reason: infrastructure posture depends on external edge/firewall outside this repo. Changing listener/TLS config could break the selected deployment target; defer to infrastructure change with operator validation.
    - Exit criterion: reopen before exposing this nginx as public edge or changing host firewall/TLS topology.

22. AGG-C19-39 - Repo-local deploy secret file is default path
    - Original severity/confidence: Low / High.
    - Citation: `.env.deploy.example:1-4`, `scripts/deploy-remote.sh:22-29`.
    - Reason: local-operator secret hygiene; `.env.deploy` is gitignored and the user explicitly selected the current per-cycle deploy path. Changing precedence can block deploys.
    - Exit criterion: reopen when deploy secret handling changes or if `.env.deploy` appears in tracked files/history.

23. AGG-C19-40 - Deploy env can override shell commands without a separate guard
    - Original severity/confidence: Low / Medium.
    - Citation: `.env.deploy.example:11-14`, `scripts/deploy-remote.sh:31-72`.
    - Reason: operator-controlled escape hatch in the selected deploy path; adding guards can break existing configured deployments.
    - Exit criterion: reopen before exposing deploy config to untrusted users or changing deploy override semantics.

24. AGG-C19-47 - Nav "visual" Playwright checks save screenshots but do not compare them
    - Original severity/confidence: Low / High.
    - Citation: `apps/web/e2e/nav-visual-check.spec.ts:6-79`.
    - Reason: naming/coverage-confidence issue only. Current metric assertions still test touch size and overlap; screenshot baselines require visual-test policy.
    - Exit criterion: reopen when adding visual regression baselines or renaming visual smoke tests.

25. AGG-C19-49 - Touch-target governance still carries admin compact-control budgets
    - Original severity/confidence: Low / High.
    - Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:151-245`.
    - Reason: current runtime Button primitive is safe and audit remains blocking. Retiring exception budgets is cleanup work, not a live failure.
    - Exit criterion: reopen when Button sizing changes, compact-control violations increase, or measured target-size tests are added.

26. AGG-C19-50 - README sells technical power before showing the product experience
    - Original severity/confidence: Low / High.
    - Citation: `README.md:7-40`, `README.md:106`.
    - Reason: marketing/onboarding improvement, not a correctness or trust-disclosure blocker after AGG-C19-03 is scheduled.
    - Exit criterion: reopen for README product positioning pass or screenshot/first-run checklist work.
