# Cycle 93/100 Deferred Findings

Start HEAD: `2571d8a8c27e2d2a7bc95ed5e6a72e26487093dc`.
Review aggregate: `.context/reviews/cycle-93-2026-07-01/_aggregate.md`.

## Scheduled Instead Of Deferred

- `C93-01` - Medium / High: Cycle 92 terminal ledger is stale for current deployed HEAD. Scheduled in `.context/plans/cycle-93-2026-07-01-plan.md`.
- `C93-02` - Medium / High: Load-more failure states are toast-only and leave the live region stale. Scheduled in `.context/plans/cycle-93-2026-07-01-plan.md`.
- `C93-03` - Medium / High: Lightroom token label validation is toast-only. Scheduled in `.context/plans/cycle-93-2026-07-01-plan.md`.
- `C93-04` - Medium / High: Admin GPS-toggle E2E can leave persistent settings mutated on failure. Scheduled in `.context/plans/cycle-93-2026-07-01-plan.md`.

## Deferral Policy Applied

The user requested safe, narrow fixes only. Deferred items below are not downgraded; they are held because they require broad schema, restore architecture, route-level multipart harnessing, sitemap policy, coverage policy, keyboard interaction design, or mobile admin redesign outside this cycle's narrow implementation branch.

## Newly Deferred Confirmed Findings

### C93-05 - Lightroom upload route lacks route-level behavior coverage

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/test-doc-reviewer.md`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:583`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7`.
- Reason for deferral: Requires a mocked multipart route-level harness and cleanup-path scaffolding beyond this cycle's narrow UI/a11y and ledger fixes.
- Exit criterion: Route-level tests cover token rejection, header/size rejection, restore maintenance, success response shape, and cleanup behavior.

### C93-06 - Admin E2E navigation omits first-class admin pages

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/test-doc-reviewer.md`, `apps/web/src/__tests__/client-source-contracts.test.ts:57`, `apps/web/e2e/admin.spec.ts:20`.
- Reason for deferral: Requires stable route-specific landmark assertions and opt-in browser validation across every admin page; this cycle only changed one existing E2E cleanup hazard.
- Exit criterion: Admin E2E visits every first-class admin page and asserts a stable landmark or control on each.

### C93-07 - Sitemap omits indexable archive/collection routes

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/test-doc-reviewer.md`, `apps/web/src/app/sitemap.ts:57`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:31`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:42`.
- Reason for deferral: Needs route inventory and sitemap policy tests to avoid indexing private/noindex variants incorrectly.
- Exit criterion: Sitemap tests cover intended indexable archive/collection routes and explicitly exclude share/noindex/private routes.

### C93-08 - Unit gate has no coverage instrumentation or threshold

- Original severity/confidence: Low / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/test-doc-reviewer.md`, `apps/web/package.json:13`, `apps/web/vitest.config.ts:16`.
- Reason for deferral: Coverage thresholds are release-policy/tooling work and can create broad gate fallout.
- Exit criterion: Coverage instrumentation and agreed conservative thresholds are added without weakening existing gates.

### C93-09 - Zoomed photo can be toggled by keyboard but cannot be panned by keyboard

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/ui-ux-reviewer.md`, `apps/web/src/components/image-zoom.tsx:201`, `apps/web/src/components/lightbox.tsx:340`.
- Reason for deferral: Requires keyboard interaction design so zoom panning and lightbox previous/next navigation do not conflict.
- Exit criterion: Zoomed image pan controls are keyboard-accessible, do not trigger slide navigation while active, and are covered by focused accessibility tests.

### C93-10 - Mobile admin navigation remains a flat wrapped 10-link header

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/ui-ux-reviewer.md`, `apps/web/src/components/admin-nav.tsx:15`, `apps/web/src/components/admin-nav.tsx:29`, `apps/web/src/components/admin-header.tsx:14`.
- Reason for deferral: Requires admin IA/mobile navigation redesign, responsive validation, and accessibility checks.
- Exit criterion: Mobile admin navigation uses a compact accessible pattern with `aria-current`, 44 px targets, and responsive/browser evidence.

### C93-11 - Admin image management is desktop-table-first on mobile

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/ui-ux-reviewer.md`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:142`, `apps/web/src/components/image-manager.tsx:424`.
- Reason for deferral: Broad responsive admin table/card redesign outside this cycle's narrow fix scope.
- Exit criterion: Admin image management has a mobile-appropriate layout verified by responsive tests or browser evidence.

### C93-12 / C88-03 - `image_embeddings` storage cannot retain multiple model versions per image

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/data-reviewer.md`, `apps/web/src/db/schema.ts:284`, `apps/web/drizzle/0012_image_embeddings.sql:10`, `apps/web/src/lib/image-queue.ts:379`, `apps/web/scripts/backfill-clip-embeddings.ts:212`.
- Reason for deferral: Requires schema migration plus Drizzle schema, migration journal, reconcile, route, queue, backfill, and tests.
- Exit criterion: Dedicated semantic-embedding schema migration stores one row per `(image_id, model_version)` with Drizzle/reconcile/query/backfill updates and tests proving inactive model rows are preserved.

### C93-13 / C77-ARCH-01 - Restore maintenance does not fence already-in-flight non-upload admin mutations

- Original severity/confidence: High / High.
- Citations: `.context/reviews/cycle-93-2026-07-01/data-reviewer.md`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/actions/settings.ts:43`, `apps/web/src/app/actions/topics.ts:184`, `apps/web/src/app/actions/tags.ts:44`.
- Reason for deferral: Existing carry-forward correctness issue requiring a broad shared foreground admin mutation barrier across many application-table writers; not a safe narrow Cycle 93 patch.
- Exit criterion: A shared restore/admin-write barrier is used by every application-table writer that can run during restore, with representative tests proving writes cannot cross the restore-maintenance boundary after an entry precheck.

## Carry-Forward Register

Prior deferred items not reopened by Cycle 93 remain active, including broad restore/schema/performance/E2E/UI/operational findings recorded in earlier deferred artifacts. All remain bound by repo policy: GPG-signed Conventional Commits with gitmoji, no force-push/no `--no-verify`, required gates, and no destructive/production actions outside the approved deployment path.
