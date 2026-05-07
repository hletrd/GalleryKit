# Perf Reviewer — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Scope: perf audit of DB layer, image pipeline, SSR hot paths, and memory management.

## Summary

Most previous-cycle perf gains are intact:
- React `cache()` wrapping on `getImage`, `getTopicBySlug`, `getTopicsWithAliases`, `getTopicsCached`, `getTagsCached`, `getImageByShareKeyCached`, `getSharedGroupCached`.
- `Promise.all` on independent queries (tags + prev + next inside `getImage`).
- ISR tuning + batched revalidation for >20 deletes.
- Sharp `clone()` instead of triple decode.
- Scalar subquery `tag_names` on `getImagesLite` avoids costly GROUP BY.

No HIGH or MEDIUM new regressions. LOW-severity items noted below.

## Findings

### P5-01 — `flushGroupViewCounts` still issues N UPDATEs per chunk instead of a single `ON DUPLICATE KEY UPDATE` batch
- **Severity:** LOW. **Confidence:** MEDIUM. Cross-ref cycle-4-rpl2 AGG4R2-08.
- **File:** `apps/web/src/lib/data.ts:47-96`.
- **Evidence:** `chunk.map(([groupId, count]) => db.update(sharedGroups).set(...).where(eq...))` — each chunk fires `N` parallel UPDATEs with `FLUSH_CHUNK_SIZE = 20`. At 1000 buffered groups that's 50 round-trips per flush. The UPDATE is trivial (single-column), so chatter dominates.
- **Fix direction:** at MySQL level this is tricky because each row has a different delta. A CASE/WHEN batch would work: `UPDATE shared_groups SET view_count = view_count + CASE id WHEN ? THEN ? WHEN ? THEN ? ... END WHERE id IN (?, ?, ...)`. But Drizzle ORM doesn't have a neat CASE/WHEN builder, and hand-rolling raw SQL with parameter binding for 20 IDs is modest work. **Low priority, benchmark-gated.**

### P5-02 — `searchImages` still runs 3 sequential queries when the main query doesn't fill the limit
- **Severity:** LOW. **Confidence:** HIGH. Cross-ref cycle-2 D2-05 + cycle-4 PERF-02.
- **File:** `apps/web/src/lib/data.ts:725-832`.
- **Evidence:** when the main LIKE query returns fewer than `limit` rows, `searchImages` runs a tag-join fallback, and then an alias-join fallback. Three round-trips worst case. An empty-search-text DB (a rarely-used alias) leads to all 3 queries. Batched alternative: a single UNION ALL with `ORDER BY created_at DESC LIMIT N`, but that changes the "main wins dedupe" semantics in the current code. Matches existing deferred item.
- **Disposition:** existing deferred backlog — cross-reference D2-05 / PERF-02. No new work.

### P5-03 — `bootstrapImageProcessingQueue` pulls every unprocessed row unpaginated
- **Severity:** LOW. **Confidence:** HIGH. Cross-ref D2-06 / PERF-03.
- **File:** `apps/web/src/lib/image-queue.ts:298-305`.
- **Evidence:** `db.select(...).from(images).where(eq(images.processed, false))` — no `LIMIT`. With a 10k-unprocessed backlog, this pulls 10k rows + enqueues all. After bootstrap, enqueued set holds 10k integers; each retry map also can grow. Existing deferred.
- **Disposition:** existing deferred backlog. No new work.

### P5-04 — `getImage` prev/next OR-clauses may not index-optimize on the composite `(processed, capture_date, created_at)` index
- **Severity:** LOW. **Confidence:** MEDIUM. Cross-ref code-reviewer C5-10.
- **File:** `apps/web/src/lib/data.ts:477-534`.
- **Evidence:** the 3-branch OR with null-aware predicates and tiebreakers makes it hard for MySQL's optimizer to choose `ref` access. Most likely falls back to a range scan using the leading `(processed)` column only, then filtering. For large galleries this could cost 100ms+ per nav click. Existing deferred (D6-01).
- **Disposition:** existing deferred backlog. No new work.

### P5-05 — Upload pipeline streams `sharp(originalPath, { limitInputPixels: maxInputPixels })` for metadata extraction; the blur placeholder then `image.clone()` reuses the same instance. Good.
- **Observation:** verified the existing Sharp perf pattern: single instance, `clone()` for variant formats, file-path constructor so libvips can mmap. No finding.

### P5-06 — `adminSelectFields` omits `blur_data_url` (good) but `publicSelectFields` is derived by object destructuring of adminSelectFields. Per-request extra property churn in V8
- **Severity:** LOW. **Confidence:** LOW.
- **File:** `apps/web/src/lib/data.ts:115-200`.
- **Evidence:** the rest-destructure pattern runs once at module load, so no per-request cost. The `_privacyGuard` TypeScript assertion is compile-time only. No perf issue.
- **Disposition:** verified, no finding.

### P5-07 — `getTopicBySlug` hits the DB twice on alias lookup (once on `topics`, once on `topicAliases`)
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/lib/data.ts:672-705`.
- **Evidence:** two sequential `SELECT`s when the input is an alias (not a direct slug). A `LEFT JOIN` would collapse these. Today the `/^[a-z0-9_-]+$/.test(slug)` short-circuit avoids the alias query for ASCII topic slugs, so the double-round-trip only happens for CJK/emoji aliases.
- **Why it matters:** CJK URLs are infrequent but affect Korean/Japanese users disproportionately. Cache via `cache()` dedupe limits re-execution within a single request.
- **Fix direction:** redesign as a UNION query or a LEFT JOIN. Low priority, benchmark-gated.

### P5-08 — `revalidateLocalizedPaths` called with large path lists from `deleteImages` size ≤20 branch causes revalidation fan-out
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/actions/images.ts:542-552`.
- **Evidence:** for batch size 20, the revalidation call gets 20 `/p/${id}` paths + N topics + 3 static paths = up to 25+ calls. Next.js 16 batches revalidations internally but each path triggers cache invalidation + potentially an ISR re-render on next request.
- **Disposition:** matches existing deferred item (D6-02 scoped topic/tag navigation). No new work.

### P5-09 — `Sharp.concurrency(maxConcurrency)` is global to the process. Parallel tests share this setting
- **Severity:** LOW. **Confidence:** LOW.
- **File:** `apps/web/src/lib/process-image.ts:16-23`.
- **Evidence:** `sharp.concurrency()` mutates global libvips worker count. Ok for prod (single value), but tests sometimes stub or skip. Observation only.
- **Disposition:** no action.

## Summary

No HIGH/MEDIUM. 9 LOW findings, all either matched to existing deferred backlog or observational. **No new actionable perf items this cycle.**
