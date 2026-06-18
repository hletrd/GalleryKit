# Performance & Concurrency Review — Run-7 Cycle-2 (perf-reviewer)

**Reviewer:** perf-reviewer
**HEAD:** `1cdbb883` (master, 2026-06-18)
**Scope:** Whole-repo performance + concurrency + race-condition + shared-state audit
**Prior context:** Run-7 cycle-1 perf-reviewer reported 0 findings (all bounded buffers/locks/queues independently re-verified from source). 6 LOW deferred items in `.context/plans/run7-cycle1/deferred.md` — re-raise only with NEW evidence (none found). AGG-R7C1-01 (NCLX YCgCo) and AGG-R7C1-02 (Firefox MQ doc) were fixed last cycle; both verified below for perf-regression impact.
**Verdict: APPROVE — ZERO performance or concurrency defects found.**

---

## Summary

A full audit of every performance- and concurrency-sensitive surface was performed at HEAD `1cdbb883`. The codebase remains converged on the performance/concurrency axis. No CRITICAL, HIGH, MEDIUM, or LOW performance or concurrency defect surfaced.

**Delta since cycle-1 HEAD `17f743f7`:** The only code-bearing changes are the two cycle-1 fixes (AGG-R7C1-01 + AGG-R7C1-02) and a regenerated `public/sw.js` (the `__SW_VERSION__` stamp). Every other perf-sensitive surface (image queue, backfill runner, rate-limit Maps, view-count buffer, SW LRU, CLIP singleton, connection pool, React render paths, embeddings backfill, smart-collection eval, download streaming, analytics aggregation) is byte-identical to the cycle-1-verified state. The cycle-2 sweep therefore re-verified the cycle-1-touched files in depth and ran a commonly-missed-issues sweep on the less-examined hot paths.

---

## Cycle-1 fixes — perf-regression check (both CLEAN)

### AGG-R7C1-01 — NCLX matrix code 8 → `ycgco` (commit `60a5690c`)
- **What changed:** `NCLX_MATRIX_MAP` constant (`lib/color-detection.ts:206-210`), a TypeScript union type, one UI display label (`color-details-section.tsx`), two test assertions, a CLAUDE.md spec reference.
- **Perf impact:** NONE. `NCLX_MATRIX_MAP` is a plain object literal indexed by integer code — lookup is O(1), evaluated once per image at parse time inside `detectColorSignals`. Adding a `'ycgco'` union member and a fifth map entry does not change the cost model. No loop, no allocation, no new I/O.
- **Verdict:** No perf regression.

### AGG-R7C1-02 — Firefox `(color-gamut: p3)` MQ doc correction (commit `10108963`)
- **What changed:** Comment block in `lib/use-display-capability.ts:64-69` and CLAUDE.md prose. **Zero executable code changed** — the diff is comment/doc-only.
- **Snapshot-memoization invariant re-verified:** `useDisplayCapability` still returns `_cachedSnapshot` by value-equality (`use-display-capability.ts:76-84`) before allocating a fresh object. This preserves the `useSyncExternalStore` `Object.is` contract (React #185 infinite-loop invariant). The comment edit did not touch this path.
- **Verdict:** No perf regression (no code change at all).

### `public/sw.js` regeneration (commit `1cdbb883`)
- Stamping `__SW_VERSION__` only — the LRU/HEAD-revalidation/cache-policy logic in the template is byte-identical. No new code path in the service worker.

---

## What Was Verified This Cycle (re-confirmed from source)

The cycle-1 verification block (image queue, backfill runner, pool, rate-limit Maps, view-count buffer, SW LRU, CLIP singleton, React render paths) was re-checked via `git diff 17f743f7..1cdbb883` — none of those files changed, so the cycle-1 evidence holds verbatim. This cycle added deeper examination of the following less-audited hot paths:

### A. Embeddings backfill concurrency (`app/actions/embeddings.ts:96-162`)
- **Scan bounded:** `pending` query carries `.limit(SEMANTIC_SCAN_LIMIT)` (line 115) — never scans the whole gallery.
- **Batch + chunk concurrency:** `BACKFILL_BATCH_SIZE` outer loop (line 121), `BACKFILL_CONCURRENCY` inner chunk with `Promise.all` (lines 125-158). Concurrency is explicitly bounded, not unbounded fan-out.
- **Error containment:** per-item `try/catch` increments `skipped` (line 155-157) — one failed embedding does not abort the batch or leak the model singleton.
- **No N+1:** single `pending` SELECT + batched `onDuplicateKeyUpdate` writes.

### B. Smart-collection evaluation (`lib/smart-collections.ts`)
- **AST depth cap:** `MAX_DEPTH = 4` (line 141), enforced in both `compileSmartCollection` (line 160) and `validateNode` (line 332). Throws `SmartCollectionDepthError` on overflow — no pathologically-deep recursion.
- **IN-list cap:** `MAX_IN_VALUES` (lines 233, 377) bounds generated `IN (...)` clauses.
- **Empty-children guard:** rejects empty `children`/`values` arrays (lines 165, 173, 230, 341, 374) — no infinite-reduction edge.

### C. Download route streaming + resource cleanup (`app/api/download/[imageId]/route.ts`)
- **`createReadStream` + `autoClose`:** success path closes the `FileHandle` via the stream's `autoClose` default when the stream ends or is destroyed (client abort) — no leak (line 404-406).
- **Every failure path closes the handle:** claim-failure (387), already-used (399), stream-setup-failure (456), post-open path (355) all `await fileHandle.close().catch(() => undefined)`.
- **No buffering of file body in memory:** true streaming response, so large originals don't pin JS heap.

### D. Analytics aggregation bounds (`lib/analytics-data.ts`)
- **Every `groupBy` query has `.limit(limit)`:** country breakdown `limit=30` (line 127), top-shared-groups `limit=20` (line 164+), referrer breakdown bounded similarly. No unbounded GROUP BY.
- **PERF-R5C2-01 index tradeoff documented:** the 'all' time window falls back to a covering-index temp-table aggregation, explicitly bounded by view-event retention (`VIEW_RETENTION_DAYS`, hourly GC). Reordering the index is deliberately deferred pending EXPLAIN evidence — correct "measure before optimize" stance.
- **`'XX'` sentinel:** still present (deferred DEF item R7C1-CR-03) — display-quality nit only, no perf or correctness impact, NOT re-raised (no new evidence).

---

## Commonly-missed issues — explicitly checked this cycle, none found

| Check | Result |
|---|---|
| Unbounded Map / Set growth | None — all rate-limit + buffer + retry Maps use `BoundedMap` or explicit FIFO cap (cycle-1 evidence holds; no file changed) |
| N+1 query in listings / enrichment | None — `tagNamesAgg`, batched `inArray`, `Promise.all` prev/next/tags, batched embeddings writes |
| Blocking sync I/O in hot paths | None — `grep readFileSync\|writeFileSync\|existsSync\|statSync\|readdirSync` across `lib/`, `app/api/`, `app/actions/` (excluding `__tests__`) returns ZERO matches |
| Unbounded `for await` / `while(true)` | None — single `for await` in `process-image.ts:521` is a bounded directory scan with `dirHandle.close()` in `finally`; no `while(true)` in lib/app/components |
| Unbounded GROUP BY aggregation | None — every analytics `groupBy` query has `.limit()` (verified this cycle, section D) |
| Lock leak on throw | None — every `GET_LOCK` paired with `RELEASE_LOCK` in `finally` (cycle-1 evidence holds) |
| Unhandled-rejection from floating promises | None — caption/embedding/view-record all have `.catch()`; embeddings backfill per-item try/catch (this cycle) |
| Memory leak via stale timer | None — `viewCountFlushTimer` nulled on entry (COR-R4C11-01); `gcInterval` guarded by `!state.gcInterval` (AGG-M12) |
| Pool exhaustion under backfill | None — `resolveBackfillConcurrency` caps workers against pool budget with non-finite guard (cycle-1 evidence holds) |
| React re-render storm on mousemove / MQ change | None — `ImageZoom` ref-based DOM mutation; `useDisplayCapability` value-cached snapshot (re-verified this cycle against the comment edit) |
| Event listener leak | None — every `addEventListener` paired with `removeEventListener` in cleanup (including the 3 MQ + focus + visibilitychange handlers in `use-display-capability.ts:91-115`) |
| Semantic scan / topK unbounded | None — `SEMANTIC_SCAN_LIMIT=5000` HARD cap on both routes (lines 256 / 147), `topK` clamped to `[1, SEMANTIC_TOP_K_MAX]`, index-backed (this cycle) |
| Smart-collection AST DoS | None — `MAX_DEPTH=4` + `MAX_IN_VALUES` caps on both compile and validate (this cycle) |

---

## Deferred register — no re-raises

All 6 LOW deferred items from `.context/plans/run7-cycle1/deferred.md` (DEF-C11-01 search input `h-8`, R7C1-CR-01..04, TE-R7C1-02..03) were reviewed for new evidence. None surfaced — they remain correctly deferred. Specifically:
- **R7C1-CR-02** (1000-literal `NOT IN`): the bootstrap scan is still gated by `MAX_PERMANENTLY_FAILED_IDS = 1000` (image-queue.ts:83), runs once at startup, no measured latency regression. Not re-raised.
- **DEF-C11-01** (search `<Input>` `h-8`): unchanged at `components/search.tsx`; still excluded from `touch-target-audit.test.ts` scope. Not re-raised (display/touch concern, not a perf/concurrency concern anyway).

---

## Issues Found

**None.**

---

## Recommendation

**APPROVE.** The codebase remains converged on the performance and concurrency axis at HEAD `1cdbb883`. The two cycle-1 fixes introduce no perf-impacting executable code change (one is a constant-map + union edit evaluated once per image; the other is comment/doc-only). No scheduling, no new findings to record.
