# Plan 383 - Cycle 12 Deferred Findings

Status: TODO / deferred
Cycle: 12/100
Source review aggregate: `.context/reviews/_aggregate.md`
Created: 2026-07-07 KST

Repo rules checked before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, docs under `docs/**`, and root/app README context. `.cursorrules` and `CONTRIBUTING.md` are absent.

Deferred work remains bound by repo policy: GPG-signed commits, Conventional Commit + gitmoji, `git pull --rebase` before push, no `--no-verify`, no force-push, required quality gates, migration checklist, Node 24/Next 16/React 19/TypeScript 6 policy, and deployment rules.

Repo rules quoted where they permit deferral of operational/product/scale findings:

- `CLAUDE.md` Runtime topology: "The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance uses a host-side marker plus process state; upload quota tracking and image queue state are process-local, so do not horizontally scale the web service unless those coordination states are moved to a shared store."
- `CLAUDE.md` Runtime topology: "Public SSR page rate limiting ... public PAGES ... are throttled at the NGINX EDGE ... Applying a config change to the live host requires an operator `nginx -t && systemctl reload nginx` — per-iteration deploys rebuild the container only and DO NOT touch host nginx."
- `CLAUDE.md` Runtime topology: "Shared-group `view_count` is best-effort approximate analytics ... Do not treat it as billing/audit-grade state unless it is moved to durable storage."
- `AGENTS.md` Working agreements: "Keep diffs small, reviewable, and reversible."
- `AGENTS.md` Working agreements: "Prefer deletion, existing utilities, and existing patterns before new abstractions; add dependencies only when explicitly requested."

## Deferred Findings

1. `AGG-C12-05` - Dynamic date archive/home paths use non-sargable date functions
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/lib/data-timeline.ts:102-155`, `apps/web/src/app/[locale]/(public)/page.tsx:232-235`.
   - Reason: schema/index performance work requiring migration and query/test changes. No correctness failure or slow-query evidence was produced this cycle.
   - Exit criterion: slow homepage/timeline/on-this-day evidence, or a scheduled schema-index performance cycle.

2. `AGG-C12-06` - Public map can hydrate 10,000 markers plus a duplicate accessible list
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/lib/data.ts:1741-1777`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`.
   - Reason: map clustering/viewport loading is product/performance work with UX and API implications. Prior registers already defer map clustering pending GPS-heavy scale evidence.
   - Exit criterion: production map-visible rows approach thousands, browser traces show `/map` hydration jank, or map clustering/viewport API work is scheduled.

3. `AGG-C12-07` - Public listing queries aggregate tags before limiting the page
   - Original severity/confidence: Medium / Medium.
   - Citation: `apps/web/src/lib/data.ts:786-828`, `apps/web/src/lib/data.ts:893-940`.
   - Reason: broad query-shape refactor needing `EXPLAIN` and ordering/tag regression coverage. No current incorrect output.
   - Exit criterion: listing slow-query evidence, tag-heavy gallery benchmark, or planned data-query rewrite.

4. `AGG-C12-08` - Semantic and similar-photo APIs brute-force embedding blobs on the request path
   - Original severity/confidence: Medium / Medium.
   - Citation: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`.
   - Reason: production semantic scaling architecture. WP4 schedules the non-deferrable real-model preflight gate; vector index/worker scoring remains a scale project.
   - Exit criterion: measured semantic latency/CPU/RSS pressure, scan cap increase, or vector-index/worker-scoring work.

5. `AGG-C12-09` - Batch image deletion repeats derivative-directory scans per image and format
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/app/actions/images.ts:735-744`, `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:575-664`.
   - Reason: bulk-delete performance optimization. Current correctness favors exhaustive cleanup of historical variants.
   - Exit criterion: admin bulk-delete latency evidence, NAS I/O pressure evidence, or derivative cleanup refactor.

6. `AGG-C12-10` - Public smart collections can expose expensive predicates on uncached routes
   - Original severity/confidence: Medium / Medium.
   - Citation: `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/lib/data.ts:1488-1544`.
   - Reason: smart-collection public predicate policy/product work. Current authoring is operator-only with no admin UI.
   - Exit criterion: smart-collection admin UI/public authoring ships, slow query evidence from existing collections, or collection materialization work.

7. `AGG-C12-11` - Image queue and in-app backfill reserve DB-pool headroom independently
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts:120-140`, `apps/web/src/lib/admin-backfill-runner.ts:96-142`.
   - Reason: operational performance risk under overlapping background workloads. No current pool starvation was reported; default concurrency remains conservative.
   - Exit criterion: pool starvation evidence, raised background concurrency, or next image-queue/backfill scheduling cycle.

8. `AGG-C12-12` - Startup orphan-temp cleanup uses unbounded stat/unlink fan-out
   - Original severity/confidence: Low / High.
   - Citation: `apps/web/src/lib/image-queue.ts:40-96`, `apps/web/src/lib/image-queue.ts:1226-1230`, `apps/web/src/lib/process-topic-image.ts:146-168`.
   - Reason: low-severity crash-residue hardening. Needs a shared bounded-concurrency cleanup helper decision.
   - Exit criterion: startup I/O/EMFILE evidence, temp-file buildup incident, or cleanup subsystem refactor.

9. `AGG-C12-13` - Authenticated photo page performs duplicate image fan-out
   - Original severity/confidence: Low / High.
   - Citation: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159`, `apps/web/src/lib/data.ts:1057-1080`, `apps/web/src/lib/data.ts:1152-1198`.
   - Reason: low-severity query efficiency cleanup on admin browsing. Not user-visible at current scale.
   - Exit criterion: measurable admin photo-page DB fan-out, or photo page data-fetch refactor.

10. `AGG-C12-14` - Byte-affecting image settings can advertise new policy before static derivatives are regenerated
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/next.config.ts:56-72`, `apps/web/src/lib/serve-upload.ts:240-258`, `CLAUDE.md:338-340`.
    - Reason: documented operational/product architecture tradeoff. Making settings a generation workflow requires derivative URL/versioning or a backfill state machine.
    - Exit criterion: user/operator requires byte policy to take effect immediately without backfill, or derivative versioning/generation workflow is scheduled.

11. `AGG-C12-15` - Single-writer correctness remains warn-only while key state is process-local
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`, `CLAUDE.md:244-249`.
    - Reason: allowed by the quoted single web-instance/single-writer topology. Failing startup on contention can take production down during a rolling/deploy mistake and needs operator opt-in semantics.
    - Exit criterion: multi-instance incident, planned blue/green/multi-container deployment, or explicit decision to add enforced readiness/startup mode.

12. `AGG-C12-16` - Legacy schema reconcile remains a second schema authority with mostly source-only parity coverage
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/scripts/migrate.js:348-730`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-20`.
    - Reason: integration-test infrastructure requiring disposable MySQL schema diffing. It is a test-depth gap, not a confirmed schema mismatch.
    - Exit criterion: migration/reconcile code changes, DB integration parity gate work, or baseline divergence evidence.

13. `AGG-C12-18` - Browser/device e2e coverage is Chromium-only and screenshots are not visual assertions
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:72-77`, `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, `apps/web/e2e/nav-visual-check.spec.ts:85`.
    - Reason: CI matrix and visual-baseline policy expansion can increase runtime/flakiness and needs dedicated rollout.
    - Exit criterion: browser-specific bug, CI capacity decision, or visual-baseline adoption plan.

14. `AGG-C12-19` - Important client interactions are still protected by source strings or permissive browser assertions
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/__tests__/photo-viewer-auto-lightbox-source.test.ts:8-14`, `apps/web/e2e/hydration-photo-page.spec.ts:44-49`, `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`.
    - Reason: broad behavior-test modernization. Needs staged replacement to preserve coverage and avoid brittle e2e expansion.
    - Exit criterion: affected component changes, source-contract failure, or dedicated browser-behavior test cycle.

15. `AGG-C12-20` - Admin UI e2e still misses first-class admin surfaces
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/e2e/admin.spec.ts:73-165`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-128`.
    - Reason: broad browser-flow coverage expansion requiring admin credentials and seeded state. Not tied to this cycle's planned source fixes.
    - Exit criterion: admin UI feature changes, reported admin UI regression, or dedicated e2e expansion.

16. `AGG-C12-21` - DB restore child-process failure cleanup remains source-only
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/__tests__/db-restore.test.ts:47-74`, `apps/web/src/app/[locale]/admin/db-actions.ts:807-833`.
    - Reason: behavior-test harness work for child-process mocking. No current restore cleanup defect was reproduced.
    - Exit criterion: restore code changes, failed restore cleanup incident, or scheduled restore behavior-test pass.

17. `AGG-C12-22` - Lightroom upload route still has untested failure branches
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-158`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-424`.
    - Reason: handler coverage expansion. Existing tests cover success and several failures; remaining branch matrix is broad but not a proven current defect.
    - Exit criterion: LR upload route changes, reported LR client failure, or scheduled route branch coverage pass.

18. `AGG-C12-23` - There is no coverage report, threshold, or changed-file ratchet
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/package.json:13`, `apps/web/vitest.config.ts:1-39`, `.github/workflows/quality.yml:66-67`.
    - Reason: project-wide quality-policy change needing baseline and exemption policy.
    - Exit criterion: coverage baseline work is scheduled or untested critical-file regressions recur.

19. `AGG-C12-24` - Shared-group data reader owns hidden view-count mutation
    - Original severity/confidence: Low / High.
    - Citation: `apps/web/src/lib/data.ts:13-63`, `apps/web/src/lib/data.ts:1318-1407`, `apps/web/src/lib/data.ts:1805-1809`.
    - Reason: low-severity analytics design cleanup. Quoted CLAUDE.md defines shared-group view count as best-effort approximate analytics, not billing/audit-grade state.
    - Exit criterion: shared-group analytics refactor, false view-count evidence, or public share data-access refactor.

20. `AGG-C12-25` - Experimental storage abstraction advertises live-pipeline use without live-pipeline invariants
    - Original severity/confidence: Low / Medium.
    - Citation: `apps/web/src/lib/storage/index.ts:1-18`, `apps/web/src/lib/storage/types.ts:44-100`, `apps/web/src/lib/storage/local.ts:76-108`, `apps/web/src/lib/process-image.ts:1164-1224`.
    - Reason: storage module is quarantined and not integrated. No current product path uses it for derivative writes.
    - Exit criterion: storage abstraction integration resumes, docs advertise non-local storage, or storage quarantine is lifted.

21. `AGG-C12-26` - Active carry-forward backlog duplicates the runtime site-config decision
    - Original severity/confidence: Low / Medium.
    - Citation: `.context/plans/deferred-carry-forward.md:24-29`, `.context/plans/deferred-carry-forward.md:60`, `.context/plans/deferred-carry-forward.md:76`.
    - Reason: documentation/backlog hygiene only. Current README/CLAUDE/code statements are aligned; duplicate row cleanup should be done with the carry-forward register's next mechanical update.
    - Exit criterion: next deferred carry-forward register update or site-config product decision.

22. `AGG-C12-27` - Public map and timeline are implemented but undiscoverable from normal navigation
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/components/nav-client.tsx:128`, `apps/web/src/components/nav-client.tsx:167`, `apps/web/src/components/footer.tsx:41`.
    - Reason: product/navigation decision. Adding persistent links changes public IA and should align with map/timeline promotion strategy.
    - Exit criterion: product decision to promote map/timeline, visitor feedback, or public navigation redesign.

23. `AGG-C12-28` - Production semantic search is active but hidden behind an icon-only nav affordance
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/components/search.tsx:371`, `apps/web/src/components/search.tsx:521`.
    - Reason: product-marketing/IA change dependent on whether semantic search is actively promoted on a deployment. Fresh-install default remains disabled.
    - Exit criterion: semantic search is promoted as a live feature, or nav/search IA redesign is scheduled.

24. `AGG-C12-29` - Similar photos is absent from the mobile photo info surface
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/components/photo-viewer.tsx:747`, `apps/web/src/components/photo-viewer.tsx:800`, `apps/web/src/components/info-bottom-sheet.tsx:353`.
    - Reason: product/UI addition with mobile layout and request-cost implications. Not a correctness defect.
    - Exit criterion: mobile photo-page redesign, similar-photo promotion as a live feature, or mobile visitor feedback.

25. `AGG-C12-30` - Mobile home spends the first photo viewport on a tag-filter wall
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/components/home-client.tsx:303`, `apps/web/src/components/home-client.tsx:318`, `apps/web/src/components/tag-filter.tsx:62`.
    - Reason: product/IA tuning for gallery-first mobile presentation. Requires responsive design iteration and browser checks.
    - Exit criterion: mobile homepage redesign or visitor feedback that photos are buried below taxonomy controls.

26. `AGG-C12-31` - Category, tag, and SEO save failures are toast-only
    - Original severity/confidence: Medium / High.
    - Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42`.
    - Reason: admin UX/a11y form-pattern pass across multiple surfaces. Not security/correctness/data-loss; toast live region already gives a minimal alert.
    - Exit criterion: admin form refactor, accessibility complaint, or dedicated admin form a11y cycle.

27. `AGG-C12-32` - Tag autocomplete popovers can be clipped inside the admin image table scroller
    - Original severity/confidence: Medium / Medium.
    - Citation: `apps/web/src/components/image-manager.tsx:427`, `apps/web/src/components/image-manager.tsx:501`, `apps/web/src/components/tag-input.tsx:184`, `apps/web/src/components/tag-input.tsx:231`.
    - Reason: likely UI bug needing authenticated/manual validation and a popover/portal component decision.
    - Exit criterion: manual reproduction, admin image-management UI refactor, or tag-input portal work.

28. `AGG-C12-33` - Admin image management remains table-first for a photo-first workflow
    - Original severity/confidence: Low-Medium / Medium.
    - Citation: `apps/web/src/components/image-manager.tsx:427`, `apps/web/src/components/image-manager.tsx:431`, `apps/web/src/components/image-manager.tsx:501`.
    - Reason: product/workflow redesign. Current table remains functional and existing admin mobile/table concerns are already carried in prior registers.
    - Exit criterion: admin image-management redesign or evidence that table-first workflow blocks real admin cleanup work.

## Integrity Check

Every Cycle 12 aggregate finding is either scheduled in `plan/plan-382-cycle12-fixes.md` or recorded above. Original severity/confidence are preserved. No deferred item is a confirmed security, correctness, or data-loss defect that the repo rules require immediate action for this cycle.
