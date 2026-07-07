# Cycle 7 Lane C Causal Tracing Review

Role: `tracer`
Scope: read-only source review, except this artifact. Source code was not modified.
Method: traced request-to-work causality across public pages/API, background queues, analytics buffers, restore/deploy boundaries, DB writes, search inference, image processing, and client-triggered flows.

## Inventory Reviewed

- Public request chains: locale public pages under `apps/web/src/app/[locale]/(public)/**`, public server actions in `apps/web/src/app/actions/public.ts`, semantic/similar search API routes, OG/feed/sitemap routes, and middleware.
- Background causality: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, backfill scripts, deploy helper scripts.
- Data dependencies: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, analytics data, schema indexes, migrations, privacy omit guards.
- Client-to-server flows: home client/load-more, lightbox navigation, map marker navigation, semantic search UI, upload/admin status components, analytics recorder call sites on photo/topic/share pages.
- Restore/cache/revalidation: restore maintenance checks, drain hooks, public `revalidate = 0` pages, React cache wrappers, deploy/runtime scripts.

## Findings

### TRACE-C7-01: Analytics view recorders only track the final insert, leaving earlier DB writes outside restore/drain causality

- Severity: Medium
- Confidence: Medium
- Status: Confirmed code path; failure requires restore/traffic timing
- Location: `apps/web/src/app/actions/public.ts:377-414`, `apps/web/src/app/actions/public.ts:428-460`, `apps/web/src/app/actions/public.ts:463-493`, `apps/web/src/app/actions/public.ts:495-528`, `apps/web/src/lib/background-db-writes.ts:42-84`

The public view recorders are documented as fire-and-forget so analytics does not block page render. The final analytics inserts are wrapped in `trackAnalyticsDbWrite()`, which bounds concurrency, skips during restore maintenance, and is drained by `drainBackgroundDbWritesForRestore()`. However, the recorder performs earlier DB work before that wrapper: `checkViewRecordRateLimit()` increments/checks `rate_limit_buckets`, then the recorder validates visible image/topic/group rows. Those DB operations are outside the tracked analytics queue.

The restore guard is checked before and after those untracked operations, but not inside the rate-limit increment itself. If restore maintenance flips on after the first guard and before `incrementRateLimit()`, a detached public view recorder can still write a rate-limit row during the restore window. The restore drain only waits for promises registered in `backgroundDbWrites`/`analyticsDbWrites`, so it cannot prove these pre-insert DB operations have quiesced.

Concrete failure scenario: a public photo page calls `void recordPhotoView(image.id)` while a restore begins. The recorder passes `isRestoreMaintenanceActive()`, awaits headers, and increments the DB rate-limit bucket. Restore maintenance starts before the final `trackAnalyticsDbWrite()` call. The final analytics insert is skipped by the later guard, but the rate-limit write has already happened outside the tracked drain. This violates the expected causal boundary that background public analytics writes are either drained or skipped during restore.

Suggested fix: wrap the entire recorder body, including rate-limit and visibility validation DB work, in a tracked restore-aware task, or add a restore-aware guard directly around/in `checkViewRecordRateLimit()` before DB increment/check/rollback. If the product intentionally allows rate-limit writes during restore, document that exception explicitly and keep only final analytics inserts in the drain contract.

### TRACE-C7-02: Map page exposes a stale-causality window after topic visibility changes because the server returns an arbitrary capped latest set

- Severity: Low
- Confidence: High
- Status: Confirmed from code
- Location: `apps/web/src/lib/data.ts:1736-1768`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-66`

The map query uses a deterministic most-recent cap of 10,000 rows and the page is uncached (`revalidate = 0`), so topic visibility changes are reflected immediately in the query predicate. The causal gap is in the public interpretation of the map: when more than 10,000 opted-in GPS photos exist, the map silently represents only the newest capped subset. There is no `truncated` flag or UI state to distinguish "all map-visible photos" from "first 10,000 after cap."

Concrete failure scenario: an operator enables map visibility for an older travel topic after the gallery already has 10,000 newer GPS photos. The topic is correctly opted in, but none of its older photos appear on `/map` because the cap is filled by newer rows. From the user's perspective, the topic-toggle action appears not to have caused the expected map result.

Suggested fix: return a `truncated` flag and expose it in the page, or change the map API to be viewport/topic filtered so newly opted-in topics can be queried causally. If keeping the global latest cap, document it in the admin topic visibility UI and public map affordance.

## Causal Paths Verified Without Findings

- Image processing: uploads enqueue work through bounded image queue paths; processing uses per-image locks, atomic derivative/base-file writes, DB status updates after successful writes, retry bookkeeping, and drain/shutdown hooks.
- Backfills: color and CLIP backfill scripts use advisory locks, keyset pagination, bounded concurrency, batched DB updates, and cleanup for deleted-mid-run rows.
- Semantic search: text embedding happens before vector scans, request aborts are checked at major boundaries, rate-limit refunds stop once expensive work begins, and production/stub model-version separation prevents mixed-model results.
- Analytics final inserts: although the pre-insert causality issue above exists, the final insert queue itself is bounded and drainable.
- Public data privacy: public-facing select helpers omit admin/private fields and map GPS exposure is constrained to map-visible topics plus runtime assertions.
- Cache/revalidation: public gallery pages intentionally use `revalidate = 0` to reflect processing and visibility changes quickly; React cache wrappers are scoped to request-level config/data reuse rather than durable stale caches.
- Deploy/runtime: deploy helper builds and restarts the container before post-deploy Docker cleanup; persistent data paths are bind-mounted and the script avoids aggressive volume pruning.

## Final Sweep

Common tracing categories checked: source-to-derivative image causality, upload-to-queue handoff, queue retry/lifecycle state, DB write ordering, restore maintenance boundaries, fire-and-forget analytics, public route rate-limit accounting, semantic search model-version lineage, cache invalidation/revalidation, map GPS visibility, and deploy/runtime cleanup ordering. No additional high-confidence causality defects were found. Residual risk remains around timing-sensitive restore races and large-production-state behavior that could not be exercised without a live database and browser trace.
