# Performance Review — run-9 cycle-2 (perf-reviewer)

**HEAD:** 1ef54aaa · **Baseline:** f63af3b9 (run-8 cycle-2 convergence)
**Verdict:** ✅ **0 new findings — convergence confirmed**

## Diff scope since run-8 convergence

`git diff f63af3b9 HEAD -- apps/web/src apps/web/scripts` excluding `__tests__` / `e2e` = **(none)**. Production logic is byte-identical to the last converged state. The only changes are:

- `apps/web/src/__tests__/upload-processing-contract-lock.test.ts` (NEW test, no runtime impact)
- `apps/web/src/__tests__/upload-tracker-state.test.ts` (NEW test, no runtime impact)
- `apps/web/public/sw.js` — `SW_VERSION` string stamp `ea372e41-p7` → `d3858cfc-p7` (build artifact; no logic change)
- `.context/reviews/**` docs

No production code path changed, so no perf regression is structurally possible vs. the converged baseline. I still re-audited the hot paths from source to hold the high bar.

## Hot-path inventory (re-validated from code)

| Path | File:line | Mechanism | State |
|---|---|---|---|
| Masonry listing | `lib/data.ts:726-852` | cursor pagination + `COUNT(*) OVER()` window (no 2nd count query) + shared `tagNamesAgg` GROUP_CONCAT over `GROUP BY images.id`; rides `(processed,capture_date,created_at)` | OPTIMIZED |
| Photo viewer | `lib/data.ts:954-1110` | single PK lookup + `Promise.all([tags, prev, next])`; dynamic prev/next conditions (no dead `sql FALSE` branches) | OPTIMIZED |
| Home OG metadata | `lib/data.ts:871-885` | purpose-stripped `id,title` LIMIT-1 scan — no tag JOIN / no GROUP_CONCAT (AGG-R8c3-05) | OPTIMIZED |
| Shared-group page | `lib/data.ts:1191-1249` | group fetch + single batched tag query via `inArray` (explicit N+1 avoidance), in-memory group-by | OPTIMIZED |
| Atom feed | `lib/data.ts:769-792` | `updated_at DESC` + bounded `safeLimit` + LEFT JOIN admin_users for author name | OPTIMIZED |
| Connection pool | `db/index.ts:23-38` | 10 conns, queueLimit 20, keepalive, 5s connectTimeout; `group_concat_max_len=65535` set once per pooled conn via Symbol-tracked init promise | OPTIMIZED |
| Background queue | `image-queue.ts:168` | PQueue concurrency=1 (env-overridable); off the request path | OPTIMIZED |
| Sharp pipeline | `process-image.ts:1019-1109` | file-path mmap + `sequentialRead`; per-format fresh decode (intentional correctness tradeoff, AGG-R7-08); rgb16 only on wide-gamut path; hard-link zero-copy same-size dedup; 50 MP downscale gate | OPTIMIZED |
| SW image cache | `sw.template.js:31-239` | stale-while-revalidate, 50 MB LRU, HEAD revalidate bounded by `AbortSignal.timeout(300ms)` (AGG-R8-05) | OPTIMIZED |
| View-retention GC | `view-retention.ts:57-83` | chunked DELETE 5000/batch, 200-batch/table cap, hourly background job; negative/non-finite retention clamps to default | OPTIMIZED |

## Index ↔ query alignment (db/schema.ts)

All documented composite indexes still match their consumers:
- `(processed,capture_date,created_at)` ← masonry/home sort
- `(processed,created_at)` ← prev/next nav
- `(topic,processed,capture_date,created_at)` ← topic-filtered listing
- `(user_filename)` ← upload dedup · `(uploaded_by)` ← admin attribution
- `image_tags(tag_id)` ← tag JOIN · `image_views(bot,viewed_at,country|referrer)` ← analytics breakdowns

## Items examined and deliberately NOT filed

- **View-retention DELETE index** (`view-retention.ts:71-74`): filters `viewed_at < cutoff LIMIT 5000`. `viewed_at` is the 2nd index column on `image_views` (`(bot,viewed_at,…)`) and `(fk,viewed_at)` on topic/shared tables — not a standalone leading column. Worst case is bounded (≤200×5000=1M rows/table/hr) on a background hourly job, never request-path; the 395-day window keeps tables small in practice; MySQL 8 skip-scan over the low-cardinality `bot` boolean further mitigates. Assessed and accepted in prior cycles (run9-cycle1 perf, run7-cycle1 perf). Not a measurable regression.
- **Carried LOW deferrals (per task directive, not re-filed):** R7C1-CR-02 1000-literal `NOT IN` bootstrap scan (`image-queue.ts:626-628`, runs once at startup); `ADMIN_BACKFILL_CONCURRENCY` connection-budget cap (working as designed).

## Conclusion

No new performance findings. The hot paths (data-access layer, DB indexes, Sharp pipeline, connection pool, SW LRU cache, background queue, analytics GC) are all in their previously-converged, optimized state, and no production code changed since the run-8 convergence baseline. **Convergence confirmed.**
