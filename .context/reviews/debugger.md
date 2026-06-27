# Debugger Review — Run-16 Cycle-16 (latent bug hunt)

**Date:** 2026-06-27
**HEAD:** 1f5fb245
**Agent:** debugger (oh-my-claudecode)
**Scope:** `src/lib/**` parsers / image pipeline / color+ICC+GPS byte walkers / validation / rate-limit / retention / bounded-map / settings-hash, plus `src/app/actions/**` and `src/app/api/**`. Checklist = the repo's six signature bug classes, swept across the whole tree (not just where each was last found).

**Bottom line:** Mature, heavily-hardened codebase — the cycle-15 fixes (DBG-15-01 `convertDMSToDD` NaN guard, CR-15-01 BoundedMap shallow-copy ×3) are correctly in place, and the numeric/parser surface is otherwise finite-guarded and bounds-checked throughout. This pass found **one confirmed MEDIUM data-loss bug** (topic slug rename CASCADE-deletes the topic's analytics) plus two LOW residuals. The MEDIUM is a textbook "fix one sibling, miss the next" — the rename transaction was written before the analytics tables existed and re-points two of the three child tables that reference `topics.slug`, but not the third (which is `ON DELETE CASCADE`).

---

## CONFIRMED — MEDIUM (data loss)

### DBG-16-01 — Renaming a topic's slug CASCADE-deletes that topic's entire `topic_views` analytics history
**Bug classes:** 3 (fix one sibling, miss the next) + 5 (data loss via cascade on a delete-recreate path).
**Confidence:** HIGH (traced through schema FK + transaction order). **Severity:** MEDIUM (permanent, silent data loss; analytics-grade not auth/billing-grade; admin-triggered, slug-change branch only).

**Symptom:** An admin renames a topic's slug (Settings → edit topic, change the slug). The rename reports success. The topic's complete view-analytics history (`topic_views` rows — country/referrer breakdown, top-topics ranking, year-in-review source, up to `VIEW_RETENTION_DAYS` = 395 days) is silently and permanently gone afterward.

**Root cause — three tables reference `topics.slug`, the rename re-points only two:**
- `apps/web/src/db/schema.ts:16` — `topicAliases.topicSlug` → `topics.slug`, `onDelete: 'cascade'`
- `apps/web/src/db/schema.ts:33` — `images.topic` → `topics.slug`, `onDelete: 'restrict'`
- `apps/web/src/db/schema.ts:236` — **`topicViews.topic` → `topics.slug`, `onDelete: 'cascade'`**

`updateTopic` implements a slug rename as a delete-and-recreate inside one transaction (`apps/web/src/app/actions/topics.ts:248-287`):
1. `tx.insert(topics)` the new slug row (`:275`)
2. `tx.update(images).set({ topic: slug }).where(eq(images.topic, cleanCurrentSlug))` (`:282`) — re-points `images`
3. `tx.update(topicAliases).set({ topicSlug: slug }).where(eq(topicAliases.topicSlug, cleanCurrentSlug))` (`:283`) — re-points `topicAliases`
4. `tx.delete(topics).where(eq(topics.slug, cleanCurrentSlug))` (`:285-286`) — deletes the OLD slug row

`topic_views` rows are NEVER re-pointed (`grep topicViews apps/web/src/app/actions/topics.ts` → 0 hits). At step 4 they still carry `topic = 'oldslug'`, so the `ON DELETE CASCADE` on `topicViews.topic` fires and deletes every one of them. The author was demonstrably aware of the cascade-delete hazard — they re-point `topicAliases` (also `cascade`, line 283) precisely so it isn't cascade-deleted, and they re-point `images` (`restrict`, which would otherwise FK-error). `topicViews` (a US-P44 analytics table added after this rename logic) was the sibling missed.

**Reproduction (minimal):**
1. Create topic with slug `a`. Generate some public views of `/a` so `topic_views` accrues rows (`recordTopicView` in `app/actions/public.ts`).
2. `SELECT COUNT(*) FROM topic_views WHERE topic='a'` → N (>0).
3. Admin renames topic slug `a` → `b` (`updateTopic`, slug differs from current).
4. `SELECT COUNT(*) FROM topic_views WHERE topic='a'` → 0, and `… WHERE topic='b'` → 0. The N rows are gone, not migrated.

**Failure:** silent permanent loss of the topic's analytics; no error surfaces (the transaction commits successfully). Admin analytics (top-topics-by-views, referrer/country breakdowns) under-report for the renamed topic from then on.

**Fix (minimal, mirrors the existing siblings):** re-point `topic_views` BEFORE the cascade-bearing delete. Add to `topics.ts` (import `topicViews` from `@/db`):
```ts
await tx.update(topicViews).set({ topic: slug }).where(eq(topicViews.topic, cleanCurrentSlug));
```
immediately after the `topicAliases` update (`:283`), before `tx.delete(topics)` (`:285`). This preserves the rows by carrying them to the new slug, exactly as `images` and `topicAliases` are already carried.

**Verification:** after the fix, the repro's step-4 second query returns N (rows now under `topic='b'`). Lock with a rename test asserting `topic_views` survives a slug change (the existing rename test pins the inserted topic VALUES at `:256-259` but does not cover child-row preservation).

**Note (separate, lower-severity sibling on the SAME rename):** smart-collection rules also reference the topic by slug — `smart-collections.ts:28` allows `'topic'` as a column and the rule value is the slug, matched against `images.topic`. After a rename, `images.topic` is updated to the new slug, so a stored rule `{column:'topic', operator:'eq', value:'oldslug'}` now matches zero images — the smart collection silently goes empty. Tracked below as DBG-16-03 (LOW); it is config breakage, not data loss, and the value lives in opaque JSON so there is no clean referential update.

---

## CONFIRMED — LOW

### DBG-16-02 — `og-photo-fetch.ts` Content-Length size cap parsed without a finite guard (lone residual class-1 instance)
**Bug classes:** 1 (NaN survives a relational comparison) + 3 (un-mirrored sibling of the correct guard in the semantic route).
**Confidence:** HIGH (traced). **Severity:** LOW / effectively INFO — a downstream hard cap catches it, so there is no user impact today.

`apps/web/src/lib/og-photo-fetch.ts:57`:
```ts
if (contentLength && parseInt(contentLength, 10) > OG_PHOTO_MAX_BYTES) return null;
```
A malformed-but-present `Content-Length` (e.g. `"abc"`) makes `parseInt(...) → NaN`; `NaN > OG_PHOTO_MAX_BYTES` is `false`, so the pre-buffer reject is bypassed. The **post-buffer** hard cap one line down (`:59`, `if (photoBuffer.length > OG_PHOTO_MAX_BYTES) return null;`) still enforces the real limit, so nothing oversized is returned — the only cost is buffering a body the pre-check intended to short-circuit. This is the **sibling** of the correct pattern in `apps/web/src/app/api/search/semantic/route.ts:137` (`if (!Number.isFinite(contentLengthNum) || contentLengthNum < 0) … reject; if (contentLengthNum > MAX) … reject`), which finite-checks first. It is also the only remaining `parseInt`/`Number()`-into-`>`/`<` site in the tree lacking a `Number.isFinite` guard at a comparison (every other ID/route/config/retention site is guarded — see Verified-clean).

**Fix (parity):** `const len = Number(contentLength); if (Number.isFinite(len) && len > OG_PHOTO_MAX_BYTES) return null;`. Purely defense-in-depth; the post-buffer cap remains the real guarantee.

### DBG-16-03 — Topic slug rename leaves smart-collection rules pointing at the old slug (silent empty collection)
**Bug class:** 3 (fix one sibling, miss the next). **Confidence:** HIGH. **Severity:** LOW (config breakage, recoverable by editing the rule; not data loss).

Same rename path as DBG-16-01. `smart_collections.rules` stores a topic predicate's value as the slug string (`smart-collections.ts:28,298` — `'topic'` is an allowed column; the value matches `images.topic`). The rename updates `images.topic` to the new slug but does not (and cannot cleanly — the value is opaque JSON) rewrite stored rules, so `{column:'topic',value:'oldslug'}` matches nothing afterward and the `/s/[slug]` smart-collection page renders empty with no warning. Lower priority than DBG-16-01 because no data is destroyed; the admin sees an empty collection and can re-author the rule. Recorded so it is not silently dropped; a robust fix would rewrite topic-slug literals in affected `rules` JSON during the rename (or warn the admin).

---

## Re-confirmed cycle-15 fixes (in place, correct)
- **DBG-15-01** `convertDMSToDD` — `process-image.ts:1455` now finite-guards (`![dms[0],dms[1],dms[2]].every(Number.isFinite)`) and `:1461` (`!Number.isFinite(dd) || …`). A `0/0`→NaN GPS rational now returns `null` (SQL NULL), not a `NaN` that fails the DB insert. Verified.
- **CR-15-01** BoundedMap shallow-copy — `sharing.ts:48-62`, `admin-users.ts:34-48`, `embeddings.ts:36-42` now use the `map.set(key, { count: entry.count+1, … })` write-back pattern. Verified.

## Verified-clean (negative results — the checklist swept, no live bug)
**Class 1 (NaN survives `<`/`>`):** every other numeric-into-comparison site is finite-guarded: `topics.ts:108,211` (`Number.isNaN(order)→0`), `session.ts:129` (`Number.isFinite`), `view-retention.ts:41,44` / `audit.ts:109,112` (`Number.isFinite && >0`), `gallery-config-shared.ts` (`Number.isInteger` on `image_sizes`/`avif_effort`/`wide_gamut_max_source_pixels`/slideshow), `exif-datetime.ts` + `process-image.ts:506` (`isValidExifDateTimeParts`), `process-image.ts:1477-1480` (`cleanNumber` finite), `:1516,1534` (exposure/flash finite), `:957` (`depth in DEPTH_TO_BITS`), `image-types.ts:119` (`Number.isFinite`), `clip-embeddings.ts` (`isScalarValue`/zero-norm guards), `smart-collections.ts:328` (`isScalarValue` rejects NaN/Inf), ID routes `similar/[id]:78`, `p/[id]:49,138`, `og/photo/[id]:56`, `g/[key]:92` (regex + `>0` / `Number.isInteger`), semantic `route.ts:137`. The statfs `bavail*bsize` checks (`images.ts:211`, `lr/upload/route.ts:185`) are real-kernel values, not NaN-reachable.

**Class 2 (mutate a shallow copy):** all `BoundedMap.get()` consumers write back via `.set()` or are pure reads — `rate-limit.ts` (og/share/semantic), `auth-rate-limit.ts` (login/account/password — `recordFailedLoginAttempt:50`, `auth.ts:128,133`), plus the three cycle-15 sites. The upload tracker (`upload-tracker-state.ts`) is a raw `Map` returning real references, so its `tracker.count +=` mutations (`images.ts:255-256`, `lr/upload/route.ts:236-237`) correctly persist. No iterate-and-mutate over `BoundedMap.entries()`/`.data`.

**Class 4 (parser off-by-one / boundary):** `icc-extractor.ts` (desc/mluc), `color-detection.ts:230-296` (NCLX ISOBMFF), `gain-map-detection.ts` (iinf/infe/iref), `gps-exif-strip.ts` (JPEG/TIFF/HEIF iloc/WebP byte surgery) are all bounds-checked on every read; every walker loop advances `pos` by `≥ headerSize ≥ 8` (no infinite loop), and `Number(readBigUInt64BE())` huge-size cases are caught by the downstream `pos+size > length` / `> MAX_SAFE_INTEGER` guards (the two MAX_SAFE_INTEGER omissions remain the harmless DBG-15-02 INFO). `base56.ts`, `blur-data-url.ts` (length-capped), `image-zoom-math.ts` (clamped, client-only) clean.

**Class 5 (swallowed error / partial write mid-transaction):** `stripGpsFromOriginal` writes tmp + atomic `rename`, unlinks tmp on throw (`process-image.ts:1630,1654-1655,1703-1706`). `deleteImage` transaction (`images.ts:620-624`) is atomic; all `images` child FKs are `ON DELETE CASCADE` (`imageTags`/`sharedGroupImages`/`image_views`/`image_embeddings`, schema `:126,150,223,272`), so the delete cannot FK-throw mid-transaction. The view-count flush shutdown drain (`data.ts:104,210-211,227-228`) correctly publishes/awaits `currentFlushPromise` before the `size===0` early-return. Topic slug rename transaction order is FK-correct (insert-new → repoint → delete-old) — its only defect is the missed `topicViews` re-point (DBG-16-01).

**Class 6 (race/TOCTOU beyond advisory locks):** upload-tracker pre-claim (TOCTOU parity images.ts/lr-upload), per-image processing advisory lock + conditional `WHERE processed=false`, restore/backfill/contract/topic-route/admin-delete advisory locks all present; the view-buffer/tracker process-locality is documented BY-DESIGN. No new unguarded race surfaced.

---

## Bug-class summary
| Class | Result |
|---|---|
| 1 NaN survives `<`/`>` | 1 residual (DBG-16-02, downstream-caught, LOW); all DB-reaching sites guarded |
| 2 mutate shallow copy | clean (cycle-15 sites fixed; all consumers write-back) |
| 3 fix-one-sibling-miss-next | **DBG-16-01 (MEDIUM, topicViews)** + DBG-16-03 (LOW, smart-collections) + DBG-16-02 |
| 4 parser off-by-one | clean (all walkers bounds-checked) |
| 5 swallowed error / partial write | clean (atomic tmp+rename, atomic txns, cascade-safe deletes) — except DBG-16-01's cascade-delete |
| 6 race / TOCTOU | clean (locks + conditional updates in place) |

## References
- `apps/web/src/app/actions/topics.ts:248-287` — slug rename transaction (re-points images + topicAliases, MISSES topicViews) — DBG-16-01
- `apps/web/src/db/schema.ts:236` — `topicViews.topic` `onDelete: 'cascade'` (the destroyed child) — DBG-16-01
- `apps/web/src/db/schema.ts:16,33` — `topicAliases`/`images` FKs (the two that ARE re-pointed) — DBG-16-01
- `apps/web/src/lib/og-photo-fetch.ts:57` — Content-Length `parseInt` without finite guard — DBG-16-02
- `apps/web/src/app/api/search/semantic/route.ts:137` — the correct finite-guarded sibling — DBG-16-02
- `apps/web/src/lib/smart-collections.ts:28,298` — topic predicate value is the slug — DBG-16-03
- `apps/web/src/lib/process-image.ts:1455,1461` — cycle-15 GPS NaN fix (re-confirmed in place)
