# Debugger Review — Cycle 7 (R2)

**Date:** 2026-04-19
**Reviewer:** debugger
**Scope:** Full codebase

## Findings

### DBG-7R2-01: `flushGroupViewCounts` re-buffer loop can push buffer past `MAX_VIEW_COUNT_BUFFER_SIZE` [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/lib/data.ts` lines 53-58
- **Description:** On DB update failure, the catch handler re-buffers with `for (let i = 0; i < count; i++) bufferGroupViewCount(groupId)`. Each call to `bufferGroupViewCount` checks the size cap and may drop the increment. However, between the cap check and the `viewCountBuffer.set()`, there is no atomicity guarantee. If multiple flushes fail concurrently (e.g., during a DB outage), multiple re-buffer loops can execute simultaneously, each pushing entries into the buffer. The cap is enforced per-call, but the buffer can grow by `count` entries from a single loop iteration before the cap catches up on the next call. This is a latent bug that only manifests under sustained DB outages with high traffic.
- **Fix:** Replace the per-increment loop with a single atomic `viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count)` after the cap check, or add the failed count as a single entry rather than N individual increments.
- **Cross-agent:** Also flagged by code-reviewer (CR-7R2-01).

### DBG-7R2-02: `uploadImages` tag batch slug-only lookup inconsistent with name-first pattern [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 188-190
- **Description:** During image upload, tags are batch-inserted and then fetched using `inArray(tags.slug, slugs)` — a slug-only lookup. This will return the wrong tag when slug collisions exist. All other tag operations now use the name-first-then-slug-fallback pattern. The batch path in `uploadImages` was not updated when the name-first pattern was introduced.
- **Fix:** After batch `INSERT IGNORE`, fetch by name first, then slug fallback, matching the pattern in `addTagToImage` and `batchAddTags`.
- **Cross-agent:** Also flagged by code-reviewer (CR-7R2-03) and tracer.

### DBG-7R2-03: `updateSeoSettings` and `updateGallerySettings` non-atomic multi-row upserts [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/app/actions/seo.ts` lines 100-111, `apps/web/src/app/actions/settings.ts` lines 57-67
- **Description:** Both functions iterate over settings and perform individual DB upserts without a transaction. If the process crashes or an error occurs mid-loop, some settings are updated and others are not. This could leave the application in an inconsistent state — for example, a storage backend change without the corresponding quality settings, or a partial SEO update that shows mixed metadata.
- **Fix:** Wrap the loop in `db.transaction()`.
- **Cross-agent:** Also flagged by code-reviewer (CR-7R2-05).

## Previously Deferred Items Confirmed (No Change)

All previously deferred items from cycles 5-39 remain deferred.
