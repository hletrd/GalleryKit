# Cycle 15 Tracer Review

Role: `tracer`
Scope: whole-repository causal-flow review across auth, uploads, processing, sharing, search, admin mutations, restore, routing, queues, and state consistency.
Allowed write: this report file only.
Source edits, commits, pushes, deploys: none.
Validation evidence: static causal tracing from code, targeted symbol searches, and line-number citation sweeps. I did not run test suites because this was a read-only review task with no code changes.

## Required Instructions Read

- `AGENTS.md`
- `CLAUDE.md` architecture, security, restore/race-condition, upload/search, and testing sections
- `.context/reviews/prompts/common_review_scope.md`
- `.context/reviews/prompts/tracer.md`
- Review workflow skill instructions loaded for this turn: `review-plan-fix` and `code-review`

## Inventory

I built the inventory first with `rg --files` and targeted route/action/library listings, excluding generated output and heavy runtime data (`node_modules`, `.next`, coverage/build/dist, upload/data directories). Review-relevant files examined:

- Request auth/origin/session flow: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/proxy.ts`, `apps/web/next.config.ts`.
- Admin server actions and mutation fences: `apps/web/src/app/actions/images.ts`, `sharing.ts`, `topics.ts`, `tags.ts`, `settings.ts`, `collections.ts`, `seo.ts`, `embeddings.ts`, `admin-users.ts`, `admin-backfill.ts`, `lr-tokens.ts`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Admin APIs: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Public APIs/routes/actions: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, feed/sitemap/robots routes, and public pages under `apps/web/src/app/[locale]/(public)/`.
- Upload and processing pipeline: `apps/web/src/lib/image-queue.ts`, `process-image.ts`, `process-topic-image.ts`, `upload-paths.ts`, `serve-upload.ts`, `upload-tracker.ts`, `upload-tracker-state.ts`, `upload-processing-contract-lock.ts`, `admin-backfill-runner.ts`.
- Restore, locks, background writers, maintenance: `apps/web/src/lib/restore-maintenance.ts`, `restore-maintenance-durable.ts`, `admin-mutation-barrier.ts`, `advisory-locks.ts`, `advisory-lock-release.ts`, `background-db-writes.ts`, `maintenance-scheduler.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `backup-filename.ts`, `db-child-watchdog.ts`.
- Data/search/share consistency: `apps/web/src/lib/data.ts`, `smart-collections.ts`, `analytics.ts`, `view-retention.ts`, `clip-embeddings.ts`, `clip-model.ts`, `clip-inference.ts`, `gallery-config*`, `rate-limit.ts`.
- Schema/migration/test contracts consulted for causality: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql`, `apps/web/scripts/migrate.js`, semantic/search/restore/rate-limit/privacy tests under `apps/web/src/__tests__/`.
- Client state surfaces that affect request flow: `apps/web/src/components/load-more.tsx`, `search.tsx`, `photo-viewer.tsx`, `similar-photos.tsx`, admin upload/settings/token/db components.

Generated artifacts, locale copy, style-only components with no request/state side effects, and unrelated review/plan history were not traced beyond inventory classification. No relevant file in the specialty surface above was intentionally skipped.

## Confirmed Issues

### 1. Token-authenticated admin API requests can write `admin_tokens.last_used_at` during a DB restore before the route-level maintenance guard runs

- Code region: `apps/web/src/lib/api-auth.ts:72-89`, `apps/web/src/lib/admin-tokens.ts:170-175`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-99`, `apps/web/src/app/[locale]/admin/db-actions.ts:497-538`.
- Why this is a problem: restore deliberately enters durable maintenance, drains known foreground/background writers, then imports the dump. The restore checklist says every process-local DB writer must be drained before import (`db-actions.ts:497-506`) and drains shared group view counts, the image queue, background writes, maintenance sweeps, and admin mutation slots (`db-actions.ts:507-528`). The token auth wrapper is outside those fences. For `allowTokenScope` routes, `withAdminAuth` verifies the token and calls `markTokenUsed()` before invoking the route handler (`api-auth.ts:82-88`). The Lightroom upload handler checks `isRestoreMaintenanceActive()` only after that wrapper has already written (`lr/upload/route.ts:84-99`). `markTokenUsed()` performs `UPDATE admin_tokens SET last_used_at = NOW()` and only logs failures (`admin-tokens.ts:170-175`).
- Concrete failure scenario: a valid Lightroom client retries an upload while an admin restore is importing SQL. The wrapper accepts the PAT, updates `admin_tokens.last_used_at`, then the handler returns `503 Restore in progress`. That update is neither prevented by the durable maintenance marker nor tracked by `drainAdminMutationsForRestore()`. Depending on timing, it can contend with table import or mutate the freshly restored `admin_tokens` row after the dump has restored it, violating the restore invariant that no request writes during the import window.
- Suggested fix: add a restore-maintenance check in the token-auth branch before `verifyToken()`/`markTokenUsed()`, or at least before `markTokenUsed()`, returning a no-store `503` for token-auth admin API calls while restore is active. If last-used updates must still be attempted, wrap them in a tracked background writer and drain them before restore, but rejecting during maintenance is simpler and matches the route-level behavior.
- Confidence: High.

## Likely Issues

### 2. `deleteTopicAlias()` is the only route-segment mutation that bypasses the topic route advisory lock

- Code region: `apps/web/src/app/actions/topics.ts:70-95`, `apps/web/src/app/actions/topics.ts:157-178`, `apps/web/src/app/actions/topics.ts:273-396`, `apps/web/src/app/actions/topics.ts:463-494`, `apps/web/src/app/actions/topics.ts:577-595`, `apps/web/src/app/actions/topics.ts:611-670`.
- Why this is a problem: topic slugs and aliases share the same public route namespace. Create, update, delete topic, and create alias serialize through `withTopicRouteMutationLock()` before checking or changing route segments. `deleteTopicAlias()` has the same restore/same-origin/admin mutation guards, but deletes directly without that lock (`topics.ts:648-654`). This makes it the odd path out in the route namespace causal chain.
- Concrete failure scenario: one admin deletes alias `foo` while another concurrently creates topic slug or alias `foo`. Depending on statement ordering, the create path can fail from a just-about-to-be-deleted alias, or a delete can remove a just-created alias for the same segment after the creator saw success. The database primary/foreign keys prevent duplicate rows, but the admin-visible route state can still end in an order that does not match the serialized route-segment contract used everywhere else.
- Suggested fix: wrap the delete body in `withTopicRouteMutationLock()` as the sibling route-segment mutations do. Keep the permissive legacy-alias validation, but serialize the actual `DELETE` and audit/revalidation decision.
- Confidence: Medium.

## Risks Requiring Manual Validation

### 3. Semantic embedding mode changes are not coordinated with long-running embedding writers that overwrite the single active row per image

- Code region: `apps/web/src/db/schema.ts:292-304`, `apps/web/src/app/actions/embeddings.ts:93-185`, `apps/web/src/app/actions/settings.ts:44-84`, `apps/web/src/app/actions/settings.ts:207-234`, `apps/web/src/lib/image-queue.ts:486-523`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Why this may be a problem: `image_embeddings` stores one active row per image with primary key `image_id` and a non-key `model_version` (`schema.ts:292-304`; migration `0012_image_embeddings.sql`). The backfill action reads `semanticSearchMode` once, derives `modelVersion`, selects candidates missing that version, then upserts by `image_id`, replacing any existing row's `embedding` and `modelVersion` (`embeddings.ts:93-185`). Settings updates can change `semantic_search_mode` under the regular admin mutation slot, but they do not acquire the semantic backfill advisory lock or otherwise abort a running semantic writer (`settings.ts:44-84`, `settings.ts:207-234`). The queue writer reads mode at write time and is restore-aware (`image-queue.ts:486-523`), but sidecar/backfill runs are long enough that operator timing matters.
- Concrete failure scenario needing validation against the intended operator runbook: a production-mode backfill is running, and an admin/operator flips the site to stub or disabled before it finishes. The old writer can continue upserting production-version rows into the single-row table after the active mode changed. Search routes filter by current active `modelVersion`, so results can become empty/partial until a new backfill for the current mode rewrites rows.
- Suggested fix: either document and enforce "do not change semantic mode while backfill is running" in the operator path, or add a shared semantic-mode/backfill fence: settings changes that touch `semantic_search_mode` should fail while `LOCK_SEMANTIC_EMBEDDING_BACKFILL` is held, and backfill writers should re-check active mode before each batch/upsert and abort if it changed. Do not switch to a composite primary key unless the product wants to retain multiple embeddings per image; current tests explicitly lock one active row per `image_id`.
- Confidence: Medium. The race is visible in code, but production impact depends on whether operators can change semantic mode while the sidecar/action backfill is running.

## Flows Traced Without New Findings

- Browser uploads: entry restore/same-origin/admin checks precede parsing; quota claims settle on early exits; upload-processing contract spans config snapshot, topic validation, original save, DB insert, and enqueue; late restore checks clean originals.
- Lightroom uploads: body size/parse-slot/quota/contract flow is mostly well fenced; the confirmed gap is isolated to the token wrapper's `last_used_at` write before the handler maintenance guard.
- Image queue and processing: per-image lock, conditional pending claim, settings snapshot, derivative cleanup, missing-embedding bootstrap, restore quiesce/resume, and delete/retry interactions were traced end to end.
- Sharing/public access: share-key validation, public field selection, expiry, selected-photo view-count behavior, buffered group view flush/drain, no-prefetch shared links, and rate-limit paths were traced.
- Search: public text search uses public-safe fields; semantic/similar routes check same-origin, restore, rate limits, mode gates, model-version filtering, and public enrichment. The only search risk found is the manual-validation semantic mode/backfill coordination issue above.
- Restore: SQL upload scan, durable marker lifecycle, advisory locks, upload-processing contract, image-queue quiesce, background writer drains, maintenance sweeps, admin mutation barrier, and session revocation flush were traced. The token-auth wrapper write is outside this drain set.
- Routing: proxy/admin render headers, reserved route segments, topic slug/alias namespace checks, sitemap/robots/feed routes, and public route ordering were traced. The route-segment anomaly found is `deleteTopicAlias()`.
- Admin mutations: image/tag/topic/share/collection/settings/user/SEO/token actions generally use restore maintenance, same-origin, auth, and mutation slots before writes; rate-limit rollback patterns were inspected where present.
- Client request state: load-more, search abort/request IDs, shallow shared-photo URL updates, and similar-photo abort/open guards were inspected for stale commits and repeated server render/rate-limit effects.

## Final Sweep

Final sweep searched for token-auth writers, restore-maintenance checks, admin mutation slots, `markTokenUsed`, semantic `model_version` upserts, route-segment lock use, public mutating routes, upload quota settlement, and background writer registration. The confirmed issue and lower-confidence risks above are the review-relevant findings I found. No relevant file from the inventory was skipped.
