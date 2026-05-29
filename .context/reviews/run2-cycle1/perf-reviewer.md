# Perf Reviewer — Run-2 Cycle 1 (HEAD eaee58dc)

Angle: performance, concurrency, memory, DB efficiency, UI responsiveness. Faithful-delivery surface.

## PERF-01 — `fetchCandidates` loads ALL backfill candidate rows into memory at once (LOW, Medium confidence)

**File:** `apps/web/src/lib/admin-backfill-runner.ts:159-169`. `fetchCandidates` runs `SELECT … FROM images WHERE pipeline_version < 7 ORDER BY id` with no LIMIT and materializes every candidate row into a JS array before queueing. For a large library (tens of thousands of un-migrated photos after a pipeline bump) this is one large result set held in memory for the entire run, plus a PQueue holding that many task closures simultaneously. The selected columns are small (ids + filenames + two color strings + width), so the row payload is modest (~200 bytes/row → ~2 MB at 10k rows) — not catastrophic, but unbounded. The operator script has the same shape. **Severity LOW** given typical personal-gallery scale. **Optional fix:** page the candidate fetch (the script already uses `BATCH_SIZE = 100` for flushes; candidate fetch could batch by id cursor too). Defer acceptable.

## PERF-02 — In-app runner issues one UPDATE per row vs script's batched transaction (LOW, High confidence)

**File:** `admin-backfill-runner.ts:238-263` (per-row `db.execute(UPDATE)`) vs `backfill-color-pipeline.ts:262-283` (100-row batched transaction). The in-app runner runs INSIDE the live web process and shares the 10-connection pool with live traffic; thousands of individual UPDATE round-trips during a backfill add pool pressure exactly when the site is serving. The default `ADMIN_BACKFILL_CONCURRENCY = 1` bounds concurrent encodes but not the cumulative UPDATE count. **Severity LOW** — each UPDATE is tiny and the encode dominates wall-time anyway. **Optional fix:** batch the runner's UPDATEs like the script (would also be a natural place to unify the two implementations per ARCH-02). Defer acceptable.

## PERF-03 — `getTopSharedGroupsByViews` — index-supported, no concern (INFO)

`analytics-data.ts:142-167` filters `bot=false AND viewed_at >= since`, joins `sharedGroupViews.groupId → sharedGroups.id`, groups by `sharedGroups.key`. Index `idx_shared_group_views_group_id_viewed_at (group_id, viewed_at)` supports the join + range; `bot=false` is a post-filter (not in the index) but selectivity is high (most rows are non-bot). Consistent with the existing `getTopTopicsByViews` / `getCountryBreakdown` patterns which are equally index-backed. At personal-gallery analytics volume this is fine. No finding. (If view tables ever grow to millions, a covering index including `bot` could help — out of scope now.)

## PERF-04 — Histogram effect re-runs on `colorPrimaries` identity (INFO, Low confidence)

`histogram.tsx:558-601` effect deps `[effectiveUrl, markFailed, colorPrimaries]`. `colorPrimaries` is a string (stable by value), `markFailed` is `useCallback`-stable, `effectiveUrl` changes only on real source change. No unnecessary re-decode. The worker is created once (line 550-556) and terminated on unmount. AbortController cancels in-flight work on dep change. Clean — no finding.

## Clean
- Lightbox keydown listener: single window listener, cleaned up, deps complete — no churn.
- `useDisplayCapability` snapshot memoization is unchanged this cycle (CLAUDE.md flags the React #185 risk; not touched).
- Backfill PQueue concurrency is bounded and documented.
