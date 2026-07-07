# Cycle 11/100 Deferred Findings

Date: 2026-07-07
Source review: `.context/reviews/_aggregate.md`
Status: active deferred register

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, relevant `.context/**` plan/review inventory, docs policy/style scan. `.cursorrules` and `CONTRIBUTING.md` are absent.

Security, correctness, and data-loss findings are not deferred here unless the deferral is for an upstream/tooling constraint already tracked by repo planning policy, or the item is explicitly product/manual-validation/scale work rather than a direct correctness fix. Original severity/confidence are preserved.

## Deferred Items

### AGG-C11-02 - Shared-group read helper owns view-count mutation

- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/data.ts:1318-1407`
- Reason: low-severity analytics design cleanup; `CLAUDE.md` documents shared-group view counts as best-effort approximate analytics, not billing/audit-grade state. Refactor touches public share semantics and should be done with a dedicated behavior test.
- Exit criterion: next shared-group analytics refactor, or evidence of false view-count inflation from non-public reads.

### AGG-C11-04 - Load-more tests duplicate a looser cursor normalizer

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/__tests__/public-actions.test.ts:39-56`
- Reason: validation-oracle improvement; direct cursor normalizer tests already exist in the current repo per test-engineer missed-issue sweep, so this is not an active production correctness bug.
- Exit criterion: pagination cursor contract changes or a future action-test refactor touches mocked data helpers.

### AGG-C11-05 - Batch image deletion scans derivative directories repeatedly

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/actions/images.ts:735-744`
- Reason: performance scale optimization, not correctness. Needs filesystem/NAS-scale validation to avoid changing cleanup semantics blindly.
- Exit criterion: admin delete latency observed on large galleries, or a planned derivative cleanup rewrite.

### AGG-C11-06 - Dynamic date archive/home paths still use non-sargable date functions

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/data-timeline.ts:102-130`
- Reason: schema/index performance work requiring a migration and query/test changes. Not security/data-loss; needs explicit migration sizing and production `EXPLAIN` evidence.
- Exit criterion: slow query evidence for homepage/timeline year/on-this-day, or scheduled schema-index performance cycle.

### AGG-C11-07 - Public listing queries aggregate tags before limiting the page

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/data.ts:786-828`
- Reason: broad query-shape performance refactor; needs `EXPLAIN` and regression coverage for ordering/tag aggregation.
- Exit criterion: listing query slow logs, large tag-heavy gallery benchmark, or planned data-query rewrite.

### AGG-C11-08 - Semantic search/similar routes brute-force embedding blobs per request

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/app/api/search/semantic/route.ts:263-311`
- Reason: production semantic search architecture/scaling work. Current docs already describe bounded scan limits and operator-controlled activation.
- Exit criterion: production semantic search enabled with enough embeddings/concurrency to show event-loop or DB pressure, or planned vector-index adoption.

### AGG-C11-09 - Public map can ship and hydrate up to 10,000 markers plus a duplicate list

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/data.ts:1741-1777`
- Reason: map clustering/viewport-loading is a product/performance project with UI implications and has been deferred in prior plan registers pending scale evidence.
- Exit criterion: GPS-heavy gallery performance evidence, or scheduled map clustering/virtualization work.

### AGG-C11-10 - Public smart collections can expose expensive predicates on dynamic routes

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/smart-collections.ts:221-267`
- Reason: public smart-collection predicate policy/product work; current docs say smart collection authoring has no admin UI and is operator-authored.
- Exit criterion: smart collection admin UI/public authoring ships, or slow query evidence from existing operator-authored collections.

### AGG-C11-11 - Admin photo page duplicates image fan-out for authenticated viewers

- Original severity/confidence: Low / High
- Citation: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159`
- Reason: low-severity query efficiency cleanup; not user-visible at current scale.
- Exit criterion: admin photo-page DB fan-out becomes measurable, or photo page data-fetch code is being refactored.

### AGG-C11-12 - Startup orphan-temp cleanup uses unbounded filesystem fan-out

- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/image-queue.ts:40-96`
- Reason: low-severity crash-residue performance hardening. Needs a bounded-concurrency helper decision shared with other cleanup paths.
- Exit criterion: temp-file buildup incident, startup `EMFILE`/I/O pressure evidence, or cleanup subsystem refactor.

### AGG-C11-14 - Production dependency audit remains red on Next nested PostCSS

- Original severity/confidence: Medium / High
- Citation: `package-lock.json:9334`
- Reason: upstream/tooling constraint. Current registry evidence in reviews says latest stable Next still depends on nested `postcss@8.4.31`, and forced audit fix suggests an invalid downgrade. `.context/plans/README.md` records active deferred upstream/tooling audit findings as an accepted planning category.
- Exit criterion: stable Next release updates nested PostCSS, or a tested npm override removes the vulnerable nested copy without breaking all gates.

### AGG-C11-15 - Dev dependency audit remains red on deprecated esbuild chain

- Original severity/confidence: Low / High
- Citation: `package-lock.json:378-386`
- Reason: dev-only upstream/tooling constraint through Drizzle tooling. Not production runtime; defer until upstream chain removes deprecated `@esbuild-kit/*` or a safe override is proven.
- Exit criterion: Drizzle/tooling release removes vulnerable esbuild chain, or CI/dev server exposure policy changes.

### AGG-C11-16 - Legacy reconcile remains a second schema authority with source-only parity coverage

- Original severity/confidence: Medium / High
- Citation: `apps/web/scripts/migrate.js:348-717`
- Reason: significant integration-test infrastructure requiring disposable MySQL schemas. It is a test-depth gap, not an immediate schema defect.
- Exit criterion: next migration/reconcile change, or scheduled DB integration parity gate work.

### AGG-C11-17 - Real CLIP production activation is outside required gates

- Original severity/confidence: High / High
- Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`
- Reason: production CLIP remains operator-enabled and explicitly not assumed live; real-weight CI requires large external model artifacts. Existing repo docs require operator preflight before activation.
- Exit criterion: production semantic search is enabled as a release promise, CLIP dependency changes, or CI cache/model seeding is provisioned.

### AGG-C11-18 - Nginx security/performance controls remain outside deploy visibility

- Original severity/confidence: Medium / High
- Citation: `apps/web/deploy.sh:51-56`
- Reason: host nginx apply/reload is operator infrastructure work outside the container deploy script. Repo docs already state per-iteration deploys do not touch host nginx.
- Exit criterion: next nginx template security/rate-limit change, production edge incident, or explicit operator approval to manage host nginx in deploy.

### AGG-C11-19 - Single-writer topology is warn-only

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/single-writer-guard.ts:218-235`
- Reason: operational policy/product decision. Exiting on contention can take production down during rolling deploy mistakes; needs operator opt-in design.
- Exit criterion: multi-instance incident, or decision to add `GALLERYKIT_ENFORCE_SINGLE_WRITER` with deploy/readiness semantics.

### AGG-C11-20 - Mobile bottom-sheet dropdown regression lock is source-string only

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`
- Reason: browser-flow coverage improvement that likely needs seeded wide-gamut fixture and e2e runtime. Not required unless browser-flow coverage is being changed this cycle.
- Exit criterion: bottom sheet/dropdown code changes, mobile regression report, or e2e coverage expansion cycle.

### AGG-C11-21 - Touch-target gate lets bare text links pass

- Original severity/confidence: Low / High
- Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:457-464`
- Reason: low-severity test-policy refinement; current targeted UI checks found no live sub-44 px controls.
- Exit criterion: new control-like bare text link, touch-target complaint, or audit rewrite.

### AGG-C11-25 - DB restore child-process failure cleanup is source-only

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/__tests__/db-restore.test.ts:47-75`
- Reason: behavior-test harness work for child process mocking. Correctness-sensitive restore source is stable, but no current defect was proven.
- Exit criterion: restore code changes, failed restore cleanup incident, or scheduled restore behavior-test pass.

### AGG-C11-27 - First-class admin UI surfaces remain e2e-shallow

- Original severity/confidence: Medium / High
- Citation: `apps/web/e2e/admin.spec.ts:20-165`
- Reason: broad browser-flow coverage expansion requiring admin e2e credentials/data. Not tied to this cycle's code fixes.
- Exit criterion: admin UI feature changes, reported admin UI regression, or dedicated e2e expansion.

### AGG-C11-28 - Client interaction regressions are often locked by source strings

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/__tests__/photo-viewer-auto-lightbox-source.test.ts:8-21`
- Reason: broad test strategy migration from source contracts to behavior tests. Needs staged replacement to avoid destabilizing coverage.
- Exit criterion: affected component changes, flaky/source-contract failure, or dedicated behavior-test modernization cycle.

### AGG-C11-29 - Browser/device/visual regression gates are too narrow

- Original severity/confidence: Medium / High
- Citation: `apps/web/playwright.config.ts:72-77`
- Reason: CI matrix expansion can materially increase runtime/flake rate and needs deliberate rollout.
- Exit criterion: browser-specific bug, CI capacity decision, or visual-baseline adoption plan.

### AGG-C11-30 - No coverage report, threshold, or changed-file ratchet exists

- Original severity/confidence: Medium / High
- Citation: `apps/web/vitest.config.ts:16-39`
- Reason: project-wide quality-policy change. Needs baseline generation and exemption policy before enforcement.
- Exit criterion: coverage baseline work is scheduled or regressions from untested critical files recur.

### AGG-C11-32 - Byte-impacting settings commit before static derivatives are regenerated

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/actions/settings.ts:168-239`
- Reason: already documented operational gotcha in `CLAUDE.md`; turning settings into versioned derivative workflow is a product/architecture project.
- Exit criterion: user/operator requires settings to take effect immediately without backfill, or derivative URL/versioning work is scheduled.

### AGG-C11-33 - Experimental storage abstraction is weaker than live file-pipeline contract

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/lib/storage/types.ts:44-100`
- Reason: storage module is documented as not integrated/supported. No current product path uses it for derivative writes.
- Exit criterion: storage abstraction integration resumes, or docs begin advertising non-local storage support.

### AGG-C11-37 - Admin category/tag/SEO save failures are toast-only

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90-108`
- Reason: UX/accessibility improvement across multiple admin forms; not security/correctness/data-loss. Needs a coherent form-error pattern pass.
- Exit criterion: admin form component refactor, accessibility complaint, or dedicated admin form a11y cycle.

### AGG-C11-38 - Tag autocomplete popovers can be clipped inside admin image table scroller

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/components/image-manager.tsx:427`
- Reason: likely UI bug needing authenticated/manual validation and a popover/portal component decision.
- Exit criterion: admin image-management UI refactor, manual reproduction, or tag-input portal work.

### AGG-C11-39 - Map/timeline routes are working but not discoverable from public nav

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/components/nav-client.tsx:128-191`
- Reason: product/navigation decision. Adding persistent nav links changes public IA and should be decided with the map/timeline visibility strategy.
- Exit criterion: product decision to promote map/timeline, or user feedback that these routes are undiscoverable.

### AGG-C11-40 - Production semantic-search differentiator is hidden behind an icon-only control

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/components/search.tsx:369-383`
- Reason: product-marketing/IA change dependent on whether semantic search is active on a deployment. Current default remains disabled.
- Exit criterion: production semantic search is enabled as a promoted feature or nav/search IA is redesigned.

### AGG-C11-41 - Similar photos are documented but missing from mobile photo surface

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/components/photo-viewer.tsx:747-800`
- Reason: product/UI addition with mobile layout and request-cost implications. Not a correctness defect.
- Exit criterion: semantic similar photos are promoted for mobile users or mobile info sheet is redesigned.

### AGG-C11-44 - Mobile home puts a tag-filter wall before the first photo

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/components/tag-filter.tsx:62-123`
- Reason: product/IA choice dependent on tag count and desired browsing mode. Needs visual design iteration.
- Exit criterion: mobile UX redesign or live data shows first photo pushed below the initial viewport in production.

### AGG-C11-46 - Admin image management is table-first rather than photo-workbench-first

- Original severity/confidence: Medium / Medium-High
- Citation: `apps/web/src/components/image-manager.tsx:427-603`
- Reason: major admin UX redesign, not a bug fix.
- Exit criterion: admin image-management redesign is scheduled.

### AGG-C11-47 - Admin navigation is a flat ten-link wrap

- Original severity/confidence: Low-Medium / High
- Citation: `apps/web/src/components/admin-nav.tsx:15-49`
- Reason: admin IA redesign; low-to-medium UX issue without correctness/security impact.
- Exit criterion: admin nav adds more destinations, Korean/mobile wrapping worsens, or admin IA redesign is scheduled.

