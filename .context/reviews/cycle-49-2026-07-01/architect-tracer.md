# Cycle 49 Architect + Tracer Review

## Inventory: Relevant Files Examined

- `AGENTS.md`; `CLAUDE.md`; `.context/plans/README.md`; `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-48-2026-07-01/_aggregate.md`; `.context/plans/cycle-48-2026-07-01-plan.md`; `.context/plans/cycle-48-2026-07-01-deferred.md`
- `apps/web/src/lib/image-queue.ts:76`, `apps/web/src/lib/image-queue.ts:513`, `apps/web/src/lib/image-queue.ts:901`
- `apps/web/src/app/actions/images.ts:128`, `apps/web/src/app/actions/images.ts:648`
- `apps/web/src/lib/admin-backfill-runner.ts:316`, `apps/web/src/lib/admin-backfill-runner.ts:647`
- `apps/web/scripts/backfill-color-pipeline.ts:304`
- `apps/web/src/app/[locale]/admin/db-actions.ts:365`
- `apps/web/src/lib/restore-maintenance.ts`; `apps/web/src/lib/restore-maintenance-durable.ts`; `apps/web/src/lib/queue-shutdown.ts`; `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/db/schema.ts:4`, `apps/web/src/db/schema.ts:14`, `apps/web/src/db/schema.ts:224`
- `apps/web/scripts/migrate.js:317`, `apps/web/scripts/migrate.js:803`; `apps/web/drizzle/meta/_journal.json`; `apps/web/drizzle/0028_rate_limit_bucket_start_idx.sql`
- `apps/web/src/app/actions/settings.ts:40`; `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts:84`; `apps/web/src/app/api/search/semantic/route.ts:107`; `apps/web/src/app/api/search/similar/[id]/route.ts:68`
- `apps/web/src/lib/serve-upload.ts:49`; `apps/web/next.config.ts:68`; `apps/web/deploy.sh:56`; `apps/web/docker-compose.yml:17`
- `apps/web/src/app/actions/topics.ts:38`, `apps/web/src/app/actions/topics.ts:62`, `apps/web/src/app/actions/topics.ts:409`, `apps/web/src/app/actions/topics.ts:477`
- `apps/web/src/app/actions/collections.ts:15`; `apps/web/src/lib/smart-collections.ts:316`, `apps/web/src/lib/smart-collections.ts:522`
- `apps/web/src/lib/advisory-locks.ts:24`; `apps/web/src/__tests__/topics-actions.test.ts:539`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:127`

## Findings

### MEDIUM: `deleteTopic` bypasses the route-segment advisory lock, so successful alias creates can be cascade-deleted concurrently

- **Severity:** Medium
- **Confidence:** High
- **Files:** `apps/web/src/app/actions/topics.ts:62`, `apps/web/src/app/actions/topics.ts:409`, `apps/web/src/app/actions/topics.ts:477`, `apps/web/src/db/schema.ts:14`, `apps/web/src/lib/advisory-locks.ts:24`, `apps/web/src/__tests__/topics-actions.test.ts:539`

The shared `LOCK_TOPIC_ROUTE_SEGMENTS` contract says it serializes topic slug/alias mutations (`apps/web/src/lib/advisory-locks.ts:24`), and `createTopic`, `updateTopic`, and `createTopicAlias` all use `withTopicRouteMutationLock` before checking or changing route segments (`apps/web/src/app/actions/topics.ts:62`, `apps/web/src/app/actions/topics.ts:140`, `apps/web/src/app/actions/topics.ts:250`, `apps/web/src/app/actions/topics.ts:511`). `deleteTopic` does not acquire that lock around its read/delete transaction (`apps/web/src/app/actions/topics.ts:409`-`442`), even though `topic_aliases.topic_slug` cascades on topic deletion (`apps/web/src/db/schema.ts:14`-`17`). Existing tests only pin that alias creation takes the lock (`apps/web/src/__tests__/topics-actions.test.ts:539`-`550`); they do not assert deletion participates in the same serialization.

Failure scenario: admin A clicks delete for topic `travel` in the categories UI (`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:127`-`135`). At the same time, admin B adds alias `night` for `travel`. B's `createTopicAlias` can acquire the route lock, observe the alias route is free, insert the alias, log success, and return success (`apps/web/src/app/actions/topics.ts:511`-`527`). A's unlocked `deleteTopic` transaction can then delete the `travel` row and MySQL cascades the freshly inserted alias. The operator sees a successful alias add/audit entry, but the alias never persists because it was removed by a concurrent topic delete.

Suggested fix: wrap the whole `deleteTopic` transaction in `withTopicRouteMutationLock`, including the no-images check and `tx.delete(topics)`, so deletes serialize with alias creation and slug create/rename checks. Add a regression test in `topics-actions.test.ts` that imports `deleteTopic` and asserts the `LOCK_TOPIC_ROUTE_SEGMENTS` GET_LOCK/RELEASE_LOCK path surrounds the delete transaction, mirroring the alias-creation lock test.

## Deferred Items Not Re-raised

I did not re-raise the carried-forward deferred items from Cycle 48 because this pass found no new evidence changing their severity or schedule: production CLIP web-process catch-up locking/caps, JS script semantic checking, feed/sitemap updated-time indexes, backfill pipeline-version indexes, broad imported-helper side-effect classification, and sidecar backfill keyset pagination.

## Verification Notes

This was a read-only architecture/tracing review of source, schema, migration, queue, restore, cache, and deploy contracts. I did not edit application source or run the full quality gates.
