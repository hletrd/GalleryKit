# Document-Specialist Review — Cycle 17 / HEAD 7b5c1943

Generated: 2026-06-27

---

## Summary

4 mismatches found (0 HIGH, 2 MEDIUM, 2 LOW). All cycle-16 doc fixes verified correct. No critical mismatch that would mislead an agent into a functional bug.

---

## Cycle-16 Fix Verification (All Correct)

| Claim | Verdict |
|---|---|
| Smart collection route `/c/[slug]` (not `/s/[slug]`) | CORRECT — `app/[locale]/(public)/c/[slug]/page.tsx` exists and serves `getSmartCollectionBySlugCached` |
| Repo tree has `c/[slug]/` and `s/[key]/` as separate entries | CORRECT — both appear at CLAUDE.md lines 29-31 |
| `smart_collections.query_json` column at `schema.ts:297` | CORRECT — `schema.ts:297` is `query_json: text("query_json").notNull()` |
| `IMAGE_PIPELINE_VERSION = 7` at `gallery-config-shared.ts:21` | CORRECT |
| 9 `COLOR_IMPACTING_KEYS` | CORRECT — array at `settings-hash.ts:45-57` has exactly 9 entries |
| 10 React `cache()` functions in `data.ts` | CORRECT — 9 `*Cached` exports + `getSeoSettings` |
| Advisory lock names list | CORRECT — all 6 names match `advisory-locks.ts` exactly |
| `ADMIN_BACKFILL_CONCURRENCY` cap math (`max(1, floor((10−5−1)/2)) = 2`) | CORRECT — matches `admin-backfill-runner.ts:122` comment and formula |
| Nginx body-size caps (2M / 64K / 250M / 216M / 216M) | CORRECT — all confirmed in `nginx/default.conf` |
| `SEMANTIC_SCAN_LIMIT=2000`, `SEMANTIC_TOP_K_MAX=50` | CORRECT — `clip-embeddings.ts:17-18` |
| `VIEW_RETENTION_DAYS` default 395 | CORRECT — `view-retention.ts:29` |
| `QUEUE_CONCURRENCY` default 1 | CORRECT — `image-queue.ts:206` |

---

## Mismatches

### M-1 — MEDIUM | `settings-hash.ts:42-54` line reference is wrong

**CLAUDE.md location:** Line 290 (ETag / cache invalidation section)

**Doc claim:**
> "The settings hash (P4-E2) covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`)"

**Code reality (`settings-hash.ts`):**
```
44: // that the list is complete — see the NOTE on _ColorKeysAreSettingKeys).
45: export const COLOR_IMPACTING_KEYS = [
46:     'wide_gamut_jpeg_chroma',
...
54:     'image_quality_jpeg',
55:     // R8-R6 comment
56:     'image_sizes',
57: ] as const;
```

The export starts at line 45 and closes at line 57 — not 42-54. The previous cycle corrected `41-53` to `42-54` but still lands 3 lines early because a comment block precedes the export declaration.

**Correct statement:** `settings-hash.ts:45-57`

**Severity:** MEDIUM — a developer who jumps to these lines to verify the list lands inside the preceding comment, not at the array. Misleads during auditing but does not affect runtime behavior.

**Confidence:** HIGH

---

### M-2 — MEDIUM | Topic slug rename "Race Condition Protections" entry omits cycle-16 additions

**CLAUDE.md location:** Line 373 (Race Condition Protections section)

**Doc claim:**
> "**Topic slug rename**: Transaction wraps reference updates before PK rename"

**Code reality (`topics.ts:283-305`):**
```typescript
// Cycle-16 added two more reference updates inside the same transaction:
await tx.update(images).set({ topic: slug })...               // was already there
await tx.update(topicAliases).set({ topicSlug: slug })...     // was already there
// DBG-16-01: topic_views FK references old slug → CASCADE would wipe analytics
await tx.update(topicViews).set({ topic: slug })...           // NEW in cycle 16
// DBG-16-03: smart collection query_json with exact topic refs → silently stops matching
for (const collection of collections) { /* rewrite query_json */ }  // NEW in cycle 16
```

The cycle-16 fix added `topic_views` re-pointing (to prevent CASCADE-wipe of up to 395 days of per-topic view history) and smart collection `query_json` rewriting (to prevent topic-filtered smart collections from silently breaking after a rename). The doc says "reference updates" (plural) but doesn't enumerate which tables — a developer reading this to understand the transaction scope would not know `topic_views` and `smart_collections` are updated.

**Correct statement:** "Transaction re-points `images.topic`, `topicAliases.topicSlug`, `topic_views.topic`, and smart-collection `query_json` references, then deletes the old topic PK row and inserts a new one."

**Severity:** MEDIUM — omission is factual: the doc doesn't say the transaction handles analytics and smart-collection references. A developer adding another FK child column referencing `topics.slug` would not know to add it to this transaction. The DBG-16-01 data-loss bug (wiping 13 months of per-topic view analytics on any rename) existed precisely because the doc/code didn't enumerate this FK child.

**Confidence:** HIGH

---

### M-3 — LOW | Upload TOCTOU fix (R16C16 CR-16-01) absent from Race Condition Protections

**CLAUDE.md location:** Lines 370-383 (Race Condition Protections section)

**Doc claim:** The section lists `createTopic TOCTOU` (catches `ER_DUP_ENTRY`) but does not mention the upload quota TOCTOU.

**Code reality (`images.ts:197-222`):**
```typescript
// R16C16 CR-16-01: close the check-then-claim TOCTOU. ALL quota + format
// checks below are SYNCHRONOUS (no await), and the claim is made
// immediately after them BEFORE the first await (disk + topic-exists).
// Previously the count/byte checks were separated from the claim by two
// awaits, so two concurrent same-key uploads could both pass the checks
// before either claimed and jointly exceed the window limits.
```

The upload action had a race where two concurrent same-IP requests could both read the quota counter, both pass the limit check, and then both claim quota — jointly exceeding the per-window file-count and byte caps. Cycle 16 closed this by making all quota checks synchronous and claiming immediately before any `await`. This is a genuine race condition fix that belongs in the Race Condition Protections section alongside the existing `createTopic TOCTOU` entry.

**Correct addition:** "**Upload quota claim TOCTOU**: All per-window quota checks are synchronous and the tracker claim is made before the first `await` so two concurrent same-IP uploads cannot both pass the count/byte ceiling and jointly exceed it (R16C16 CR-16-01 in `actions/images.ts`)."

**Severity:** LOW — missing from the doc but not wrong. The code is correct; the doc just fails to enumerate this protection.

**Confidence:** HIGH

---

### M-4 — LOW | `image_views(image_id, viewed_at)` index missing from Database Indexes list

**CLAUDE.md location:** Lines 225-237 (Database Indexes section)

**Doc claim:** Lists two `image_views` indexes (both from migration 0021):
- `image_views(bot, viewed_at, country_code)` — analytics country breakdown
- `image_views(bot, viewed_at, referrer_host)` — analytics referrer breakdown

**Code reality (`schema.ts:229`, migration `0010_analytics_views.sql:12`):**
```typescript
idxImageViewsImageIdViewedAt: index('idx_image_views_image_id_viewed_at').on(table.imageId, table.viewed_at),
```
A third index on `(image_id, viewed_at)` has existed since the analytics tables were created in migration 0010. The Database Indexes section lists the 0021 additions but silently omits this original index.

**Correct addition:** Add `- image_views(image_id, viewed_at)` — per-image view history lookup (migration 0010) to the list.

**Severity:** LOW — no agent would make a wrong decision based on this omission. A developer adding a query against `image_views` might redundantly recreate this index thinking it doesn't exist, but the migration + schema are the ground truth.

**Confidence:** HIGH

---

## Items Verified Clean (No Mismatch)

- Smart collection `query_json` at schema.ts:297 is correct.
- `image_reactions` / `reaction_count` are absent from both CLAUDE.md and schema.ts (0024 migration correctly handled; no stale reference in CLAUDE.md).
- The `admin_tokens` description correctly uses `X-GalleryKit-Token` header and `gk_<base64url(32 random bytes)>` format, matching `api-auth.ts:14`.
- `view-retention.ts` sweeps all three analytics tables (`imageViews`, `topicViews`, `sharedGroupViews`) as claimed in CLAUDE.md.
- Batch delete transaction correctly described as `(imageTags + images atomic)` — matches `images.ts:739-745`.
- `gallerykit_topic_route_segments` and `gallerykit_admin_delete` advisory locks exist in `advisory-locks.ts` as documented.
- Smart collection table description uses `query_json` (not stale `rules` column name) after cycle-16 fix.
- `LOCK_COLOR_PIPELINE_BACKFILL` constant is `'gallerykit_color_pipeline_backfill'` — matches CLAUDE.md.
- "Public route freshness" (`revalidate = 0`) is set on `/c/[slug]` page — consistent with CLAUDE.md claim that "public pages" use it (though `/c/[slug]` is not enumerated by name).
- `POOL_CONNECTION_LIMIT = 10` in `db/index.ts:23` matches the "10-connection pool" claim.

