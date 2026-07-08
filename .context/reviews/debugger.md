# Cycle 35 Debugger Review

Role lane: debugger subagent
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `7993fa467f8a71814f878aa59bcd80174daab1ed`
Status: review-only. Product code was not edited.

## Inventory / Scope Reviewed

Read before review: `AGENTS.md`, `CLAUDE.md`, and the review workflow instructions.

Inventory built first with `rg --files` and targeted source searches for async boundaries, advisory locks, restore gates, server actions, route handlers, queue handoff, raw SQL, delete/update paths, and error handling. High-risk files reviewed in detail:

- Upload, delete, and file durability: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/lib/process-topic-image.ts`.
- Queue, backfill, and async image/embedding work: `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, related tests around similar/semantic behavior.
- Restore, maintenance, and mutation admission: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/api-auth.ts`.
- Topic/tag/share/settings/public mutation paths: `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/admin-users.ts`.
- Data/privacy/rate-limit surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, map/topic tests, and route lint scripts.
- Migration/schema-sensitive areas were inventoried through `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, and schema-related tests, with deeper review focused on code paths touched by current mutation/data risks.

Validation run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.

I did not run the full lint/typecheck/build/test suite for this review-only pass. Existing modified peer reports in `.context/reviews/` were not touched.

## Findings

### DBG-C35-01 - Topic map visibility toggles can be lost during a concurrent slug rename

- Severity: Medium
- Confidence: High
- Classification: Likely data-consistency bug, confirmed by static interleaving.
- File / code region:
  - `apps/web/src/app/actions/topics.ts:70-103` defines `withTopicRouteMutationLock(...)`.
  - `apps/web/src/app/actions/topics.ts:282-372` uses that lock for `updateTopic(...)`; the slug-rename branch reads the old row, inserts the new slug with `map_visible: transactionTopic.map_visible`, rewrites children, then deletes the old slug.
  - `apps/web/src/app/actions/topics.ts:690-720` implements `setTopicMapVisible(...)` as a direct `UPDATE topics SET map_visible = ? WHERE slug = ?` without the same route/topic serialization lock.
  - `apps/web/src/__tests__/topics-actions.test.ts:813-819` covers malformed map-visible input, but I did not find coverage for `setTopicMapVisible(...)` serializing with slug rename.

Root cause:

`updateTopic(...)` treats a slug change as delete-and-recreate rather than an in-place slug update. It correctly carries `map_visible` from the old row into the inserted replacement row, but that carry-forward value is read inside the rename transaction before the old row is deleted. `setTopicMapVisible(...)` mutates the same row outside `withTopicRouteMutationLock(...)`, so it can update the old slug while the rename transaction is in flight.

Concrete failure scenario:

1. Topic `travel` currently has `map_visible = false`.
2. Admin A starts renaming `travel` to `trips`. `updateTopic(...)` enters the route lock and reads `transactionTopic.map_visible = false` at `topics.ts:299-306`.
3. Admin B toggles map visibility for `travel` to `true`. `setTopicMapVisible(...)` passes restore/origin/admin checks and updates the old row at `topics.ts:709-712` because it does not wait on the route lock.
4. Admin A's rename inserts `trips` with the stale carried value `false` at `topics.ts:317-323`, then deletes `travel` at `topics.ts:370-371`.
5. Admin B receives success and an audit event is logged at `topics.ts:716-717`, but the visible state was deleted with the old row and `/map` remains hidden for the renamed topic until toggled again.

Suggested fix:

Serialize `setTopicMapVisible(...)` with the same route/topic mutation lock used by create, rename, delete, and alias changes. Keep the restore fence and same-origin checks as the outer admission gate, then perform the clean-slug validation, update, audit, and revalidation inside `withTopicRouteMutationLock(...)`. Add a regression test that proves `setTopicMapVisible(...)` calls the lock helper or an integration-style interleaving test around rename plus map-visible update.

## Final Sweep / Non-Findings

- Upload and Lightroom ingestion paths settle their upload-tracker claims on the main observed failure paths, use restore admission, and route post-commit processing through queue self-healing.
- Semantic and similar search route handlers have same-origin checks, restore-maintenance checks, body-size/content-type guards where relevant, rate-limit pre-increment, bounded scanning, and missing/corrupt embedding handling.
- Restore import/export code keeps dangerous failures in maintenance, drains admitted mutations, validates dump trailer/SQL shape, and releases temporary files in finalizers.
- Pending file deletion paths insert durable cleanup work before DB row deletion and use strict path resolution helpers.
- Privacy-sensitive admin-only fields remain covered by the symmetric privacy guard test pattern inspected in `data.ts` and related tests.
- Route/auth lint gates passed for admin API wrappers, server-action same-origin admission, and public route rate limits.

Skipped/limited areas: no top-level source area was intentionally skipped during inventory, but the deepest line-by-line review focused on mutation, async, data, restore, upload, and route-handler surfaces. Static assets, generated files, and presentational React/CSS components were not exhaustively line-reviewed beyond their relevance to the failure modes above.
