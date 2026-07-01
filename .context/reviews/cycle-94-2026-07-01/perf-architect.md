# Cycle 94 Performance / Architecture Review

Reviewer: performance / architecture
Repo: `/tmp/gallery-recovery-check`
HEAD reviewed: `33eca7b5e4102bd5097777dbb926ee2cb94c6d71`
Mode: read-only source review; only this artifact was written in this repo.

## Findings

### C94-PERF-ARCH-01 - Restore maintenance is still a start-of-action check for non-upload admin mutations

Severity: High
Confidence: High
Status: Confirmed carry-forward current at HEAD

Evidence:
- Restore takes the DB restore advisory lock and upload-processing contract lock, then begins durable maintenance and drains upload/background work before importing the dump: `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/[locale]/admin/db-actions.ts:494`.
- Many non-upload mutating actions only check `getRestoreMaintenanceMessage(...)` once at entry and then perform DB writes without holding a restore-wide writer fence. Examples: settings update checks at `apps/web/src/app/actions/settings.ts:43` then writes in a transaction at `apps/web/src/app/actions/settings.ts:164`; tag update checks at `apps/web/src/app/actions/tags.ts:44` then writes at `apps/web/src/app/actions/tags.ts:83`; topic create checks at `apps/web/src/app/actions/topics.ts:87` then inserts at `apps/web/src/app/actions/topics.ts:149`; share creation checks at `apps/web/src/app/actions/sharing.ts:93` then updates `images.share_key` at `apps/web/src/app/actions/sharing.ts:145`.
- The in-process restore marker is just a boolean read by `getRestoreMaintenanceMessage`: `apps/web/src/lib/restore-maintenance.ts:21` and `apps/web/src/lib/restore-maintenance.ts:29`.

Failure scenario:
An admin action starts before restore maintenance is marked active, passes its entry check, then waits on auth, validation, image/topic processing, or DB work. A restore starts, sets the marker, drains known background/upload work, and imports a SQL dump. The already-admitted admin action then resumes and writes settings/tags/topics/share rows into the restored database, producing state not present in the backup and potentially invalidating the operator's expectation that restore is an exclusive maintenance window.

Suggested fix:
Add a shared restore mutation fence for every mutating admin action, not just uploads. The simplest local shape is a helper that acquires the existing `LOCK_DB_RESTORE` advisory lock for the whole mutation, rechecks durable maintenance after acquiring it, runs the mutation, then releases. Restore already holds that lock across the restore flow, so this prevents restore from starting while a writer is in flight and prevents new writers after restore begins. Keep upload's existing upload-processing contract lock as its narrower processing/settings fence.

### C94-PERF-ARCH-02 - `image_embeddings` cannot stage or retain multiple model versions per image

Severity: Medium
Confidence: High
Status: Confirmed carry-forward current at HEAD

Evidence:
- The schema and migration make `image_id` the primary key: `apps/web/src/db/schema.ts:284` and `apps/web/drizzle/0012_image_embeddings.sql:10`.
- The write path uses `onDuplicateKeyUpdate`, so writing a stub or production embedding overwrites the one row for that image: `apps/web/src/lib/image-queue.ts:379` and `apps/web/src/lib/image-queue.ts:385`.
- Both public semantic routes filter by `model_version`: semantic search scans active-model rows at `apps/web/src/app/api/search/semantic/route.ts:274`, and similar-photo first requires the target's production row at `apps/web/src/app/api/search/similar/[id]/route.ts:139`.

Failure scenario:
During a model-version change, stub-to-production switch, or production model rollback, the table cannot hold old and new vectors for the same image at once. Re-embedding overwrites the prior model row image-by-image. Because read routes filter on one active `model_version`, coverage is partial during migration: newly written images appear for the new model while not-yet-rewritten images disappear from that mode. Rolling back to the previous model requires another full backfill because the old vectors were overwritten.

Suggested fix:
Migrate `image_embeddings` to a composite key such as `(image_id, model_version)` and keep the scan index `(model_version, updated_at)`. Update writers to upsert by `(image_id, model_version)` instead of replacing all versions for an image. Then model upgrades can be staged, verified for row coverage, and flipped atomically by config without losing rollback data.

### C94-PERF-ARCH-03 - First-page public listing forces an exact count through the grouped tag-join query

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `getImagesLitePage` selects `COUNT(*) OVER()` in the same query that left-joins `image_tags` and `tags`, groups by image, orders the listing, and then applies `LIMIT pageSize + 1`: `apps/web/src/lib/data.ts:911`, `apps/web/src/lib/data.ts:914`, `apps/web/src/lib/data.ts:916`, `apps/web/src/lib/data.ts:919`, `apps/web/src/lib/data.ts:926`.
- Smart collections use the same exact-count-over-grouped-listing shape on initial page load: `apps/web/src/lib/data.ts:1495`, `apps/web/src/lib/data.ts:1498`, `apps/web/src/lib/data.ts:1500`, `apps/web/src/lib/data.ts:1503`, `apps/web/src/lib/data.ts:1507`.
- These paths are used by dynamic public pages on every first render: home at `apps/web/src/app/[locale]/(public)/page.tsx:177`, topic pages at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:187`, and smart collections at `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:111`.
- The exact total is only displayed as count copy in the client header: `apps/web/src/components/home-client.tsx:268`.

Failure scenario:
On a larger gallery with many tags, every uncached first-page visit pays for a grouped listing plus exact full result count before returning the first 30 photos. The `LIMIT 31` does not let MySQL stop after 31 logical images because the window count must be computed over the grouped result set. A crawler or burst of visitors to home/topic/collection pages can turn a cheap first-page fetch into repeated DB CPU/filesort pressure even though the UI only needs exact total for display text and `hasMore` can be determined by N+1 rows.

Suggested fix:
Remove `COUNT(*) OVER()` from the listing query and keep it as a lean N+1 page query. For the header count, either use loaded count/progressive copy, or run a separate lightweight count only when exact totals are required. For unfiltered/topic pages that count can use `images` indexes directly; for tag and smart-collection pages it should avoid `GROUP_CONCAT` and listing joins. Update `data-tag-names-sql.test.ts`, which currently asserts that the window count remains present.

## Non-findings / checked lanes

- Image queue concurrency remains DB-pool-clamped and Sharp fan-out is bounded by `QUEUE_CONCURRENCY` plus global `SHARP_CONCURRENCY`; no new queue concurrency defect was confirmed.
- Derivative serving keeps the documented one-hour `must-revalidate` policy across Next config, nginx, and route-handler fallback.
- Current HEAD's direct source delta is mostly cycle-93 review/a11y work plus the load-more live-region change; no cycle-94-specific source edit introduced a new performance hot path.
