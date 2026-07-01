# Cycle 95/100 Deferred Findings

Start HEAD: `750729ada2403c0c01267670b9552a05e0ead217`.
Review aggregate: `.context/reviews/cycle-95-2026-07-01/_aggregate.md`.

## Scheduled Instead Of Deferred

- `C95-01` - Medium / High: Cycle 94 release ledger remains stale after signed, pushed, deployed `750729ada2403c0c01267670b9552a05e0ead217`. Scheduled in `.context/plans/cycle-95-2026-07-01-plan.md`.

## Deferral Policy Applied

The user requested safe, narrow fixes only. Cycle 95 did not discover new source defects. Carry-forward findings below retain their original severity/confidence and remain deferred because they require route-level multipart test harnesses, broader authenticated E2E assertions, keyboard interaction design, mobile admin redesign, restore/write-fencing architecture, schema migration, or listing-query product policy changes outside this cycle's narrow docs/artifact branch.

## Newly Deferred Confirmed Findings

None.

## Carry-Forward Register

### C94-04 / C93-05 - Lightroom upload API still lacks route-level behavior coverage

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/test-engineer.md`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:94`, `apps/web/src/app/api/admin/lr/upload/route.ts:117`, `apps/web/src/app/api/admin/lr/upload/route.ts:123`, `apps/web/src/app/api/admin/lr/upload/route.ts:583`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7`.
- Reason for deferral: Requires a mocked multipart route-level harness and cleanup-path scaffolding outside this cycle's narrow release-ledger fix.
- Exit criterion: Route-level tests cover token/scope rejection, restore-maintenance `503`, missing/invalid `Content-Length`, over-limit rejection, parsed-file too-large rejection, success response shape, and cleanup on post-save failure.

### C94-05 / C93-06 - Admin Playwright navigation still omits first-class admin pages

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/test-engineer.md`, `apps/web/src/components/admin-nav.tsx:16`, `apps/web/src/components/admin-nav.tsx:25`, `apps/web/e2e/admin.spec.ts:20`, `apps/web/src/__tests__/client-source-contracts.test.ts:57`.
- Reason for deferral: Requires stable route-specific authenticated Playwright assertions across every admin destination; Cycle 95 does not change app UI/source behavior.
- Exit criterion: Admin E2E visits every first-class `AdminNav` destination and asserts one stable landmark or control per page under the existing E2E opt-in gate.

### C94-06 / C93-09 - Zoomed photos are keyboard-toggleable but not keyboard-pannable

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/designer.md`, `apps/web/src/components/image-zoom.tsx:201`, `apps/web/src/components/image-zoom.tsx:328`, `apps/web/src/components/image-zoom.tsx:365`, `apps/web/src/components/lightbox.tsx:340`.
- Reason for deferral: Requires keyboard pan interaction design so zoom panning and lightbox previous/next navigation do not conflict.
- Exit criterion: Zoomed image pan controls are keyboard-accessible, do not trigger slide navigation while active, expose appropriate instructions, and are covered by focused accessibility tests.

### C94-07 / C93-10 - Mobile admin navigation is still a ten-link wrapped header

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/designer.md`, `apps/web/src/components/admin-nav.tsx:15`, `apps/web/src/components/admin-nav.tsx:29`, `apps/web/src/components/admin-header.tsx:14`.
- Reason for deferral: Requires admin IA/mobile navigation redesign, responsive validation, and accessibility checks.
- Exit criterion: Mobile admin navigation uses a compact accessible pattern with `aria-current`, focus restoration, 44 px targets, and responsive/browser evidence.

### C94-08 / C93-11 - Admin image management remains desktop-table-first on mobile

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/designer.md`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135`, `apps/web/src/components/image-manager.tsx:424`, `apps/web/src/components/image-manager.tsx:441`, `apps/web/src/components/image-manager.tsx:551`.
- Reason for deferral: Broad responsive admin table/card redesign outside this cycle's narrow release-ledger fix scope.
- Exit criterion: Admin image management has a mobile-appropriate layout verified by responsive tests or browser evidence while preserving existing labels and 44 px controls.

### C94-09 / C77-ARCH-01 - Restore maintenance still does not fence already-in-flight non-upload admin mutations

- Original severity/confidence: High / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/perf-architect.md`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/actions/settings.ts:43`, `apps/web/src/app/actions/settings.ts:164`, `apps/web/src/app/actions/tags.ts:44`, `apps/web/src/app/actions/topics.ts:87`, `apps/web/src/app/actions/sharing.ts:93`.
- Reason for deferral: Existing carry-forward correctness issue requiring a broad shared foreground admin mutation barrier across many application-table writers; not a safe narrow Cycle 95 patch.
- Exit criterion: A shared restore/admin-write barrier is used by every application-table writer that can run during restore, with representative tests proving writes cannot cross the restore-maintenance boundary after an entry precheck.

### C94-10 / C88-03 - `image_embeddings` cannot stage or retain multiple model versions per image

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/perf-architect.md`, `apps/web/src/db/schema.ts:284`, `apps/web/drizzle/0012_image_embeddings.sql:10`, `apps/web/src/lib/image-queue.ts:379`, `apps/web/src/app/api/search/semantic/route.ts:274`, `apps/web/src/app/api/search/similar/[id]/route.ts:139`.
- Reason for deferral: Requires schema migration plus Drizzle schema, migration journal, reconcile, route, queue, backfill, and tests.
- Exit criterion: Dedicated semantic-embedding schema migration stores one row per `(image_id, model_version)` with Drizzle/reconcile/query/backfill updates and tests proving inactive model rows are preserved.

### C94-11 - First-page public listing forces an exact `COUNT(*) OVER()` through grouped tag-join queries

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-94-2026-07-01/perf-architect.md`, `apps/web/src/lib/data.ts:911`, `apps/web/src/lib/data.ts:926`, `apps/web/src/lib/data.ts:1495`, `apps/web/src/lib/data.ts:1507`, `apps/web/src/components/home-client.tsx:268`.
- Reason for deferral: Requires public listing-count product policy, query-shape changes across homepage/topic/smart collection paths, and updates to source-contract tests that currently assert the window-count query.
- Exit criterion: First-page public listing queries avoid `COUNT(*) OVER()` in grouped listing paths while preserving required count display behavior or intentionally changing it with tests.
