# Plan 256 — Cycle 1 RPF deferred findings

This file records aggregate review findings not scheduled for implementation in Plan 255. Severities/confidences are preserved. Deferred work remains bound by `AGENTS.md` (commit and push with gitmoji) and `CLAUDE.md` runtime/security/deployment constraints. Security/correctness/data-loss findings were scheduled in Plan 255; the items below are performance, test-infrastructure, documentation, product/UX polish, or architecture work that requires larger design/product decisions beyond this cycle.

## Repo rules read before deferral
- `CLAUDE.md`: documents the single web-instance/single-writer topology; notes approximate shared-group view counts; requires persistence of private originals and public derivatives; warns historical secrets must not be reused.
- `AGENTS.md`: commit and push all changes; use gitmoji.
- `.context/**`: no silent deferrals; preserve original severity and confidence.
- `.cursorrules`: absent.
- `CONTRIBUTING.md`: absent.
- `docs/`: no extra docs policy files.

## Deferred items

### DEF-AGG1-11 — Runtime sitemap fallback can cache homepage-only sitemap
- Citation: `apps/web/src/app/sitemap.ts:4-76`.
- Original severity/confidence: Medium / Medium-High.
- Reason for deferral: SEO/runtime behavior change requires choosing whether sitemap should return 503/no-store on DB outage or keep build-time fallback. Not a security/correctness/data-loss failure.
- Exit criterion: sitemap incident, crawler indexing issue, or dedicated metadata route hardening pass.

### DEF-AGG1-14 — Public first-page listing count/window hot path
- Citation: `apps/web/src/lib/data.ts:547-562` and public home/topic page calls.
- Original severity/confidence: High / High.
- Reason for deferral: performance architecture item already tracked in prior deferred plans; changing exact counts affects visible product copy and query shape.
- Exit criterion: gallery scale/TTFB issue, DB CPU evidence, or product approval for approximate/cached counts.

### DEF-AGG1-15 — Tag counts recompute per dynamic request
- Citation: `apps/web/src/lib/data.ts:272-289`, public pages.
- Original severity/confidence: Medium / High.
- Reason for deferral: performance/cache design; requires persistent cache/materialized counts and invalidation plan.
- Exit criterion: observed slow tag aggregation or cache/materialized-count milestone.

### DEF-AGG1-16 — Public search leading-wildcard LIKE scans
- Citation: `apps/web/src/lib/data.ts:915-1004`.
- Original severity/confidence: Medium / High.
- Reason for deferral: requires full-text/token search design and migration; current rate limits bound abuse.
- Exit criterion: search latency/DB CPU incident or search-index project.

### DEF-AGG1-17 — Upload advisory lock held through slow work
- Citation: `apps/web/src/app/actions/images.ts:171-430`.
- Original severity/confidence: Medium / Medium-High.
- Reason for deferral: performance/concurrency refactor requiring upload contract/version design; not a confirmed data-loss bug.
- Exit criterion: upload/settings lock contention incident or upload pipeline redesign.

### DEF-AGG1-18 — Sharp per-job parallel format pipelines
- Citation: `apps/web/src/lib/process-image.ts:408-478`.
- Original severity/confidence: Medium / Medium-High.
- Reason for deferral: resource tuning requires benchmark/deployment defaults; no correctness loss confirmed.
- Exit criterion: CPU/memory incident or image worker tuning project.

### DEF-AGG1-19 — Bulk delete repeated directory scans
- Citation: `apps/web/src/app/actions/images.ts:612-626`, `apps/web/src/lib/process-image.ts:181-203`.
- Original severity/confidence: Medium / High.
- Reason for deferral: performance-only filesystem batching improvement; current delete remains correct.
- Exit criterion: slow bulk delete report or cleanup-worker project.

### DEF-AGG1-20 — CSV export materializes large dataset
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:54-118`.
- Original severity/confidence: Medium / High.
- Reason for deferral: streaming export route is a larger feature; existing cap bounds memory risk.
- Exit criterion: export memory/performance issue or streaming-download task.

### DEF-AGG1-22 — Checked-in maintainer canonical URL risk
- Citation: `apps/web/src/site-config.json:1-10`, `apps/web/scripts/ensure-site-config.mjs:4-21`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: deployment/product packaging decision; no runtime bug for the current configured instance.
- Exit criterion: self-hoster reports wrong canonical URLs or packaging/setup redesign.

### DEF-AGG1-23 — Node upload-serving fallback syscall overhead
- Citation: `apps/web/src/lib/serve-upload.ts:69-95`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: performance-only and production nginx serves uploads directly.
- Exit criterion: supported non-nginx deployment or asset-serving latency issue.

### DEF-AGG1-24 — Back-to-top scroll listener
- Citation: `apps/web/src/components/home-client.tsx:121-129`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: small UI performance optimization; no functional failure.
- Exit criterion: mobile scroll jank evidence or frontend performance pass.

### DEF-AGG1-25 — Env files encouraged in repo checkout
- Citation: `README.md`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`.
- Original severity/confidence: Low / High.
- Reason for deferral: docs/ops cleanup; no tracked secrets found and safer remote helper path already exists.
- Exit criterion: deployment docs pass or any evidence ignored secrets were exposed.

### DEF-AGG1-27 — TRUST_PROXY misconfiguration operational visibility
- Citation: `apps/web/src/lib/rate-limit.ts:82-113`.
- Original severity/confidence: Low / High.
- Reason for deferral: operational hardening; current safe default intentionally fails closed to `unknown` and warns.
- Exit criterion: production misconfiguration report or readiness/startup checks project.

### DEF-AGG1-29 — TSX component unit/component test lane
- Citation: `apps/web/vitest.config.ts:6-10`, representative components under `apps/web/src/components/`.
- Original severity/confidence: High / High.
- Reason for deferral: test-infrastructure expansion, not a confirmed product bug.
- Exit criterion: component refactor or adoption of DOM/component test lane.

### DEF-AGG1-30 — Broad sharing action behavioral suite
- Citation: `apps/web/src/app/actions/sharing.ts:92-391`.
- Original severity/confidence: High / High.
- Reason for deferral: Plan 255 adds targeted coverage for touched share race/limiter behavior; the full matrix is broader test-infrastructure work.
- Exit criterion: sharing action refactor or test-hardening sprint.

### DEF-AGG1-31 — Topic cover image filesystem tests
- Citation: `apps/web/src/lib/process-topic-image.ts:42-105`.
- Original severity/confidence: High / High.
- Reason for deferral: test coverage gap; no current processor failure confirmed.
- Exit criterion: topic image processor change or filesystem/image test sprint.

### DEF-AGG1-32 — Screenshot capture without visual assertions
- Citation: `apps/web/e2e/nav-visual-check.spec.ts`.
- Original severity/confidence: Medium / High.
- Reason for deferral: visual QA policy/baseline decision.
- Exit criterion: visual baseline approval or nav layout regression project.

### DEF-AGG1-33 — E2E bootstrap retry hardening
- Citation: `apps/web/scripts/run-e2e-server.mjs:75-84`.
- Original severity/confidence: Medium-High / High.
- Reason for deferral: CI reliability improvement; not a production app defect.
- Exit criterion: recurrent E2E init flake or CI reliability pass.

### DEF-AGG1-34 — E2E cleanup leaks on failures
- Citation: `apps/web/e2e/helpers.ts`, `apps/web/e2e/admin.spec.ts`.
- Original severity/confidence: Medium / High.
- Reason for deferral: test-fixture hygiene; no production impact.
- Exit criterion: E2E pollution/flakiness or fixture rewrite.

### DEF-AGG1-35 — Source-text tests stand in for behavior
- Citation: `apps/web/src/__tests__/data-view-count-flush.test.ts` and similar tests.
- Original severity/confidence: Medium / High.
- Reason for deferral: test architecture improvement; not a confirmed runtime failure.
- Exit criterion: touching those modules or behavior-test migration sprint.

### DEF-AGG1-36 — Route-level middleware/metadata/OG coverage thin
- Citation: `apps/web/src/proxy.ts`, `sitemap.ts`, `robots.ts`, `manifest.ts`, `api/og/route.tsx`.
- Original severity/confidence: Medium / High.
- Reason for deferral: coverage expansion; no current route defect beyond scheduled items.
- Exit criterion: route refactor or metadata/OG incident.

### DEF-AGG1-37 — Backup-download chmod test flake risk
- Citation: `apps/web/src/__tests__/backup-download-route.test.ts`.
- Original severity/confidence: Low-Medium / Medium.
- Reason for deferral: test reliability improvement; current gate will prove present environment.
- Exit criterion: test flakes on permissions or route test rewrite.

### DEF-AGG1-38 — Coverage artifact/threshold gate absent
- Citation: `apps/web/package.json:13`, `apps/web/vitest.config.ts`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: process/tooling change requiring baseline/ratchet policy.
- Exit criterion: test governance milestone.

### DEF-AGG1-41 — Upload tracker conflates quota and active claims
- Citation: `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/app/actions/images.ts`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: concurrency/UX refinement; current Plan 255 keeps upload/setting lock safety.
- Exit criterion: false upload-settings lock report.

### DEF-AGG1-42 — Standalone Docker image public assets
- Citation: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`.
- Original severity/confidence: Medium / High.
- Reason for deferral: deployment packaging/design; compose-supported topology mounts public assets.
- Exit criterion: standalone image deployment request or missing public asset incident.

### DEF-AGG1-44 — Restore temp-file cleanup on unexpected FS errors
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Original severity/confidence: Medium / High.
- Reason for deferral: rare cleanup/error-shaping hardening; no data-loss/security exploit confirmed.
- Exit criterion: restore temp leak or restore action refactor.

### DEF-AGG1-45 — Drizzle config missing-env UX
- Citation: `apps/web/drizzle.config.ts`.
- Original severity/confidence: Low / High.
- Reason for deferral: developer UX only.
- Exit criterion: DB CLI setup issue.

### DEF-AGG1-46 — Runtime single-writer lease
- Citation: `CLAUDE.md` runtime topology and process-local state modules.
- Original severity/confidence: Medium-High / High.
- Reason for deferral: `CLAUDE.md` explicitly documents single web-instance topology; a DB lease changes deployment semantics.
- Exit criterion: multi-instance deployment requirement.

### DEF-AGG1-47 — Full filesystem+DB backup bundle
- Citation: DB backup/restore action and upload path modules.
- Original severity/confidence: Medium-High / High.
- Reason for deferral: full gallery disaster-recovery bundle is a major feature; `CLAUDE.md` already documents persistent originals/derivatives.
- Exit criterion: user requests full restore-to-fresh-host flow.

### DEF-AGG1-48 — Storage abstraction drift
- Citation: `apps/web/src/lib/storage/*`.
- Original severity/confidence: Medium / High.
- Reason for deferral: architecture cleanup; current product supports local filesystem only.
- Exit criterion: storage abstraction integration or removal task.

### DEF-AGG1-49 — Build/runtime `IMAGE_BASE_URL` contract
- Citation: `apps/web/next.config.ts`, `apps/web/src/lib/image-url.ts`, Docker/compose env/build args.
- Original severity/confidence: Medium / High.
- Reason for deferral: deployment-contract feature requiring manifest/startup enforcement.
- Exit criterion: image-origin mismatch incident or deploy-hardening task.

### DEF-AGG1-50 — Topic resource crash orphan
- Citation: `apps/web/src/lib/process-topic-image.ts`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: low-severity crash-consistency cleanup.
- Exit criterion: resource orphan report.

### DEF-AGG1-51/52/53 — Documentation mismatches
- Citation: `README.md`, `apps/web/README.md`, `.env.local.example`, `apps/web/src/lib/session.ts` comment.
- Original severity/confidence: High/Medium/Low as listed in aggregate, mostly High confidence.
- Reason for deferral: documentation-only pass; scheduled code/config fixes are higher priority in this cycle.
- Exit criterion: docs cleanup pass or operator confusion report.

### DEF-AGG1-54 — Public route error shell
- Citation: `apps/web/src/app/[locale]/error.tsx:15-37`.
- Original severity/confidence: Medium / High.
- Reason for deferral: UX improvement; client error boundary cannot directly reuse server `Nav`/`Footer` without design work.
- Exit criterion: public error-page UX pass.

### DEF-AGG1-55 — Settings/SEO native validation UX
- Citation: `settings-client.tsx`, `seo-client.tsx`.
- Original severity/confidence: Medium / High.
- Reason for deferral: client form UX refactor; Plan 255 fixes server runtime validation first.
- Exit criterion: admin form UX pass.

### DEF-AGG1-57 — Bottom-sheet modal semantics
- Citation: `apps/web/src/components/info-bottom-sheet.tsx`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: interaction design change requiring mobile/AT QA.
- Exit criterion: photo detail accessibility pass.

### DEF-AGG1-58 — Window-scoped photo swipe listener
- Citation: `apps/web/src/components/photo-navigation.tsx:42-139`.
- Original severity/confidence: Low-Medium / Medium.
- Reason for deferral: gesture UX refinement.
- Exit criterion: mobile photo navigation refactor.

### DEF-AGG1-59 — Search combobox ARIA state
- Citation: `apps/web/src/components/search.tsx`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: low-severity accessibility polish.
- Exit criterion: search component accessibility pass.

### DEF-AGG1-60 — Future RTL locale direction
- Citation: `apps/web/src/app/[locale]/layout.tsx:89-95`.
- Original severity/confidence: Low / High.
- Reason for deferral: current supported locales (`en`, `ko`) are LTR; no RTL locale is shipped.
- Exit criterion: adding RTL locale.
