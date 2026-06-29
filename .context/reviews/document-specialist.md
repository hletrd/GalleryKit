# Cycle 15 Document-Specialist Review

Date: 2026-06-30
Reviewed HEAD: `d401dd68`
Scope: documentation/code mismatch review for `/Users/hletrd/flash-shared/gallery`.

## Methodology and Inventory

Read first, as required: `AGENTS.md`, then `CLAUDE.md`.

Inventory built before inspection:

- Canonical docs and app docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Env/config examples: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`.
- Deploy/runbook surfaces: root `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`.
- Superpowers docs: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Plan/review contract surfaces: `.context/plans/README.md`, current cycle plan/deferred files, previous document-specialist reports, and review indexes where present.
- Tests-as-contract and lint gates: auth/action/rate-limit scanners, privacy fixtures, upload-limit tests, nginx config tests, semantic-search tests, service-worker contract tests, touch-target audit.
- Source comments carrying operational or product/security/perf contracts: display capability, histogram color handling, color-pipeline backfill, CLIP model/download/backfill, upload paths, image processing, storage, DB restore, rate limiting, CSP, public routes, and admin actions.

Excluded from content review: `node_modules`, `.git`, build outputs, runtime data, uploads/resources, generated test output, and binary screenshots/media. Existing unrelated modified review files in `.context/reviews/` were ignored; this pass reviewed current HEAD behavior and wrote only this report.

## Confirmed Issues

### DOC15-01 - Display-detection comments still claim canvas-P3 participates in `useDisplayCapability`

Severity: Low
Confidence: High
Status: Confirmed
Category: stale source comment / product-behavior drift

Evidence:

- `apps/web/src/components/wide-gamut-hint.tsx:68-73` says `useDisplayCapability` adds `screen.colorGamut` "plus a canvas-P3 probe" to avoid falsely treating Firefox 124+ on macOS internal P3 as sRGB.
- `apps/web/src/components/photo-viewer.tsx:353-356` says Firefox resolves P3 through "the canvas-P3 probe in useDisplayCapability".
- `apps/web/src/components/histogram.tsx:497-504` says histogram uses `useDisplayCapability` and that the hook adds "`screen.colorGamut` + MQ + canvas-P3 layered detection".
- `apps/web/src/__tests__/use-display-capability.test.ts:4-6`, `:73`, and `:188-190` still describe the test harness as mocking or requiring a canvas-P3 probe inside display detection.
- The actual implementation does not use canvas or `document` at all. `apps/web/src/lib/use-display-capability.ts:4-11` documents the current order as `screen.colorGamut` -> media queries -> conservative Firefox/sRGB fallback, and `apps/web/src/lib/use-display-capability.ts:49-75` implements only `window.screen.colorGamut`, `(color-gamut: rec2020/p3)`, and `(dynamic-range: high)`.
- The canonical runbook agrees with the implementation: `CLAUDE.md:365-368` says the canvas-P3 probe is not used for display detection because it tests API capability, not display gamut, and Firefox falls back to conservative `srgb`.

Concrete failure scenario:

A future maintainer follows the component comments instead of the hook and reintroduces canvas-P3 as a display-gamut signal, or preserves tests that appear to cover a nonexistent probe. On sRGB displays where the browser can still create a P3 canvas, users could be treated as P3-capable: the wide-gamut warning can be suppressed and histogram/image-path choices can imply more accurate color display than the screen supports.

Concrete fix:

Update the stale comments in `wide-gamut-hint.tsx`, `photo-viewer.tsx`, `histogram.tsx`, and `use-display-capability.test.ts` to say `useDisplayCapability` is `screen.colorGamut` -> color-gamut media query -> conservative `srgb`. Keep canvas-P3 language only where it refers to canvas rendering capability, such as histogram's separate `getSupportsCanvasP3()` path.

### DOC15-02 - Plan index marks implemented or complete implementation plans as active TODO

Severity: Low
Confidence: High
Status: Confirmed
Category: plan/review contract drift

Evidence:

- `.context/plans/README.md:7` lists "Cycle 12/100 Implementation Plan - TODO" under Active Plans.
- `.context/plans/cycle-12-2026-06-29-plan.md:5` says `Status: IMPLEMENTED`, and `.context/plans/cycle-12-2026-06-29-plan.md:13-31` marks every scheduled Cycle 12 fix `DONE`.
- `.context/plans/README.md:15` lists "Cycle 3/100 Implementation Plan - TODO" under Active Plans.
- `.context/plans/cycle-3-2026-06-29-plan.md:5` says `Status: complete; deployment pending`, and `.context/plans/cycle-3-2026-06-29-plan.md:13-83` shows the inspected scheduled items as `Progress: DONE`.

Concrete failure scenario:

Cycle prompts and future agents use `.context/plans/README.md` as the active-work index and reopen or duplicate already implemented work. Cycle 3 is especially misleading because the child plan says only deployment is pending, while the index presents the implementation plan as unstarted TODO.

Concrete fix:

Update `.context/plans/README.md` so implementation-plan entries mirror their child plan status: move Cycle 12 implementation out of active TODO, and mark Cycle 3 implementation as complete/deployment-pending instead of TODO. Keep separate deferred ledgers active only when their own deferred files are still unresolved. A lightweight consistency check could compare index labels with each referenced plan's top-level `Status:`.

### DOC15-03 - Sidecar color-pipeline backfill docs say `BACKFILL_CONCURRENCY` is uncapped, but the script clamps it to 8

Severity: Low
Confidence: High
Status: Confirmed
Category: operational documentation drift

Evidence:

- `CLAUDE.md:108` describes `BACKFILL_CONCURRENCY` as "Sidecar `--rm` backfill concurrency (uncapped; separate MySQL pool)".
- `CLAUDE.md:333` repeats that sidecar `BACKFILL_CONCURRENCY` is "uncapped" because it runs in a separate `--rm` container with its own MySQL pool.
- `apps/web/scripts/backfill-color-pipeline.ts:27-28` says concurrency is capped at `BACKFILL_CONCURRENCY` default 2, max 8, to avoid starving the live web process.
- `apps/web/scripts/backfill-color-pipeline.ts:367-370` passes `{ fallback: 2, max: 8 }` to `parseBoundedPositiveInteger`.
- `apps/web/src/lib/env.ts:18-23` floors the value and returns `Math.min(value, max)`, so values above 8 are silently clamped to 8.

Concrete failure scenario:

An operator sets `BACKFILL_CONCURRENCY=16` or `32` from the runbook expecting an uncapped sidecar and then gets a slower maintenance window because the script clamps to 8. Conversely, a future maintainer may remove the script cap to satisfy the docs, increasing database contention during long re-encode runs.

Concrete fix:

Update `CLAUDE.md` to distinguish "not capped by the live web pool-budget formula" from "uncapped". Document the actual sidecar behavior as default 2, max 8, separate MySQL pool, and still concurrency-limited to protect live traffic. If uncapped sidecars are genuinely desired, change the script and add an explicit operational warning and test coverage for that decision.

## Verified Non-Findings

- Root/app README command tables and package scripts match the current root and `apps/web` `package.json` scripts.
- Remote deploy docs match `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/deploy.sh`, `docker-compose.yml`, and the documented post-deploy Docker prune sequence. The checked script prunes containers, images, builders, and volumes without `volume prune -a`, after `up -d`.
- Docker bind mounts and deploy docs still match persistence boundaries: `./data`, `./public/uploads`, `./public/resources`, read-only `./src/site-config.json`, and host MySQL.
- Upload-format docs and picker/runtime behavior match for JPEG, PNG, WebP, AVIF, TIFF, and GIF; unsupported RAW-like formats are not advertised by the current picker.
- Semantic-search docs match route gates for same-origin checks, rate limiting after cheap rejects, threshold defaults, and CLIP activation path.
- PWA/offline docs match the service-worker contract at the reviewed level: visited image caching, network-first HTML, offline fallback, and explicit privacy-sensitive bypasses.
- `docs/superpowers` CLIP spec/plan were inspected as shipped historical design material; no additional current-code mismatch survived the "real mismatch only" threshold beyond issues already recorded in prior reviews.

## Final Missed-Issues Sweep

Final sweep rechecked canonical docs, app README, env examples, deploy/runbook files, migration/schema rules, package scripts, docs/superpowers, `.context` plan/review indexes, and source comments for `MUST`, `never`, `production`, `operator`, `security`, `rate-limit`, `migration`, `deploy`, `prune`, `body cap`, `semantic`, `clip`, `backfill`, `color-gamut`, `canvas-P3`, `privacy`, and related terms.

No additional confirmed mismatch survived the evidence threshold. No source code was modified and no commit was made.
