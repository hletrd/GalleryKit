# perf-reviewer — cycle 2 rpl

HEAD: `00000006e`.

## Scope
Hot paths: image listing queries (`lib/data.ts`), image processing queue (`lib/image-queue.ts`), CSV export (`db-actions.ts`), admin dashboard list rendering, public photo page.

## Findings

### PERF2R-01 — `searchImages` issues up to three sequential DB queries, each joining images+topics
- **Citation:** `apps/web/src/lib/data.ts:725-831`.
- **Severity / confidence:** LOW / HIGH.
- **Why it matters:** search for an uncommon term that doesn't match title/desc/camera/topic runs the main query (empty), then the tag query, then the alias query. Three serial round-trips on every rare search. The short-circuit at line 762 (`if (results.length >= effectiveLimit)`) correctly avoids the tag and alias queries when the main query fills the limit — so the worst case is bounded to three round-trips, but it's three on the cold path.
- **Fix:** defer — rewriting this as a single UNION query would reduce round-trips but would also rearrange ranking semantics. Track as perf-only deferral.

### PERF2R-02 — CSV export materializes up to 50,000 rows then joins them into a single string
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:56-97`.
- **Severity / confidence:** LOW / MEDIUM.
- **Disposition:** pre-existing D6-05 (streaming CSV). Unchanged.

### PERF2R-03 — `bootstrapImageProcessingQueue` selects all unprocessed images without pagination
- **Citation:** `apps/web/src/lib/image-queue.ts:297-315`.
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** at cold boot after a long outage, this could pull thousands of rows into memory at once. Acceptable because only the id + four filename fields + width are selected, but worth recording.
- **Fix:** defer — add LIMIT + cursor if the gallery ever ships with backlog-recovery operations in production.

### PERF2R-04 — `getSharedGroup` fetches ALL image tags eagerly even for 100-image groups
- **Citation:** `apps/web/src/lib/data.ts:632-658`.
- **Severity / confidence:** LOW / HIGH (acceptable).
- **Why it matters:** a 100-image group with each image having 20 tags is only ~2000 tag rows — not an issue today. However, the N+1 avoidance code here is correct and is the right tradeoff.
- **Fix:** none this cycle.

### PERF2R-05 — `revalidateAllAppData` is called on every SEO update
- **Citation:** `apps/web/src/app/actions/seo.ts:125`.
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** SEO updates are rare (admin only, manual), and the downstream cache invalidation is correct; this is intentional. Noting it for completeness.
- **Fix:** none.

### PERF2R-06 — Admin image listing uses full `adminSelectFields` in `getAdminImagesLite`
- **Citation:** `apps/web/src/lib/data.ts:420-439`.
- **Severity / confidence:** LOW / HIGH (acceptable).
- **Why it matters:** admin listings need the full field set to render EXIF, GPS, and original filenames; this is correct separation from `publicSelectFields`. Not a perf issue, just confirming the privacy contract.
- **Fix:** none.

## Summary
No new actionable perf issues found. PERF2R-01 is the only new observation; it's deferred because the fix changes ranking semantics.
