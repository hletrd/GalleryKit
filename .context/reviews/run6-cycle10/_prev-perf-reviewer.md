# Performance & Concurrency Review — GalleryKit

**HEAD:** `af9ae6c5` (branch master) · **Agent:** perf-reviewer · **Date:** 2026-06-17
**Run/Cycle:** Run 6 / Cycle 9 (review-plan-fix loop)
**Prior perf baseline:** `1a325fa6` (cycle-8 perf — 2 findings: PERF-C8-01 index, PERF-C8-02 dotProduct, both since fixed)
**Scope this cycle:** FRESH re-verification that the cycle-8 perf fixes actually landed AND are effective in production, plus a full-repo re-sweep (CLIP hot path + every non-CLIP listing/serve/render/queue/SW/rate-limit surface) for any NEW or previously-missed perf issue.

---

## Verdict

**0 NEW findings.** This is an honest convergence cycle. Every cycle-8 perf finding was fixed and I HEAD-verified each fix is correct AND *effective* (the index migration actually applies; the `dotProduct` swap is gated correctly). The only remaining perf-shaped item on a live path — AGG-C8-01 (main-thread inference + scan) — is already a tracked, ACTIVE, original-severity-preserved deferral (`plan-361` DEF-C8-1, HIGH) with an explicit architect-led exit criterion; I examined it for a NEW angle per the brief and found none that isn't already subsumed by that deferral's scope. Re-reporting it would duplicate DEF-C8-1, which the brief forbids.

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 0 | — |

No nitpicks, no premature-optimization churn. The two cheap, real cycle-8 perf wins are in and verified; nothing else on any path crosses the worth-fixing bar.

---

## Mechanical delta verification (HEAD-verified, not trusted)

**Shipping delta `1a325fa6..af9ae6c5`** (the cycle-8 fix commits + cycle-8 review docs):
- `drizzle/0022_image_embeddings_model_version_idx.sql` (+9) + `schema.ts` (+6, the `index()` builder) + `migrate.js` (+4, `ensureIndex` in `reconcileLegacySchema`) + `meta/_journal.json` (+7) — the AGG-C8-03 index.
- `api/search/semantic/route.ts` (+11) + `api/search/similar/[id]/route.ts` (+18) — the AGG-C8-09 `dotProduct` swap (+ AGG-C8-10 enrichment-column parity, non-perf).
- `actions/embeddings.ts` (+21) — AGG-C8-05 `model_version` filter in the `notExists` subquery (correctness, unwired path).
- `components/search.tsx` (+20) / `similar-photos.tsx` (+5) — AGG-C8-04/06 short-query UX + a11y (non-perf).
- `lib/clip-paths.ts` (+20) + `scripts/download-clip-models.ts` (+30) + tests — AGG-C8-02/12 (non-perf).

**Working tree:** the `git status` snapshot in the prompt was STALE — every listed dirty file (`admin-backfill-runner.ts`, `page.tsx`, `sw.js`, `error.tsx`, the `.context/reviews/*.md`) is committed at HEAD. `git diff HEAD -- apps/web/src apps/web/public/sw.js` over the working tree is EMPTY for shipping source. No uncommitted shipping change to review.

---

## Cycle-8 perf fixes — landed AND effective (the core of this cycle's verification)

### PERF-C8-01 / AGG-C8-03 — `image_embeddings(model_version, updated_at)` index → CLOSED ✓
- **Migration present & correct:** `drizzle/0022_image_embeddings_model_version_idx.sql:8-9` creates `idx_image_embeddings_model_version_updated (model_version, updated_at)`.
- **Schema mirror present:** `schema.ts:284-288` declares the matching `index('idx_image_embeddings_model_version_updated').on(table.modelVersion, table.updatedAt)`.
- **Legacy-reconcile mirror present:** `migrate.js:570-573` adds the index idempotently via `ensureIndex(...)` inside `reconcileLegacySchema`, so a fresh DB without `__drizzle_migrations` rows still gets it. Matches the CLAUDE.md migration runbook.
- **The migration actually APPLIES (not inert):** I verified `meta/_journal.json` entry idx=22 has `when=1781687094232`, which is the strict global maximum across all journal `when` values (0 entries are ≥ it). Per the documented drizzle `MAX(created_at)` cursor behavior, a non-monotonic `when` would have silently skipped this migration — leaving the full-table-scan LIVE despite the "fix." It is monotonic-max, so drizzle applies it AND the `migrate.js` post-condition hash assertion would fail loud if it didn't. **The fix is real in production, not just in source.**
- **Query shape is index-served:** both live scans run `WHERE model_version = ? ORDER BY updated_at DESC LIMIT 5000` (`semantic/route.ts:254-256`, `similar/[id]/route.ts:145-147`). Equality on the leading index column + DESC sort on the second column = a backward index range scan; the filesort the prior cycle described is eliminated. (The `SELECT embedding` BLOB fetch still requires per-row PK back-lookups — see "what is NOT a new finding" below — but the filesort is gone.)

### PERF-C8-02 / AGG-C8-09 — `dotProduct` fast-path → CLOSED ✓, and the stub-gating is CORRECT
- `semantic/route.ts:271`: `const similarity = isProd ? dotProduct : cosineSimilarity;` — production (unit vectors) uses `dotProduct`; stub stays on `cosineSimilarity`. This is the *correct* gate, not a blanket swap: `embedTextStub`→`deterministicEmbedding` returns raw `[-1,1]` values that are NOT L2-normalized, so `dotProduct` would corrupt stub ranking. Reviewer-grade detail handled right.
- `similar/[id]/route.ts:163`: unconditional `dotProduct(targetEmbedding, imgEmbedding)` — safe because Gate 5 (`:101`) returns 503 for any non-`production` mode, so stub vectors can never reach this scan. Every operand is `truncateAndNormalize` output (unit length). Correct.
- Both import `dotProduct` from `@/lib/clip-embeddings` (`semantic:42`, `similar:36`). No dangling `cosineSimilarity` import left where unused (semantic still needs it for the stub branch).

### AGG-C8-05 — backfill `notExists` `model_version` filter → CLOSED ✓ (correctness, perf-adjacent)
`actions/embeddings.ts:92` hoists `modelVersion` above the query; `:103-111` adds `eq(imageEmbeddings.modelVersion, modelVersion)` to the `notExists` subquery. Still unwired from UI (sidecar canonical), but the selection now matches the sidecar. Not a perf issue; noted for completeness since it was in the cycle-8 perf-adjacent note.

---

## AGG-C8-01 (main-thread inference + scan) — examined for a NEW angle; none found

The brief asked me to verify AGG-C8-01's status and only re-report if there's a NEW unaddressed angle. Status at HEAD:

- **It is a tracked, ACTIVE deferral, NOT a dropped item.** `plan-361-run6-cycle8-deferred.md` DEF-C8-1 carries it at its **original HIGH/High** (explicitly NOT downgraded), records the re-open trigger as FIRED (production is live), and scopes the fix as architect-led off-main-thread work (`worker_threads`/sidecar pool) — "designed, not bolted on." The two cheap interim main-thread-cost reductions it called for (the index + `dotProduct`) both landed THIS-cycle-prior, shrinking the window.
- **The candidate NEW angle I evaluated — per-request BLOB transfer + Float32Array decode cost.** Both routes `SELECT embedding` (the 2048-byte MEDIUMBLOB) for ALL ≤5000 scanned rows, then `decodeEmbeddingColumn` → `bufferToEmbedding` runs 512 `readFloatLE()` calls + one `Float32Array(512)` alloc per row (`clip-embeddings.ts:77-86`). At the 5000-row cap that is ~10 MB of inline-BLOB wire transfer + ~2.56M `readFloatLE` + 5000 allocations **per request, on the main thread**, and the index does NOT remove it (the query selects the BLOB, so even an index range scan does per-row PK back-lookups to fetch it).
- **Why this is NOT a new finding:** DEF-C8-1 explicitly scopes "the per-request ≤5000-row JS cosine scan + ONNX tensor pre/post run on the Node main thread." Decoding the row to a `Float32Array` is an inseparable prerequisite of that scan — you cannot score row N without decoding it — so the decode/transfer cost lives inside DEF-C8-1's blast radius and shares its exact remedy (move the scan off-thread, or cap the scan size; the register already names "lowering the 5000-row scan cap as a cheap interim throttle"). Reporting it as PERF-C9-xx would be re-labeling AGG-C8-01, which the brief forbids. I am surfacing it here as **corroboration of DEF-C8-1's bound**, not as a new item.

**Recommendation to the aggregator (no new ID):** when DEF-C8-1's architect-led design is scheduled, ensure the design accounts for the BLOB-read + decode cost (it dominates the non-inference main-thread slice at scale), and re-state the "lower the scan cap" interim lever — it is the single cheapest throttle if production load is observed before the worker pool ships.

---

## CLIP hot-path catastrophe checklist — re-verified at HEAD (all PASS)

1. **Model load is a true cross-request singleton.** `getModelBundle()` (`clip-model.ts:78-108`) caches `loadPromise` at module scope; `from_pretrained` runs once/process; the `.catch` nulls the promise only on *failure* (retry, not poison). No per-request reload. ✓
2. **ONNX inference does not block the loop.** `await model(...)` (`clip-model.ts:123`, `:184`) — onnxruntime-node's `session.run` is async-offloaded to a libuv worker. The text-query path does no synchronous heavy loop (tokenize + async model call + 512-elt normalize). ✓ (Residual main-thread cost is the JS scoring + BLOB decode loop — that's the DEF-C8-1 surface, above.)
3. **The 786K-iteration HWC→CHW preprocessing loop (`clip-model.ts:176-182`) is OFF the request path.** It runs only in `embedImageReal` (upload queue hook `image-queue.ts`, backfill, unwired admin action) — never on public text search. ✓
4. **Native runtime is lazily imported** inside `getModelBundle()` (`clip-model.ts:83`), listed in `serverExternalPackages`. Zero footprint until first real encode. ✓
5. **Scan hard-capped + enrichment bounded.** `.limit(SEMANTIC_SCAN_LIMIT)` = 5000; `topK` → ≤50; enrichment is ONE `inArray(images.id, ≤50 ids)` round-trip with a `processed` filter. No N+1. ✓
6. **No cross-request memory growth.** Only resident state is the intentional singleton bundle; scored array / decoded `Float32Array`s / the `pv` scratch are request-local and GC'd. ✓
7. **Backfill bounded.** Sidecar: `BATCH_CONCURRENCY=2`, keyset pagination, `BATCH_SIZE=50`, total ≤ `SEMANTIC_SCAN_LIMIT`. Admin action mirrors (`BACKFILL_CONCURRENCY=2`, chunked `Promise.all`, `.limit(SEMANTIC_SCAN_LIMIT)`). The queue embedding hook is fire-and-forget (`void (async()=>{})()`, `image-queue.ts:434`) and gated `disabled→return`, so it never blocks the PQueue job. ✓
8. **`getGalleryConfig` on the request path** is `cache()`-wrapped (request-scoped dedupe) and reads one indexed `admin_settings` row-set per request. One cheap round-trip, same pattern every public route uses, rate-limited to 30/min/IP — NOT search-specific, NOT new, below the bar. ✓

---

## Full-repo non-CLIP re-sweep — no new regressions

Dispatched a thorough read-only sweep of every non-CLIP perf surface and independently verified the two candidates it surfaced; both rejected on direct source inspection:

- **REJECTED — sw.js HEAD-revalidate abort (`sw.js:235-256`).** The `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` fetch is inside a `try { await ... } catch { /* fall through to stale-serve */ }` — the abort rejection is fully handled and the path falls through to `startRevalidate(); return cached;`. This is exactly the documented AGG-R8-05 (run-8 c2) bound. No orphaned promise; `await` + try/catch is complete. Not a finding.
- **REJECTED — photo-viewer "RAF handle accumulation".** The cited lines `photo-viewer.tsx:150-170` contain a `sessionStorage` effect (`:150-154`) and a single `setTimeout` blur-fallback with proper `return () => clearTimeout(fallbackTimer)` cleanup (`:168-172`). There is no multi-RAF scroll-restore block at the cited location — the candidate's evidence was not present in source. Not a finding.

Confirmed clean (re-derived at HEAD; byte-identical to the cycle-7/8 converged baselines for these files):
- **No N+1** anywhere — listing/detail/feed tags via the shared `tagNamesAgg` GROUP_CONCAT JOIN (one round-trip); enrichment via single `inArray`.
- **images-table query shapes** all covered by composite indexes; the `getImagesForFeed` `updated_at` filesort remains the only uncovered shape — **still awareness-only** (bounded, low-frequency, cacheable Atom feed). NOT re-reported.
- **No new sync fs on any request/render path.** The only `*Sync` additions since the cycle-7 baseline are in `__tests__` source-scanning fixtures (`client-server-only-boundary.test.ts`, `clip-paths.test.ts`, `download-clip-models.test.ts`) — never executed on a serving path.
- **Sharp pipeline** unchanged: 3-format parallel `Promise.all`, `.clone()` decode reuse, concurrency cap `(cpu-1)/3`, `sharp.cache(false)`, `rgb16` only on wide-gamut, `WIDE_GAMUT_MAX_SOURCE_PIXELS` OOM guard, `limitInputPixels`.
- **Queue** unchanged: `PQueue concurrency 1`, per-job advisory lock + conditional UPDATE, bounded retry maps (`MAX_RETRY_MAP_SIZE`).
- **SW LRU** O(k) insertion-order head-walk eviction, 50 MB cap — unchanged.
- **serve-upload** settings-hash behind a 5s SWR module cache (PERF-R4C3-05); ETag is mtime+size+hash string concat; no per-request DB fan-out on the static-served path.
- **All rate-limit maps** are `BoundedMap` with hard caps + periodic O(n≤cap) prune; semantic/similar share the `preIncrementSemanticAttempt` bucket (cap 2000) — bounded.
- **Connection pool** 10 conns, queue limit 20, keepalive — unchanged.
- **search.tsx / similar-photos.tsx** UI deltas introduced no new fetch/interval/loop/sort patterns (diff grep empty for perf-relevant additions); semantic POST stays debounced, similar fetch stays once-on-first-expand and fully gated out unless production mode.

---

## Hard guards respected
1. Did **not** propose re-adding `import 'server-only'` to `clip-model.ts` or `@/db`.
2. Did **not** propose changing `semantic_search_mode` default away from `'disabled'`.
3. Did **not** propose weakening the production gate / revision pin / `allowRemoteModels=false` / `model_version` isolation. The (zero) findings touch none of these.
4. Did **not** re-report AGG-C8-01 (it is tracked as ACTIVE DEF-C8-1); the BLOB/decode cost I examined is documented above as *subsumed* by that deferral, surfaced as corroboration only, with no new ID.
5. Did **not** re-report any cycle 1–8 closed item.

## Recommendation
Convergence confirmed from the performance axis. The two real cycle-8 perf fixes (index + `dotProduct`) are landed and verified effective in production (the index migration's journal `when` is monotonic-max, so it actually applies). No new work is warranted this cycle. The single remaining live-path perf item (AGG-C8-01 / DEF-C8-1, HIGH) is correctly tracked as an architect-led deferral with a fired re-open trigger and shipped interim mitigations — when it is picked up, fold the BLOB-read/decode cost and the scan-cap throttle into that design (noted above, no new ID).
