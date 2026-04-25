# Plan 236 — Cycle 5 review-plan-fix deferred findings

Status: active
Created: 2026-04-25
Source aggregate: `.context/reviews/_aggregate.md`.

This file records every Cycle 5 aggregate finding not scheduled in `plan/plan-235-cycle5-rpf-fixes.md`. Severity/confidence are preserved; no review finding is silently dropped.

## Repo-policy basis for deferral

- `AGENTS.md`: “Keep diffs small, reviewable, and reversible”; “No new dependencies without explicit request.”
- `CLAUDE.md`: the product is a **single web-instance / single-writer** deployment; process-local restore/upload/queue state must not be horizontally scaled until moved to shared storage.
- Existing `.context/**` and `plan/**`: broad architecture/performance/test-coverage redesigns are carried forward with severity and exit criteria rather than mixed into narrow security/correctness fix batches.
- Deferred work remains bound by repo policy when picked up: gitmoji + signed commits, no `--no-verify`, no force-push, Node 24+/TypeScript 6+, and all configured gates.

## Deferred items

### D-C5RPF-01 — Enforce or redesign process-local coordination
- **Citation:** AGG-C5-08; `README.md:145`; `apps/web/src/lib/restore-maintenance.ts`; `apps/web/src/lib/upload-tracker-state.ts`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/data.ts` shared-group counters.
- **Original severity/confidence:** High / High.
- **Reason:** `CLAUDE.md` explicitly states the shipped topology is single web-instance/single-writer and warns not to scale horizontally until these states move to shared storage. Enforcing singleton at runtime or redesigning coordination is broader than this narrow fix batch.
- **Exit criterion:** Any plan to support rolling deploy/multi-instance, or an incident involving split-brain restore/upload/queue state.

### D-C5RPF-02 — Add asset backup/restore or DB/file reconciliation
- **Citation:** AGG-C5-10; `apps/web/src/app/[locale]/admin/db-actions.ts`; upload roots under `data/uploads/original` and `public/uploads`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Operational data-management feature; not a same-cycle code defect. Current docs already distinguish DB backup and persistent upload volumes.
- **Exit criterion:** Operator requests full gallery backup/restore, or restore creates a confirmed broken media reference incident.

### D-C5RPF-03 — Local filesystem TOCTOU hardening for file serving/download
- **Citation:** AGG-C5-11; `apps/web/src/lib/serve-upload.ts`; `apps/web/src/app/api/admin/db/download/route.ts`.
- **Original severity/confidence:** Low / Medium.
- **Reason:** Requires fd-based streaming refactor; threat requires local filesystem race by a compromised local actor. Keep separate from current high-signal fixes.
- **Exit criterion:** File-serving internals are next touched or a local multi-tenant threat model is adopted.

### D-C5RPF-04 — Original-vs-derivative photo download product decision
- **Citation:** AGG-C5-12; `apps/web/src/components/photo-viewer.tsx` and viewer messages.
- **Original severity/confidence:** Medium / High.
- **Reason:** Prior plans changed visible copy toward JPEG derivative semantics; adding original download changes auth/storage/privacy surface. Needs product decision.
- **Exit criterion:** User requests original export/download, or copy audit finds remaining misleading “original” labels.

### D-C5RPF-05 — Stream CSV export
- **Citation:** AGG-C5-13; `apps/web/src/app/[locale]/admin/db-actions.ts` CSV export path.
- **Original severity/confidence:** Medium / High.
- **Reason:** Paged/streaming export requires API route/response refactor and UX changes. Existing capped export remains functional.
- **Exit criterion:** Observed export memory issue or dedicated export redesign.

### D-C5RPF-06 — Move DB backup/restore out of web request path / host binary preflight
- **Citation:** AGG-C5-14; `apps/web/src/app/[locale]/admin/db-actions.ts:102-469`; `apps/web/Dockerfile:10-16`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Ops architecture redesign; container image already installs required binaries. Host-runtime preflight should be a separate operational plan.
- **Exit criterion:** Non-container deployment becomes supported/tested or backup/restore binary failures are reported.

### D-C5RPF-07 — Shared-group duplicate DB work
- **Citation:** AGG-C5-15; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`; `apps/web/src/lib/data.ts` shared group loader.
- **Original severity/confidence:** Medium / High.
- **Reason:** Performance optimization; no correctness/security/data-loss failure reported.
- **Exit criterion:** Shared group route latency exceeds target or loader is refactored.

### D-C5RPF-08 — Decouple public chrome from DB-backed page data failures
- **Citation:** AGG-C5-16; public layout/page shell components.
- **Original severity/confidence:** High / Medium.
- **Reason:** UX resilience architecture; requires route-level error-boundary design beyond current scoped fixes.
- **Exit criterion:** Public DB outage UX is prioritized or error shell is redesigned.

### D-C5RPF-09 — Admin route-specific metadata
- **Citation:** AGG-C5-17; admin pages under `apps/web/src/app/[locale]/admin/(protected)/**/page.tsx`.
- **Original severity/confidence:** Medium / High.
- **Reason:** UX polish across many routes; no data/security impact.
- **Exit criterion:** Admin IA polish pass or route metadata work begins.

### D-C5RPF-10 — Localize footer config copy
- **Citation:** AGG-C5-18; `apps/web/src/components/footer.tsx`; `apps/web/src/site-config.json`.
- **Original severity/confidence:** Low / High.
- **Reason:** Product/content configuration change; requires deciding whether footer text remains site-config or moves to DB/i18n messages.
- **Exit criterion:** i18n/content-config pass.

### D-C5RPF-11 — Visible labels on admin login form
- **Citation:** AGG-C5-19; admin login form component.
- **Original severity/confidence:** Low / High.
- **Reason:** Low-severity UX polish; login form retains accessible labels and no auth behavior changes.
- **Exit criterion:** Login page UX pass.

### D-C5RPF-12 — GPS privacy switch locked-state UX
- **Citation:** AGG-C5-22; admin settings UI/server setting lock.
- **Original severity/confidence:** Medium / High.
- **Reason:** UX state-machine change tied to existing images; needs careful persisted-state test and is separate from this security/a11y batch.
- **Exit criterion:** Settings page is next touched or user reports confusing GPS lock behavior.

### D-C5RPF-13 — Remove or implement unused `parent_url`
- **Citation:** AGG-C5-26; site config docs/example and repo search for `parent_url`.
- **Original severity/confidence:** Low / High.
- **Reason:** Product config cleanup; not a runtime defect.
- **Exit criterion:** Config schema cleanup or parent-site navigation feature request.

### D-C5RPF-14 — Nginx sample/domain/path cleanup
- **Citation:** AGG-C5-27; `apps/web/nginx/default.conf`; README deployment docs.
- **Original severity/confidence:** Medium / High.
- **Reason:** Deployment documentation/sample cleanup; no current gate failure.
- **Exit criterion:** Deployment docs pass or operator confusion report.

### D-C5RPF-15 — `IMAGE_BASE_URL` parser constraints docs
- **Citation:** AGG-C5-28; README/env docs; `apps/web/next.config.ts` image remote pattern parsing.
- **Original severity/confidence:** Low / High.
- **Reason:** Low-severity docs clarification; grouped into future docs pass.
- **Exit criterion:** Next docs update or support issue about rejected image base URLs.

### D-C5RPF-16 — Same-origin fail-closed docs
- **Citation:** AGG-C5-29; `apps/web/src/lib/request-origin.ts`; README/CLAUDE same-origin docs.
- **Original severity/confidence:** Low / High.
- **Reason:** Low-severity docs clarification; behavior is already implemented.
- **Exit criterion:** Action-origin docs touched next.

### D-C5RPF-17 — Public page ISR/cache redesign
- **Citation:** AGG-C5-30; public route revalidate/dynamic settings and data loaders.
- **Original severity/confidence:** High / High.
- **Reason:** Performance architecture change; current behavior deliberately avoids stale background-processed images. Changing caching needs product freshness/capacity decision.
- **Exit criterion:** Public route load exceeds SLO or cache freshness policy is redesigned.

### D-C5RPF-18 — Keyset pagination / count strategy
- **Citation:** AGG-C5-31; listing queries in `apps/web/src/lib/data.ts`.
- **Original severity/confidence:** High / High.
- **Reason:** Data-access/API/UI pagination redesign; not a narrow bug fix.
- **Exit criterion:** Large-gallery performance issue or dedicated pagination migration.

### D-C5RPF-19 — Full-text/search redesign
- **Citation:** AGG-C5-32; `apps/web/src/lib/data.ts:744-820`; `apps/web/src/components/search.tsx`; `apps/web/src/db/schema.ts`.
- **Original severity/confidence:** High / High.
- **Reason:** Requires schema/search UX migration; no observed production SLO breach in this cycle.
- **Exit criterion:** Search latency exceeds budget or schema migration plan is approved.

### D-C5RPF-20 — Prev/next composite index with `id`
- **Citation:** AGG-C5-33; `apps/web/src/lib/data.ts`; `apps/web/src/db/schema.ts` indexes.
- **Original severity/confidence:** Medium / High.
- **Reason:** DB migration/index tuning needs workload validation and migration planning.
- **Exit criterion:** Photo navigation query plan shows filesort/range-scan bottleneck.

### D-C5RPF-21 — Bound batch-delete directory scans
- **Citation:** AGG-C5-34; batch delete/file cleanup helpers.
- **Original severity/confidence:** High / High.
- **Reason:** Performance/I/O hardening that needs safe concurrency design across deletion semantics.
- **Exit criterion:** Large batch-delete performance issue or delete pipeline refactor.

### D-C5RPF-22 — CPU/memory tuning for image processing
- **Citation:** AGG-C5-35; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/process-image.ts`.
- **Original severity/confidence:** High / High.
- **Reason:** Capacity tuning depends on deployment hardware and Sharp concurrency tradeoffs; no gate failure.
- **Exit criterion:** OOM/CPU incident or explicit capacity-tuning cycle.

### D-C5RPF-23 — Dedicated streaming upload transport
- **Citation:** AGG-C5-36; upload UI/action path and Next body-size config.
- **Original severity/confidence:** Medium / High.
- **Reason:** API architecture redesign; current limits are explicit.
- **Exit criterion:** Upload request failures under documented limits or product decision to support resumable uploads.

### D-C5RPF-24 — Virtualize/cap upload previews and tag inputs
- **Citation:** AGG-C5-37; `apps/web/src/components/upload-dropzone.tsx`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Frontend performance optimization across selection UI; separate from current semantic/progress fixes.
- **Exit criterion:** Browser responsiveness issue with max file count or upload UI refactor.

### D-C5RPF-25 — Avoid Next Image re-optimizing generated derivatives
- **Citation:** AGG-C5-38; public image rendering components/routes.
- **Original severity/confidence:** Medium / High.
- **Reason:** Rendering/perf tuning needs image-quality/cache validation.
- **Exit criterion:** Image optimization CPU/cache issue is measured.

### D-C5RPF-26 — Storage abstraction removal or full integration
- **Citation:** AGG-C5-39; `apps/web/src/lib/storage/index.ts`; `apps/web/src/lib/process-image.ts`; `apps/web/src/lib/serve-upload.ts`; `apps/web/src/lib/upload-paths.ts`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Architecture cleanup/storage feature decision; not a narrow defect.
- **Exit criterion:** Storage backend work resumes or dead-code cleanup pass targets storage.

### D-C5RPF-27 — Decouple retention jobs from image-queue bootstrap
- **Citation:** AGG-C5-40; `apps/web/src/instrumentation.ts`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/audit.ts`; `apps/web/src/lib/rate-limit.ts`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Maintenance runner architecture change; current bootstrap still runs in supported topology.
- **Exit criterion:** Image queue is disabled/moved or retention misses are observed.

### D-C5RPF-28 — Share-link/group regression test expansion
- **Citation:** AGG-C5-41; `apps/web/src/app/actions/sharing.ts`; related tests.
- **Original severity/confidence:** High / High.
- **Reason:** Test coverage gap only; no concrete runtime defect cited. Existing loop policy defers broad test expansions to dedicated test-hardening cycles.
- **Exit criterion:** Sharing action changes next or dedicated sharing test plan.

### D-C5RPF-29 — Middleware/CSP integration test expansion
- **Citation:** AGG-C5-42; `apps/web/src/proxy.ts`; CSP/request-origin tests.
- **Original severity/confidence:** High / High.
- **Reason:** Test coverage gap only; no concrete regression. Needs focused e2e/integration test design.
- **Exit criterion:** Middleware/CSP behavior changes or dedicated security test-hardening cycle.

### D-C5RPF-30 — Upload tracker global state tests
- **Citation:** AGG-C5-43; `apps/web/src/lib/upload-tracker-state.ts`; `apps/web/src/app/actions/images.ts`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Coverage gap; scheduled upload statfs fix does not alter tracker semantics.
- **Exit criterion:** Upload tracker code changes.

### D-C5RPF-31 — Visual-check assertions/image diffs
- **Citation:** AGG-C5-44; `apps/web/e2e/nav-visual-check.spec.ts`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Visual regression workflow design; screenshots alone are intentionally not a gate today.
- **Exit criterion:** Visual baseline system adopted.

### D-C5RPF-32 — Settings E2E persisted-state assertion
- **Citation:** AGG-C5-45; `apps/web/e2e/admin.spec.ts`; settings UI/server action.
- **Original severity/confidence:** Medium / High.
- **Reason:** Test coverage gap; GPS setting UX deferred separately.
- **Exit criterion:** Settings page changes or dedicated e2e reliability pass.

### D-C5RPF-33 — Replace source-text regression tests with behavior tests
- **Citation:** AGG-C5-46; source-text tests under `apps/web/src/__tests__`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Broad test refactor; not tied to a single behavior fix.
- **Exit criterion:** Each source-text test is touched or a test-quality cleanup is scheduled.

### D-C5RPF-34 — Client pagination/filter state tests
- **Citation:** AGG-C5-47; `apps/web/src/components/home-client.tsx`; `load-more.tsx`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Coverage gap; broad UI component test plan.
- **Exit criterion:** Filter/infinite-scroll behavior changes.

### D-C5RPF-35 — Startup/shutdown runtime wiring tests
- **Citation:** AGG-C5-48; `apps/web/src/instrumentation.ts`; queue shutdown/bootstrap tests.
- **Original severity/confidence:** Medium / High.
- **Reason:** Coverage gap; current implementation not changed beyond queue retry test.
- **Exit criterion:** Bootstrap/shutdown wiring changes.

### D-C5RPF-36 — Split DB page pending states
- **Citation:** AGG-C5-51; `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Admin UX state-machine refactor; separate from current security/a11y fixes.
- **Exit criterion:** DB admin page UX pass.

### D-C5RPF-37 — Info bottom sheet off-screen tab order
- **Citation:** AGG-C5-53; `apps/web/src/components/info-bottom-sheet.tsx`.
- **Original severity/confidence:** Medium / Medium.
- **Reason:** Mobile focus-state refactor needs browser/a11y validation.
- **Exit criterion:** bottom sheet component is next touched.

### D-C5RPF-38 — Lightbox alt fallback avoids raw filenames
- **Citation:** AGG-C5-54; `apps/web/src/components/lightbox.tsx`.
- **Original severity/confidence:** Medium / High.
- **Reason:** UX/content semantics decision; not coupled to current zoom/progress fixes.
- **Exit criterion:** lightbox accessibility pass.

### D-C5RPF-39 — Shortcut hint/lightbox key behavior alignment
- **Citation:** AGG-C5-56; public photo viewer/lightbox shortcut hints.
- **Original severity/confidence:** Low-medium / High.
- **Reason:** UX copy/interaction polish; no functional break.
- **Exit criterion:** viewer shortcut docs or lightbox keys change.

### D-C5RPF-40 — Admin nav touch target sizing
- **Citation:** AGG-C5-57; `apps/web/src/components/admin-nav.tsx`.
- **Original severity/confidence:** Low-medium / Medium.
- **Reason:** Low-severity mobile polish.
- **Exit criterion:** admin nav layout pass.

### D-C5RPF-41 — Locale-aware RTL direction
- **Citation:** AGG-C5-58; `apps/web/src/app/[locale]/layout.tsx:81-87`.
- **Original severity/confidence:** Low / High.
- **Reason:** Current supported locales are English/Korean (LTR). `CLAUDE.md`/constants do not advertise RTL support.
- **Exit criterion:** an RTL locale is added.

### D-C5RPF-42 — Scope photo swipe navigation listeners
- **Citation:** AGG-C5-59; `apps/web/src/components/photo-viewer.tsx`.
- **Original severity/confidence:** Medium / Medium.
- **Reason:** Touch/gesture behavior needs browser validation and could regress navigation.
- **Exit criterion:** viewer gesture system is next touched or accidental-swipe reports appear.

### D-C5RPF-43 — Upstream Next nested PostCSS advisory remains after direct app remediation
- **Citation:** AGG-C5-03; `package-lock.json` still resolves `node_modules/next/node_modules/postcss` to `8.4.31` via `next@16.2.3`; direct app `postcss` is now `8.5.10` in `apps/web/package.json` and `package-lock.json`.
- **Original severity/confidence:** Medium / High.
- **Reason:** Direct PostCSS was remediated without adding a new dependency. The remaining vulnerable copy is an exact transitive dependency of Next 16.2.3; `npm audit --omit=optional` reports only a semver-major/breaking fix path (`next@9.3.3`) rather than a safe upgrade, and `AGENTS.md` requires small, reviewable, reversible diffs with no new dependencies unless explicitly requested. This is therefore blocked on an upstream Next release or a dedicated framework-upgrade plan.
- **Exit criterion:** Next publishes a compatible version that removes or updates the nested `postcss@8.4.31`, npm override support can safely replace the nested exact dependency without breaking Next, or a dedicated Next/framework upgrade plan is approved.
