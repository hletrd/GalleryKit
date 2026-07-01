# Cycle 92/100 Deferred Findings

Start HEAD: `508d35572563705008693da2dbff3e5d85442cdd`.
Current local HEAD after review-lane artifact commit: `a2a9e400657e128a3b6752933483842533dd8925`.
Review aggregate: `.context/reviews/cycle-92-2026-07-01/_aggregate.md`.

## Scheduled Instead Of Deferred

- `C92-03` - Medium / High: `/api/health` lacks an explicit Node runtime pin despite optional DB probing. Scheduled in `.context/plans/cycle-92-2026-07-01-plan.md`.
- `C92-04` - Medium / High: terminal release ledger does not evidence deployment of current pushed HEAD. Scheduled in `.context/plans/cycle-92-2026-07-01-plan.md`.
- `C92-10` - Low / High: smart-collection docs mention unsupported color-pipeline criteria. Scheduled in `.context/plans/cycle-92-2026-07-01-plan.md`.
- `C92-13` - Low / High: "private share links" wording overstates unauthenticated bearer-link semantics. Scheduled in `.context/plans/cycle-92-2026-07-01-plan.md`.
- `C92-14` - Low / High: SEO "OG Locale" field copy implies broader control than the code provides. Scheduled in `.context/plans/cycle-92-2026-07-01-plan.md`.

## Deferral Policy Applied

The current run contract says: "Implement only safe, narrow fixes for confirmed findings. Prefer tests/docs/source-contracts where findings are test/ledger gaps. Do not invent broad refactors or new dependencies." Deferred items below are not downgraded; they are held because they require broad schema, architectural, E2E, product, performance, or operational work outside this cycle's allowed safe-narrow branch.

## Newly Deferred Confirmed Findings

### C92-01 / C77-ARCH-01 - Restore maintenance does not fence already-in-flight non-upload admin mutations

- Original severity/confidence: High / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/_aggregate.md:21`, `apps/web/src/app/[locale]/admin/db-actions.ts:374`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/actions/topics.ts:182`, `apps/web/src/app/actions/settings.ts:41`, `apps/web/src/app/actions/tags.ts:42`.
- Reason for deferral: Existing carry-forward correctness issue requiring a broad shared foreground admin mutation barrier across many application-table writers; not a safe narrow Cycle 92 source-contract/docs fix.
- Exit criterion: A shared restore/admin-write barrier is used by every application-table writer that can run during restore, with representative tests proving writes cannot cross the restore-maintenance boundary after an entry precheck.

### C92-02 / C88-03 - `image_embeddings` storage cannot retain multiple model versions per image

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/_aggregate.md:35`, `apps/web/src/db/schema.ts:284`, `apps/web/src/db/schema.ts:290`, `apps/web/drizzle/0012_image_embeddings.sql:5`, `apps/web/drizzle/0012_image_embeddings.sql:11`.
- Reason for deferral: Requires schema migration plus Drizzle schema, migration journal, reconcile, route, queue, and backfill updates.
- Exit criterion: Dedicated semantic-embedding schema migration stores one row per `(image_id, model_version)` with Drizzle/reconcile/query/backfill updates and tests proving inactive model rows are preserved.

### C92-05 - Freshness-ordered feed/sitemap queries lack matching `updated_at` indexes

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:90`, `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:93`, `apps/web/src/app/sitemap.ts:30`.
- Reason for deferral: Needs `EXPLAIN` on production-sized data plus migration/reconcile/index design.
- Exit criterion: Query plans are measured and either matching indexes are added with migration/reconcile/tests, or the review documents evidence that existing plans are acceptable.

### C92-06 - Topic navigation freshness uses correlated `MAX(updated_at)` without matching topic/freshness index

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:122`, `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:125`.
- Reason for deferral: Needs measurement and an index/query rewrite plan.
- Exit criterion: Topic freshness query has measured acceptable plans or a committed index/query rewrite with tests and migration coverage.

### C92-07 - Sidecar backfill/diagnostic scripts materialize all candidates/enqueue whole runs in memory

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:146`, `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:149`, `apps/web/scripts/backfill-clip-embeddings.ts:161`.
- Reason for deferral: Requires script batching/cursor refactors and focused script tests; not part of this cycle's docs/source-contract patch.
- Exit criterion: Sidecar scripts process bounded batches without whole-run candidate materialization, with tests or dry-run evidence.

### C92-08 - Transient queue/DB infrastructure failures can leave processed=false images invisible until restart/manual recovery

- Original severity/confidence: Medium / Medium-High.
- Citations: `.context/reviews/cycle-92-2026-07-01/debugger.md:1`, `.context/reviews/cycle-92-2026-07-01/_aggregate.md:104`, `apps/web/src/lib/image-queue.ts:862`.
- Reason for deferral: Needs a focused failure-mode test and recovery/visibility design rather than an isolated source edit.
- Exit criterion: Transient queue/DB failure paths are covered by tests and either auto-recover or surface actionable admin status without requiring restart guesswork.

### C92-09 - Smart-collection CRUD exists server-side but is not reachable from the visible admin surface

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/critic.md:62`, `apps/web/src/db/schema.ts:301`, `apps/web/src/lib/smart-collections.ts:1`.
- Reason for deferral: Requires product/UX surface work and likely E2E coverage.
- Exit criterion: Admin users can create/update/delete smart collections through a discoverable UI with validation and tests.

### C92-11 - Indexable public archive/collection surfaces are omitted from sitemap

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/product-marketer-reviewer.md:22`, `.context/reviews/cycle-92-2026-07-01/critic.md:62`, `apps/web/src/app/sitemap.ts:1`.
- Reason for deferral: Needs route inventory and sitemap policy tests to avoid indexing private/noindex variants.
- Exit criterion: Sitemap tests cover all intended indexable archive/collection routes and exclude noindex/private routes.

### C92-12 - Public archive/collection pages request large social cards but often provide no image

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/product-marketer-reviewer.md:36`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:43`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:32`.
- Reason for deferral: Requires representative image selection/OG-card design and metadata tests across archive/collection routes.
- Exit criterion: Public archive/collection metadata either supplies a representative image or intentionally uses summary-card metadata with tests.

### C92-15 - Lightroom/PAT upload route lacks route-level behavior tests

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:63`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:592`.
- Reason for deferral: Requires route-level multipart/test scaffolding beyond the narrow docs/copy/runtime patch.
- Exit criterion: Route-level tests cover token rejection, size/header rejection, maintenance, success, and cleanup paths.

### C92-16 - `OptimisticImage` retry/fallback state machine lacks direct behavior tests

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:86`.
- Reason for deferral: Requires component test harness work.
- Exit criterion: Direct component tests prove retry/fallback state transitions and accessible output.

### C92-17 - Admin E2E navigation does not smoke every first-class admin page

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:109`, `apps/web/src/__tests__/client-source-contracts.test.ts:58`.
- Reason for deferral: Browser-flow expansion was outside this cycle's focused implementation.
- Exit criterion: Admin E2E visits every first-class admin page and asserts stable landmarks/loading states.

### C92-18 - Admin GPS-toggle E2E mutates persistent settings without `try/finally` cleanup

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:132`.
- Reason for deferral: Requires E2E fixture cleanup redesign.
- Exit criterion: GPS-toggle E2E snapshots the original value and restores it in `finally` or equivalent cleanup on every failure path.

### C92-19 - No coverage instrumentation or threshold exists for the large unit suite

- Original severity/confidence: Low / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:154`, `apps/web/package.json:1`.
- Reason for deferral: Coverage thresholds are tooling/release-policy work and can create broad gate fallout.
- Exit criterion: Coverage instrumentation and agreed thresholds are added without weakening existing gates.

### C92-20 - Zoomed photo can be toggled by keyboard but cannot be panned by keyboard

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/designer.md:1`, `.context/reviews/cycle-92-2026-07-01/_aggregate.md:217`.
- Reason for deferral: Requires interaction design, keyboard semantics, and browser/UI tests.
- Exit criterion: Zoomed image pan controls are keyboard-accessible and covered by focused accessibility tests.

### C92-21 - Lightroom token create dialog uses toast-only validation for empty labels

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/designer.md:1`, `.context/reviews/cycle-92-2026-07-01/_aggregate.md:229`.
- Reason for deferral: Requires form UX and likely component behavior tests.
- Exit criterion: Empty label validation is visible inline, associated with the input, and announced/accessibility-tested.

### C92-22 - Load-more failure states leave live regions stale and lack persistent inline error state

- Original severity/confidence: Low / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/designer.md:1`, `.context/reviews/cycle-92-2026-07-01/_aggregate.md:241`.
- Reason for deferral: Requires public UI state/a11y design beyond this cycle.
- Exit criterion: Failed load-more/search actions update a persistent inline/live-region error with tests.

### C92-23 - Admin image management remains desktop-table-first on mobile

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/ui-ux-designer-reviewer.md:1`, `.context/reviews/cycle-92-2026-07-01/_aggregate.md:253`.
- Reason for deferral: Broad responsive admin redesign.
- Exit criterion: Admin image management has a mobile-appropriate layout verified by responsive tests or browser evidence.

### C92-24 - Mobile admin navigation is a flat wrapped 10-link header

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-92-2026-07-01/ui-ux-designer-reviewer.md:1`, `.context/reviews/cycle-92-2026-07-01/_aggregate.md:265`.
- Reason for deferral: Broad admin IA/navigation redesign.
- Exit criterion: Mobile admin navigation uses a compact accessible pattern with responsive/browser evidence.

## Likely Issues And Manual-Validation Risks

- `C92-RISK-01 / C92-ARCH-L1 / MV-C92-DOC-01` - Medium / Medium. Citations: `.context/reviews/cycle-92-2026-07-01/code-reviewer.md:93`, `.context/reviews/cycle-92-2026-07-01/architect.md:97`, `.context/reviews/cycle-92-2026-07-01/document-specialist.md:141`, `apps/web/docker-compose.yml:24`. Reason: runtime-vs-build-time `site-config.json` behavior needs standalone/Docker validation or an operator-contract decision. Exit criterion: implement a runtime loader or remove/document the runtime mount as rebuild-required.
- `C92-DOC-L01` - Low / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/document-specialist.md:119`. Reason: low-risk wording issue not needed for scheduled fixes. Exit criterion: comment/source-contract language accurately states what the test can and cannot catch.
- `C92-TE-L1` - Medium / Medium-High. Citation: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:176`. Reason: E2E expansion is outside this narrow cycle. Exit criterion: public E2E smokes map, timeline/year, smart collections, and ordinary topic pages.
- `C92-TE-L2` - Low / Medium-High. Citation: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:199`. Reason: PWA installability contract expansion is separate tooling/test work. Exit criterion: manifest/static-icon/service-worker parity is tested.
- `C92-TE-L3` - Low / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:223`. Reason: E2E cleanup hardening requires fixture design. Exit criterion: upload cleanup handles failures before row visibility.
- `PMR-92-L1` - Low / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/product-marketer-reviewer.md:79`. Reason: metadata/canonical route inventory needed. Exit criterion: timeline `?year=` canonical/JSON-LD policy is tested and documented.
- `C92-CRIT likely malformed smart-collection diagnostics` - Low / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/critic.md:62`. Reason: should be handled with smart-collection admin/editor work. Exit criterion: malformed stored queries surface actionable admin diagnostics instead of opaque 404/no diagnostics.
- `C92-CRIT likely legacy unsafe filename cleanup` - Low / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/critic.md:62`. Reason: legacy-data cleanup design needed. Exit criterion: corrupt/legacy unsafe filenames have a tested quarantine/delete/recovery path.
- `C92-PERF-L1` exact `COUNT(*) OVER()` totals - Medium / Medium-High. Citation: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:173`. Exit criterion: measured acceptable plans or cheaper pagination totals.
- `C92-PERF-L2` public smart-collection `LIKE '%term%'` scans - Medium / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:203`. Exit criterion: validated acceptable collection definitions or bounded/indexed/full-text strategy.
- `C92-PERF-L3` public keyword leading-wildcard scans - Low-Medium / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:230`. Exit criterion: measured acceptable plans or a search-index strategy.
- `C92-PERF-L4` non-sargable archive date functions - Low-Medium / Medium-High. Citation: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:254`. Exit criterion: measured acceptable plans or generated columns/index/query rewrite.
- `C92-PERF-L5` brute-force semantic vector scans - Medium when production semantic mode is enabled / High code-shape, Medium impact. Citation: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:280`. Exit criterion: benchmarked caps or ANN/indexed approach.
- `C92-PERF-L6` map returns/renders up to 10k markers without clustering - Low-Medium / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/performance-reviewer.md:308`. Exit criterion: browser/DB trace proves acceptable behavior or clustering/windowing is implemented.
- `MV-SEC-01` production cleartext listener exposure - High if internet-exposed, Low if internal / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/security-reviewer.md:98`. Exit criterion: verify production edge/nginx exposure from the deployed environment.
- `MV-SEC-02` dependency audit freshness - Medium / High. Citation: `.context/reviews/cycle-92-2026-07-01/security-reviewer.md:117`. Exit criterion: run repo-approved dependency audit in a networked validation pass.
- `MV-SEC-03` proxy trust topology - Medium / Medium. Citation: `.context/reviews/cycle-92-2026-07-01/security-reviewer.md:139`. Exit criterion: verify deployed `TRUST_PROXY` and proxy hop settings match the active topology.
- `TRC-92-MV1` semantic production activation is operator-state-dependent - Medium / High. Citation: `.context/reviews/cycle-92-2026-07-01/tracer.md:126`. Exit criterion: live env, weights, DB setting, active-model row counts, and semantic/similar routes are verified.
- `TRC-92-MV2` byte-impacting image settings require re-encode/backfill for existing derivatives - Medium / High. Citation: `.context/reviews/cycle-92-2026-07-01/tracer.md:141`. Exit criterion: after settings changes, force re-encode/backfill evidence is recorded.
- `TRC-92-MV3` DB restore is DB-only and filesystem snapshots remain external - Medium / High. Citation: `.context/reviews/cycle-92-2026-07-01/tracer.md:151`. Exit criterion: restore runbook pairs SQL with filesystem snapshot/verification.
- `TRC-92-MV5` single-process topology is a documented coordination/rate-limit assumption - Medium if scaled, Low if single instance / High. Citation: `.context/reviews/cycle-92-2026-07-01/tracer.md:167`. Exit criterion: production remains single web instance or process-local coordination moves to shared storage.
- `C92-TE-M1` browser matrix narrower than color/HDR/browser-risk surface - Medium / High. Citation: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:243`. Exit criterion: periodic WebKit/mobile/HDR/browser smoke evidence is recorded.
- `C92-TE-M2` visual checks capture screenshots without baselines - Low / High. Citation: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:267`. Exit criterion: visual checks have baselines or a documented manual comparison protocol.
- `C92-TE-M3` real CLIP semantic/production activation tests are opt-in/skipped by default - Medium / High. Citation: `.context/reviews/cycle-92-2026-07-01/test-engineer.md:289`. Exit criterion: scheduled manual/periodic real CLIP test evidence exists.

## Carry-Forward Register

Prior deferred items not reopened by Cycle 92 remain active, including `C77-ARCH-01`, `C80-06`, `C88-03`, broad browser/E2E expansion items, semantic-search operational items, settings re-encode work, and historical performance/UX items recorded in earlier deferred artifacts. All remain bound by repo policy: GPG-signed Conventional Commits with gitmoji, no force-push/no `--no-verify`, required gates, and no destructive/production actions without the explicit deployment path.
