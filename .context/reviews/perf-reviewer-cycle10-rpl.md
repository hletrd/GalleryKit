# perf-reviewer — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: performance, concurrency, CPU/memory/UI responsiveness.

## Findings

### C10R-RPL-P01 — `pruneShareRateLimit` called on every share request without cadence throttle (AGG9R-RPL-09 carry-forward) [LOW / MEDIUM]

File: `apps/web/src/app/actions/sharing.ts:36-50`.

Still unfixed from cycle 9 rpl. Default rate limit is 20 req/min per IP, so worst case is 20 prunes/minute per admin IP. Each prune is O(N) over `shareRateLimit` map (max 500 entries). This is well under any practical concern (~10k iterations/min total), but it's inconsistent with `pruneSearchRateLimit` which does throttle. Fix is a 5-line addition.

Confidence: Medium.

### C10R-RPL-P02 — `prunePasswordChangeRateLimit` called on every password change without cadence throttle [LOW / LOW]

File: `apps/web/src/lib/auth-rate-limit.ts:90-107`, called from `auth.ts:310`.

Same class of micro-inefficiency as P01 but even lower impact — password changes are rare (0-few per day). Fix only makes sense if a generic "pruneable-rate-limit" helper is built and applied across all three prune functions consistently.

Confidence: Low.

### C10R-RPL-P03 — `searchImages` data.ts query runs LEFT JOIN + 5-way OR with LIKE on each column [LOW / MEDIUM]

File: `apps/web/src/lib/data.ts:744-757`.

The search query does:
```
WHERE images.processed = true
  AND (title LIKE ? OR description LIKE ? OR camera_model LIKE ?
       OR topic LIKE ? OR topics.label LIKE ?)
```

With 5 LIKE patterns per query, the planner cannot use the `(processed, capture_date, created_at)` composite index effectively — it falls back to scan+filter. At small image counts this is fine. At scale (>1M images) this could be slow. Not a regression; documented design tradeoff. No test for it.

Proposed: Long-term use a FULLTEXT index or external search engine (Meilisearch, Typesense). For current scale, leave as-is. Track as a perf-graveyard item for when image_count exceeds ~200k.

Confidence: Medium. Observational only; not actionable this cycle.

### C10R-RPL-P04 — `adminSelectFields` duplicated in `publicSelectFields` derivation only shares structure, not runtime cost [LOW / LOW]

File: `apps/web/src/lib/data.ts:111-181`.

The object destructuring pattern at lines 161-177 creates a new object reference every time the module loads, which is fine — it's module-level and runs once. No runtime overhead. Noted only to confirm: there is NO per-request overhead from the privacy-field separation. This is a design-win for both security AND performance.

Confidence: High (confirmation only).

## Summary

- 0 HIGH
- 0 MEDIUM
- 4 LOW findings (2 carry-forward micro-optimizations, 2 observational)

No new performance regressions. The codebase continues to be well-tuned at its current scale.
