# Plan 373 - Cycle 13 Deferred Findings

Status: TODO / deferred
Cycle: 13/100
Source review aggregate: `.context/reviews/_aggregate.md`

Repo rules checked before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, docs under `docs/`, and root/app operational docs. Security/correctness/data-loss findings are scheduled in `plan/plan-372-cycle13-fixes.md` unless a repo rule explicitly defines the item as an accepted operational boundary.

## Deferred Findings

1. AGG-C13-07 - nginx forwarded-IP handling conflicts with documented multi-hop edge guidance
   - Original severity/confidence: Medium / High for mismatch; production impact requires topology validation.
   - Citation: `apps/web/nginx/default.conf`, `apps/web/src/lib/rate-limit.ts:161-183`, `README.md:151-154`.
   - Reason: requires live topology confirmation before changing trusted proxy behavior. Repo docs define the shipped deployment as single host-network web behind configured proxy settings; changing nginx real-IP handling without knowing the upstream trust boundary could weaken spoofing resistance.
   - Exit criterion: reopen when production is confirmed to have CDN/LB -> nginx -> app, or when logs show rate-limit bucket collapse to edge IPs.

2. AGG-C13-08 - Public map can render and serialize up to 10k markers
   - Original severity/confidence: High / High.
   - Citation: `apps/web/src/lib/data.ts:1649-1676`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-79`, `apps/web/src/components/map/map-client.tsx:76-143`.
   - Reason: performance-scale feature work requiring clustering/viewport loading design; no correctness, security, or data-loss bug is proven for current data size.
   - Exit criterion: reopen when map-visible GPS rows approach thousands, mobile map long tasks are observed, or map clustering/virtualized accessible list work is prioritized.

3. AGG-C13-09 - Admin dashboard renders every permanently failed image
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/lib/data.ts:1000-1013`, dashboard page/client.
   - Reason: performance hardening requiring pagination/index planning and production-like `EXPLAIN`; not blocking current correctness.
   - Exit criterion: reopen if failed-image rows exceed a few hundred or dashboard recovery UX becomes slow.

4. AGG-C13-10 - First public listing pages perform count-window work on dynamic requests
   - Original severity/confidence: Medium / Medium.
   - Citation: `apps/web/src/lib/data.ts:878-907`, public home/topic/smart collection pages.
   - Reason: query-shape optimization needs production-like data and UX decision on exact counts. Current behavior is correct.
   - Exit criterion: reopen on observed slow initial listing SSR, crawler DB pressure, or decision to remove exact counts.

5. AGG-C13-11 - Image queue can pin shared DB pool connections through Sharp work
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:446-657`.
   - Reason: current default queue concurrency is conservative and CLAUDE.md documents the single-instance topology. Changing lock/pool architecture is broader than this cycle's confirmed defects.
   - Exit criterion: reopen before raising `QUEUE_CONCURRENCY`, on pool starvation evidence, or when a dedicated lock pool/lease design is approved.

6. AGG-C13-12 - GPS stripping materializes whole originals after streaming save
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/lib/process-image.ts:887-910`, `apps/web/src/lib/process-image.ts:1738-1786`, Lightroom upload route.
   - Reason: memory/performance work needs streaming parser design. Existing per-file/body caps still bound uploads.
   - Exit criterion: reopen on memory pressure during large GPS-stripped uploads or when streaming scrubbers are introduced.

7. AGG-C13-13 - Semantic search is bounded brute force with unbounded inference waiters
   - Original severity/confidence: Medium / Medium-High.
   - Citation: semantic/similar routes and `apps/web/src/lib/clip-model.ts:53-70`.
   - Reason: production CLIP is live but current scan limits are explicitly bounded; backpressure/vector-indexing needs load-test evidence.
   - Exit criterion: reopen if semantic latency/queue depth grows, scan caps are raised, or multiple concurrent clients trigger waiter growth.

8. AGG-C13-14 - Infinite masonry retains every loaded card and image element
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`.
   - Reason: virtualization changes are UX- and scroll-state-sensitive; no current correctness issue.
   - Exit criterion: reopen when long sessions produce mobile jank or when masonry virtualization is prioritized.

9. AGG-C13-15 - Non-sargable timeline/search/smart predicates are scale-sensitive
   - Original severity/confidence: Low-Medium / High.
   - Citation: `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/smart-collections.ts`.
   - Reason: accepted at personal-gallery scale; needs query metrics before schema/index changes.
   - Exit criterion: reopen on slow-query evidence or major gallery growth.

10. AGG-C13-16 - Service worker image freshness probe can add one HEAD RTT per warm cached tile
    - Original severity/confidence: Low / High.
    - Citation: `apps/web/public/sw.template.js:226-270`, `apps/web/public/sw.js:226-270`.
    - Reason: deliberate freshness tradeoff documented in CLAUDE.md service-worker section.
    - Exit criterion: reopen if warm-cache waterfalls show visible tile delays.

11. AGG-C13-17 - Public route IDs accept unsafe integer ranges before DB lookup
    - Original severity/confidence: Low / Medium.
    - Citation: public photo/similar/OG/shared route ID parsing.
    - Reason: current schema uses MySQL `int` autoincrement, so no current data corruption or wrong-row bug is possible; this is a future-schema cleanup.
    - Exit criterion: reopen before widening IDs beyond signed int or when central route-ID parsing is added.

12. AGG-C13-18 - Database backups are plaintext at rest
    - Original severity/confidence: Low / High.
    - Citation: DB backup actions/download route/schema.
    - Repo rule permitting deferral: CLAUDE.md Database Security states, "Dumps are plaintext SQL at rest; host/storage encryption is the operator boundary."
    - Reason: accepted operator boundary for this self-hosted app.
    - Exit criterion: reopen if backups are synced off-host without encryption or operator requires app-level backup encryption.

13. AGG-C13-19 - Checked-in nginx is HTTP-only and depends on an external TLS edge
    - Original severity/confidence: High if internet-facing, otherwise informational / Medium for deployed exposure.
    - Citation: `apps/web/nginx/default.conf:21-29`, `apps/web/docker-compose.yml`.
    - Reason: nginx comments explicitly require a TLS-terminating edge and production deploy is config-driven. Changing TLS here without topology authority could conflict with the actual edge.
    - Exit criterion: reopen immediately if host nginx is directly internet-facing over HTTP.

14. AGG-C13-20 - Public analytics actions can be intentionally forged within limits
    - Original severity/confidence: Low / Medium.
    - Citation: `apps/web/src/app/actions/public.ts:314-442`.
    - Repo rule permitting deferral: CLAUDE.md states shared-group `view_count` is "best-effort approximate analytics" and "Do not treat it as billing/audit-grade state".
    - Reason: analytics integrity is explicitly approximate and non-audit-grade.
    - Exit criterion: reopen if analytics are used for ranking, billing, abuse action, or public trust signals.

15. AGG-C13-21 - Retained originals may keep GPS if best-effort stripping cannot parse them
    - Original severity/confidence: Low / Medium.
    - Citation: upload/LR upload GPS stripping and `process-image.ts`.
    - Repo rule permitting deferral: CLAUDE.md states originals are stored privately under the data volume and public derivative/GPS fields are stripped; there is no original-download feature.
    - Reason: no current public leak path; risk is future original-download or off-host backup handling.
    - Exit criterion: reopen before adding original download/export or when privacy attestations require persisted strip status.

16. AGG-C13-22 - Failed-image retry recovery uses source-text tests for side effects
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/app/actions/images.ts:1162-1275`, `apps/web/src/__tests__/failed-image-retry.test.ts`.
    - Reason: test-quality improvement, not a confirmed runtime defect. Current auth/origin coverage remains in place.
    - Exit criterion: reopen when touching retry recovery or queue enqueue/error behavior.

17. AGG-C13-23 - Navigation visual check records screenshots without baselines
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/e2e/nav-visual-check.spec.ts:40-79`.
    - Reason: visual regression baseline policy and artifact churn need product approval.
    - Exit criterion: reopen when visual snapshots become part of CI acceptance.

18. AGG-C13-24 - Production CLIP semantic-search coverage is skipped by default CI
    - Original severity/confidence: Medium / High.
    - Citation: CLIP integration/offline tests and `.github/workflows/quality.yml`.
    - Reason: CI scheduling/caching cost and model artifact management are outside this local code-fix cycle.
    - Exit criterion: reopen before CLIP dependency upgrades or when scheduled/model-cache CI is available.

19. AGG-C13-25 - Expensive public GET route rate limiting remains a manual-audit boundary
    - Original severity/confidence: Medium / Medium.
    - Citation: `apps/web/scripts/check-public-route-rate-limit.ts` and public GET routes.
    - Reason: future gate hardening; current expensive GET routes have bespoke guards/tests.
    - Exit criterion: reopen when adding a new expensive public GET route or when extending lint gates.

20. AGG-C13-26 - Sitemap and robots routes lack direct route-level regression tests
    - Original severity/confidence: Low / Medium.
    - Citation: `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`.
    - Reason: low-risk coverage gap and no behavior change in this cycle.
    - Exit criterion: reopen when metadata routes change or SEO regressions are observed.

21. AGG-C13-27 - No coverage-report script or threshold exists
    - Original severity/confidence: Low / High.
    - Citation: package scripts, vitest config, CI workflow.
    - Reason: tooling policy change; adding coverage thresholds could create noisy work unrelated to current defects.
    - Exit criterion: reopen when adopting changed-file coverage or quality metrics.

22. AGG-C13-29 - Single-instance runtime is an explicit correctness boundary
    - Original severity/confidence: High if violated / High.
    - Citation: CLAUDE.md runtime topology, Docker compose, process-local restore/queue/rate-limit/view-count state.
    - Repo rule permitting deferral: CLAUDE.md explicitly documents "single web-instance / single-writer topology" and says not to horizontally scale until coordination states are moved to shared storage.
    - Reason: accepted deployment invariant, not a bug while production remains one web process.
    - Exit criterion: reopen before blue/green overlap, multiple web containers, Node clustering, or horizontal scaling.

23. AGG-C13-35 - Mobile info sheet modality in peek state needs validation
    - Original severity/confidence: Medium / Medium.
    - Citation: `apps/web/src/components/info-bottom-sheet.tsx:176-210`.
    - Reason: needs real mobile assistive-tech validation; local DB-backed photo page was unavailable during review.
    - Exit criterion: reopen after VoiceOver/TalkBack/keyboard validation, or when changing the photo info sheet.

24. AGG-C13-36 - Similar-search target visibility hardening should be validated
    - Original severity/confidence: Medium / Medium.
    - Citation: `apps/web/src/app/api/search/similar/[id]/route.ts`.
    - Reason: manual validation risk; no confirmed leak was cited.
    - Exit criterion: reopen if route audit finds missing `processed`/visibility constraints or when similar-search route changes.

25. AGG-C13-37 - Upload serving realpath-before-stream TOCTOU assumption should be documented/validated
    - Original severity/confidence: Low / Medium.
    - Citation: `apps/web/src/lib/serve-upload.ts`.
    - Reason: residual local-filesystem race/trust-boundary issue; current code already rejects symlinks and realpath-confines.
    - Exit criterion: reopen if upload directories become writable by untrusted users/processes.

26. AGG-C13-38 - Review scratch files under `.context/reviews` are easy to commit accidentally
    - Original severity/confidence: Low / High.
    - Citation: `.gitignore:19-25`.
    - Reason: process hygiene issue, not product/runtime behavior. Avoid broad ignore-rule changes during the fix cycle to preserve committed review-history conventions.
    - Exit criterion: reopen if scratch files appear in `git status` again or if `.context/scratch/` convention is adopted.

## Scheduled, Not Deferred

AGG-C13-01, AGG-C13-02, AGG-C13-03, AGG-C13-04, AGG-C13-05, AGG-C13-06, AGG-C13-28, and AGG-C13-30 through AGG-C13-34 are scheduled in `plan/plan-372-cycle13-fixes.md`.

## Gate Validation Warnings

1. Cycle 13 build sitemap fallback warning
   - Original severity/confidence: Low / High.
   - Citation: `apps/web/src/app/sitemap.ts`; `npm run build --workspace=apps/web` output on 2026-06-29.
   - Reason: the production build succeeded, but local validation had no MySQL server listening on `127.0.0.1:3306`, so sitemap generation logged its existing homepage-only fallback path. Fixing this warning would require either provisioning a local DB fixture for build validation or changing the metadata route's offline behavior, which is broader than the scheduled cycle 13 fixes.
   - Exit criterion: reopen when local/CI builds require warning-free output, when metadata routes change, or when a deterministic build-time DB fixture is introduced.
