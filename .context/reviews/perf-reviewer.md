# Architecture + Performance Review — run-6 cycle-1

Agent: `architect` (covering PERFORMANCE this cycle)
Repo: GalleryKit (Next.js 16 / React 19 / TS6, MySQL+Drizzle pool=10/queue=20, Sharp parallel pipeline, PQueue background processing)
Scope: architectural/design risk, coupling, layering, concurrency, CPU/memory/UI responsiveness, DB pool, query patterns. Working-tree changes (uncommitted) evaluated; `.context/reviews/*.md` mods ignored as input.

All claims validated from code + measured reasoning, not comments.

## Findings by severity

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 4 |
| LOW | 4 |
| INFO / verified-sound | 3 |

## Findings table

| ID | Sev | File:line | One-line | Confidence |
|----|-----|-----------|----------|------------|
| ARCH-R6C1-01 | HIGH | admin-backfill-runner.ts:100-137 + db/index.ts:13-19 | AGG-5 formula is internally sound but the stale db/index.ts header comment still documents the OLD `(LIMIT-2)/2` arithmetic — operator-facing drift on the same invariant the change fixed | High |
| ARCH-R6C1-02 | MED | admin-backfill-runner.ts:91-101, 132-134 | AGG-5 reserves enough for ONE concurrent photo-page getImage fan-out, but a photo render peaks at ~5-6 concurrent conns and N simultaneous visitors are not protected; reserve guarantees no-starvation only at low live concurrency | High |
| PERF-R6C1-03 | MED | process-image.ts:1043-1097, 1052 | AGG-14: up to 3×8=24 (default 3×6=18) full source decodes per image — fresh `sharp(inputPath)` per distinct resizeWidth per format. Decode-once-per-format-then-resize is safe and would cut decodes ~Nx | High |
| PERF-R6C1-04 | MED | data.ts:923-1061 | `getImage` runs initial SELECT then 3-way Promise.all on EVERY photo view with `revalidate=0` (no ISR) — prev/next range scans run per view; under crawler/share load this is the dominant pool consumer the backfill cap is fighting | Medium |
| ARCH-R6C1-05 | MED | image-queue.ts:166 + admin-backfill-runner.ts:583-591 | Backfill PQueue and live image-queue PQueue share Sharp/libheif worker capacity with NO shared CPU budget; concurrency caps are independent, so backfill + active uploads can oversubscribe libvips threads | Medium |
| PERF-R6C1-06 | LOW | admin-backfill-runner.ts:472-491 | Backfill re-opens a SECOND `sharp(originalPath)` for color detection AFTER processImageFormats already decoded the same file 18+ times — one extra full decode per row purely for metadata | High |
| ARCH-R6C1-07 | LOW | data.ts:17-156 | Module-level view-count buffer + flush timer is process-local singleton state; correct for single-writer topology but silently double-counts/loses under any horizontal scale (already flagged in CLAUDE.md; reconfirmed no guard) | High |
| PERF-R6C1-08 | LOW | serve-upload.ts:46-83 | Serving-path settings-hash SWR cache is module-global (not per-request); correct, but on a true cold-start burst every concurrent request before first resolution blocks on the single inflight promise (acceptable, noted for completeness) | Medium |
| PERF-R6C1-09 | LOW | image-queue.ts:583-627 | Bootstrap re-scan SELECTs 16 columns × 500 rows and uses `notInArray(permanentlyFailedIds)` which can inline up to 1000 ids into the WHERE clause — large IN list on every bootstrap continuation pass | Medium |
| INFO-R6C1-10 | INFO | process-image.ts:36-53 | Sharp concurrency budget (`floor((cores-1)/3)`, `sharp.cache(false)`, mmap via path) is correctly tuned — AGG-14 is CPU/IO cost, NOT a heap-memory risk | High |
| INFO-R6C1-11 | INFO | api-auth.ts:1, home-client.tsx:13, load-more.tsx:6 | No real layering violations: lib→app import is server→server; client `@/lib/data` imports are `import type` (erased at compile) | High |
| INFO-R6C1-12 | INFO | error.tsx:22-30 (AGG-9), sw.js:26 | AGG-9 a11y split (decorative span + sr-only h1) and SW_VERSION bump are correct and low-risk | High |

---

## Detail

### ARCH-R6C1-01 (HIGH) — AGG-5 formula sound; db/index.ts comment is now WRONG

**The new formula is arithmetically correct.** `resolveBackfillConcurrency` (admin-backfill-runner.ts:124-137):

```
reserved = max(3, ceil(limit/2))           // BACKFILL_RESERVED_LIVE_CONNECTIONS
cap      = max(1, floor((limit - reserved - 1) / 2))
```

Verified across the domain:
- limit=10 → reserved=5 → floor((10-5-1)/2)=floor(2)=**2**. Worst-case held = 1 (lock) + 2×2 = 5; free = 5 ≥ reserved. ✓
- limit=3 → reserved=3 → floor(-1/2)=floor(-0.5)=-1 → max(1,-1)=**1**. ✓ (cap≥1 always holds via the `max(1, …)`)
- limit=4 → reserved=3 → floor(0/2)=**0** → max(1,0)=**1**. ✓
- limit=6 → reserved=3 → floor(2/2)=**1**. ✓
- limit=20 → reserved=10 → floor(9/2)=**4**. ✓
- NaN/Infinity poolLimit → `Number.isFinite` guard → falls back to 10. ✓

**cap ≥ 1 is guaranteed** by the outer `Math.max(1, …)`. **No off-by-one**: the `-1` correctly accounts for the whole-run advisory lock connection (acquireBackfillLock, line 279-298, holds one pool connection for the entire run), and the `2N` correctly models each worker holding the per-image claim connection (acquireImageProcessingClaim, line 319) concurrently with the `db.execute` UPDATE (line 494/525, which acquires a SECOND connection via the per-query wrapper in db/index.ts:91-98). I confirmed reprocessOne holds `claimConn` across the entire try block (line 432-536) while `db.execute` fires inside it (line 494) — so 2 concurrent connections per in-flight worker is the correct model, not 1.

**The defect:** db/index.ts:13-19 still says:

```
// The runner caps its effective
// concurrency at floor((POOL_CONNECTION_LIMIT - 2) / 2) because each backfill
// worker can hold up to 2 connections at once ...
```

This is the PRE-AGG-5 arithmetic. The whole point of AGG-5 was that `(LIMIT-2)/2` left only 1 connection free and starved live photo renders. The runner file (admin-backfill-runner.ts:28-35) ALSO retains a stale block in its top-of-file doc comment claiming `floor((POOL_CONNECTION_LIMIT - 2) / 2) = 4`. So the codebase now documents the budget invariant in three places (db/index.ts:16-18, runner header lines 31-32, runner function doc lines 104-122) and two of them describe the formula the change just removed.

**Risk (concrete):** an operator reading `POOL_CONNECTION_LIMIT`'s export comment to size their pool will compute the wrong headroom — e.g. believing a backfill at limit=10 caps at 4 and reserves only 1, they may lower the pool to 8 expecting cap=3, when the real cap is `floor((8-4-1)/2)=1`. The documented contract is the operator's only interface to this silent clamp (the clamp logs a warning but the budgeting rationale lives only in comments).

**Fix:** Update db/index.ts:13-19 and admin-backfill-runner.ts:28-35 to the AGG-5 arithmetic (reserve `max(3, ceil(limit/2))`, cap `floor((limit-reserved-1)/2)`, =2 at limit 10). Single source of truth would be better — have the export comment point to `resolveBackfillConcurrency` rather than restating the formula.

---

### ARCH-R6C1-02 (MED) — Reserve protects ONE concurrent fan-out, not concurrent visitors

The AGG-5 comment (lines 92-101) justifies reserving ~half the pool as "≥ one full live getImage fan-out (a ~3-way Promise.all)." That premise is **verified** — getImage (data.ts:1015) does `Promise.all([tags, prev, next])` = 3 concurrent connections. But the reserve math protects exactly that: ONE getImage at a time.

**Measured reality of a single photo-page render** (`/p/[id]/page.tsx`):
- `generateMetadata` (line 65): `Promise.all([locale, t, getSeoSettings(), getImageCached(id)])`. getImageCached → 3 conns (during its inner Promise.all) + getSeoSettings → 1 conn. Peak ≈ 4 concurrent.
- Page body (line 162): `Promise.all([locale, t, getImageCached(id), getSeoSettings()?, getGalleryConfig(), isAdmin()])`. getImageCached is React `cache()`-deduped so it does NOT re-hit the DB, but getGalleryConfig (1 conn), isAdmin (1+ conn), and any non-deduped getSeoSettings add up.

So a single photo render peaks around **4-6 concurrent pool connections**, and the surrounding gallery layout (`getSeoSettings` in layout.tsx:19/86) adds more. The reserve of 5 covers ~one such render. **Two simultaneous photo-page visitors while a backfill runs (5 held) will exceed the pool**, fall into `waitForConnections` queueing (queueLimit=20), and add latency — exactly the symptom AGG-5 set out to prevent, just at a slightly higher concurrency threshold.

This is not a bug in the formula — it's the ceiling of what a static reserve can do against a shared 10-connection pool. **The deeper issue is that the live photo path itself is connection-hungry under `revalidate=0`** (see PERF-R6C1-04). 

**Mitigation options (in order of leverage):**
1. Raise `POOL_CONNECTION_LIMIT` (cheap; mysql2 default elsewhere is often 10-25). At limit=16, reserve=8, cap=3 — backfill holds 7, leaves 9 for ~2 concurrent renders.
2. Collapse getImage's prev/next/tags into fewer queries (PERF-R6C1-04) so a render's peak drops to 2-3 conns.
3. Document that the backfill is intended for low-traffic windows (the single-writer topology already implies modest concurrency).

**Confidence: High** that the reserve only covers one fan-out; **Medium** on the exact 4-6 peak (depends on React cache() dedup of getSeoSettings across metadata+body, which I did not exhaustively trace).

---

### PERF-R6C1-03 (MED) — AGG-14: up to 18-24 full decodes per image; decode-once-per-format is SAFE

**Premise confirmed precisely.** `generateForFormat` (process-image.ts:1043) loops `for (const size of sortedSizes)`. The only dedup (line 1060) is:

```js
if (lastRendered && lastRendered.resizeWidth === resizeWidth) {
    await fs.link(lastRendered.filePath, outputPath); // hard-link, no re-decode
} else {
    const base = sharp(processingInputPath, {...}).resize({ width: resizeWidth }); // FRESH DECODE
    ...
}
```

`lastRendered.resizeWidth === resizeWidth` is true ONLY when two consecutive target sizes both clamp to `processingBaseWidth` (line 1054: `processingBaseWidth < size ? processingBaseWidth : size`) — i.e. only the *upscale-avoidance* case where the source is smaller than multiple configured sizes. For a typical large source (bigger than every configured size), **every size is a distinct resizeWidth → a fresh `sharp()` decode per size, per format.**

- Default `sortedSizes` = 6 (640/1536/2048/4096/5120/7680). Admin cap = `MAX_IMAGE_SIZE_COUNT = 8` (gallery-config-shared.ts:137).
- Formats run via `Promise.all` (line 1235): webp + avif + jpeg.
- **Worst case = 3 × 8 = 24 full decodes; default = 3 × 6 = 18.** CLAUDE.md's "~18" is exactly the default-config figure. Confirmed.

**Is decode-once-clone-within-a-format safe?** Yes. The current per-size fresh-instance design is justified ONLY for cross-FORMAT isolation (WI-14 / R8-R8 comments, lines 1019-1021, 1088-1090) — the concern was that a shared `sharp` instance reused across webp/avif/jpeg (which run in parallel) could cross-contaminate options/state. That risk is real for *parallel* format encodes. But **within a single format's sequential size loop**, the encodes run one-at-a-time (`await` in the for-loop), and Sharp's documented pattern for one-decode-many-outputs is exactly `const pipeline = sharp(input); pipeline.clone().resize(a)...; pipeline.clone().resize(b)...`. `clone()` snapshots a shared decoded input and applies independent operation chains. The existing code ALREADY uses `base.clone()` safely on the 10-bit AVIF fallback path (line 1146). So a `decode-once-per-format` refactor is:

```js
const formatPipeline = sharp(processingInputPath, {...}); // ONE decode
if (needsRgb16) formatPipeline.pipelineColorspace('rgb16');
for (const size of sortedSizes) {
    await formatPipeline.clone().resize({ width: resizeWidth })...toFile(outputPath);
}
```

This cuts decodes from `formats × sizes` to `formats` = **3 decodes per image** (one per format), an ~6-8x reduction in the decode portion. The encode cost is unchanged (still one encode per size).

**Why the deferral is partially defensible — and why I still recommend doing it:**
- The CLAUDE.md/WI-14 cross-format reasoning is correct but addresses a DIFFERENT axis (parallel formats), not within-format clones. The within-format clone is safe.
- INFO-R6C1-10: because `sharp.cache(false)` and mmap-via-path are set, the 18 decodes do NOT pin 18 buffers in heap — RSS stays bounded. So this is a CPU/IO cost (decode is the expensive half of Sharp), not an OOM risk. That makes it genuinely LOW-urgency for a personal-gallery single-image upload.
- BUT: under the in-app backfill (which re-runs this on the WHOLE gallery), decode cost dominates wall-clock and CPU. For a 7680px source, decode is ~hundreds of ms; ×18 ×gallery-size is the difference between a backfill finishing in minutes vs hours, and directly competes for the CPU the live site needs (ties into ARCH-R6C1-05).

**Recommendation:** Implement decode-once-per-format with `clone()`. It is low-risk (the clone pattern is Sharp-canonical and already used on the fallback path), preserves cross-format isolation (still a fresh top-level pipeline per format), and the WI-14 invariant is untouched. Confidence: **High** on safety and on the decode-count math.

**Trade-off:** Slightly higher peak RAM *within* one format's loop because the decoded source stays resident for the format's duration instead of being freed after each size. With `sharp.cache(false)` and mmap this is the mmap'd source, not a heap copy — negligible. The rgb16 path (line 1091-1097) doubles working memory during resize regardless; decode-once does not change that per-resize peak.

---

### PERF-R6C1-04 (MED) — getImage prev/next range scans run on EVERY photo view (revalidate=0)

`getImage` (data.ts:923) is invoked per `/p/[id]` render, and public photo pages set `revalidate = 0` (CLAUDE.md "Public route freshness" — confirmed by the page using `getImageCached` with no ISR). React `cache()` dedupes WITHIN a request (metadata + body share one result), but provides **zero cross-request caching** — every distinct visitor / crawler hit re-runs:
1. The image+topic JOIN (PK lookup, cheap).
2. `Promise.all` of: tags JOIN, **prev range scan**, **next range scan**.

The prev/next queries (lines 1024-1060) are `OR(...)`-of-range-predicates over `(capture_date, created_at, id)` with `LIMIT 1`, leaning on the `(processed, capture_date, created_at)` composite index (CLAUDE.md). For a gallery of N images these are index range scans, not full scans — but they run **3 concurrent connections per view, uncached, forever**.

**Concrete load scenario:** a shared photo or a crawler walking `/p/1`…`/p/N` generates N×(1 + 3-concurrent) connection acquisitions with no cache amortization. This is precisely the live-traffic pressure that AGG-5's reserve is defending against — and it confirms the backfill-vs-live tension is real, not theoretical. The pool (10) plus queueLimit (20) gives 30 in-flight ceiling; a modest crawler burst + a running backfill (5 held) can saturate it.

**Mitigation:** (a) Collapse prev+next into a single round-trip (two `LIMIT 1` subqueries `UNION ALL`, or a windowed query) so a render peaks at 2 conns not 3. (b) Consider a short cross-request cache for prev/next IDs keyed on the image's sort position — these only change when images are added/deleted/reordered, which is admin-rare. The `revalidate=0` policy exists for processing/metadata freshness, but prev/next NAVIGATION links are far less freshness-sensitive than the image itself. Confidence: **Medium** (the index makes each scan cheap; the issue is aggregate uncached connection pressure, which is workload-dependent).

---

### ARCH-R6C1-05 (MED) — Backfill and live queue contend for Sharp/libheif with no shared CPU budget

Two independent PQueues call `processImageFormats`:
- Live: image-queue.ts:166, `concurrency = QUEUE_CONCURRENCY || 1`.
- Backfill: admin-backfill-runner.ts:591, `concurrency = resolveBackfillConcurrency(ADMIN_BACKFILL_CONCURRENCY || 1)` = up to 2 at the shipped pool.

The DB-pool side is now coordinated (AGG-5 cap + per-image advisory lock serializes the SAME image). But **the CPU/thread side is not.** `sharp.concurrency(floor((cores-1)/3))` (process-image.ts:44) is a per-call libvips thread cap sized for ONE processImageFormats call's 3-format fan-out. With live QUEUE_CONCURRENCY=1 AND backfill concurrency=2 both calling processImageFormats simultaneously, you get up to **3 concurrent processImageFormats calls × 3 formats × `floor((cores-1)/3)` threads** — which re-multiplies back above `(cores-1)` and oversubscribes the CPU and the libuv threadpool that Sharp uses. The `/3` divisor (line 42-44 comment) explicitly assumes ONE image in flight; it does not account for a second queue.

The per-image advisory lock prevents two workers double-encoding the SAME row, but the live queue claims `processed=false` and the backfill claims `processed=true` rows — **disjoint sets**, so the lock never makes them wait on each other for DIFFERENT images. They genuinely run concurrently.

**Risk (concrete):** during an active upload batch, an admin clicks "Re-encode existing photos." Now N+2 images encode at once, libvips threads oversubscribe cores, both the upload's user-visible processing AND the backfill slow down, and live request-thread starvation degrades page TTFB. On the 16 GB Mac mini #3 (4-8 cores typical) this is a realistic responsiveness hit.

**Mitigation:** Either (a) gate the backfill to pause/yield while the live queue has pending jobs (`state.queue.size + pending > 0`), or (b) recompute `sharp.concurrency` to account for total concurrent processImageFormats calls across both queues, or (c) document that backfill should not run during active uploads (weakest). Confidence: **Medium** — depends on core count and QUEUE_CONCURRENCY; on a 1-core-after-divisor host the effect is muted, on 8 cores it's pronounced.

---

### PERF-R6C1-06 (LOW) — Backfill does one EXTRA full decode per row for color detection

In `reprocessOne` (admin-backfill-runner.ts:472-478), after `processImageFormats` has already decoded the original 18+ times, the runner opens **another** `sharp(originalPath, {...})` purely to read metadata + run `detectColorSignals`. That's one more full-file decode per row. The live upload path has the same shape, but on a whole-gallery backfill it's N extra decodes.

**Fix:** `processImageFormats` already decodes the source; if it returned the detected signals (or accepted a pre-built metadata object), the separate detection decode could be elided. This is a cross-caller refactor (the inline comment at process-image.ts:980-983 explicitly declines a similar metadata-plumbing change as "not worth the cross-caller risk" for single uploads) — but for the backfill it compounds. Lower priority than PERF-R6C1-03; fold into the same decode-consolidation work if done. Confidence: **High** on the extra decode existing; **Low** on urgency.

---

### ARCH-R6C1-07 (LOW) — View-count buffer is process-local singleton (reconfirmed, documented)

data.ts:17-156: `viewCountBuffer`, `viewCountRetryCount`, `viewCountFlushTimer`, `consecutiveFlushFailures`, `isFlushing` are module-level mutable singletons. The atomic-swap-on-flush (line 95-96), bounded buffer (MAX_VIEW_COUNT_BUFFER_SIZE=1000), retry cap (VIEW_COUNT_MAX_RETRIES=3), and exponential backoff are all correctly implemented for the **single-writer** topology. CLAUDE.md already documents this as best-effort approximate analytics not safe under horizontal scale. **Reconfirmed: there is no runtime guard that would prevent silent miscounting if the web service were scaled to 2+ instances** — it relies entirely on operational discipline. No change recommended (matches documented design), but flagging that the in-memory-singleton pattern (here, rate-limit maps in auth-rate-limit.ts, the PQueue state, restore-maintenance flags) is the single largest barrier to horizontal scale, and it is spread across several modules with no central "single-writer assertion." Confidence: **High**.

---

### PERF-R6C1-08 (LOW) — Serving-path settings-hash cold-start blocks concurrent first requests

serve-upload.ts:50-83: `getServingColorSettingsHash` is a correct module-global TTL+SWR cache. After first resolution it never blocks (stale-while-revalidate). The only blocking path is a true cold start (`servingHashCache === null`): all concurrent requests `return servingHashInflight` and await the single in-flight resolution (line 82). That's the intended dedupe (one DB SELECT for the burst, not one-per-file), and the async body never rejects. Noted only for completeness — on a cold process receiving a masonry paint's worth of derivative requests, they all await one `getGalleryConfig` round-trip, which is correct and bounded. No change needed. Confidence: **Medium**.

---

### PERF-R6C1-09 (LOW) — Bootstrap re-scan: 16-column × 500-row SELECT with up-to-1000-element IN list

image-queue.ts:607-627: each bootstrap pass selects 16 columns × `BOOTSTRAP_BATCH_SIZE=500` rows. With `permanentlyFailedIds` populated (cap MAX_PERMANENTLY_FAILED_IDS=1000), the query appends `notInArray(images.id, [...up to 1000 ids])` (line 601-603), inlining up to 1000 integers into the WHERE clause on EVERY continuation pass (scheduleBootstrapContinuation re-runs until `pending.length < BATCH_SIZE`). For a gallery with many pending + many permanently-failed rows this is a large parameterized IN list re-sent per batch. At personal-gallery scale this is negligible; flagged for completeness and because it scales with failure accumulation, not gallery health. **Mitigation if it ever matters:** a `failed_at IS NULL` column predicate instead of an in-memory NOT IN list would push the filter into the index. Confidence: **Medium**.

---

### INFO-R6C1-10 — Sharp memory/thread budget is correctly tuned (mitigates AGG-14 severity)

process-image.ts:36-53: `sharp.concurrency(floor((cores-1)/3))` divides the libvips thread cap by the 3-format fan-out so one image stays near `(cores-1)` threads; `sharp.cache(false)` (line 53) prevents libvips from pinning operation-result buffers in heap (every UUID filename is a cache miss anyway); inputs are opened via file path so Sharp mmaps/streams instead of buffering on the V8 heap. **Consequence for AGG-14:** the 18-24 decodes are sequential-within-format and do not accumulate heap buffers, so the per-size re-decode is a CPU/IO cost, not an OOM risk. This is why AGG-14 is correctly a LOW perf item rather than a memory CRITICAL — and why PERF-R6C1-03's decode-once optimization is about wall-clock/CPU (especially during backfill), not RSS. Verified sound.

---

### INFO-R6C1-11 — No layering violations

- `src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — both are server-only modules; a server lib calling a server action's auth helper is acceptable (it is not a client→server or lib→client-component leak).
- `src/components/home-client.tsx:13` and `load-more.tsx:6` import from `@/lib/data` but ONLY `import type { ImageListCursorInput }` — type imports are fully erased at compile time, so there is no runtime bundling of the server-only `data.ts` (with its `@/db` import) into the client. No leak. Verified sound.

---

### INFO-R6C1-12 — AGG-9 (a11y) and SW_VERSION changes are correct

- error.tsx:22-30 (AGG-9): the large decorative glyph at `text-muted-foreground/30` (~1.5:1 contrast) was previously the `<h1>`, so the accessible name rode on sub-WCAG text. The split — `<span aria-hidden="true">` for the visual + `<h1 className="sr-only">` for the accessible name — is the correct pattern and matches the public twin. `aria-labelledby="admin-route-error-title"` still resolves to the h1's id. No regression.
- sw.js:26: SW_VERSION bumped `5b5de9d3-p7` → `8b979687-p7`, correctly tracking the latest commit short-SHA + pipeline version, invalidating all SW cache namespaces (IMAGE/HTML/META). This is the documented `prebuild` stamp behavior. Both verified sound; no perf/architecture concern.

---

## Final sweep — files confirmed reviewed

`admin-backfill-runner.ts` (full), `db/index.ts` (full), `image-queue.ts` (full), `process-image.ts` (decode loop 980-1290 + concurrency setup 36-119), `data.ts` (view-count buffer 1-156, getImage 923-1074, tagNamesAgg/Promise.all sites), `gallery-config.ts` (full) + `gallery-config-shared.ts` (size cap), `serve-upload.ts` (full), `home-client.tsx` (masonry/useColumnCount — CSS-columns layout + RAF-debounced resize, no JS reflow storm), `photo-viewer.tsx` (state surface — client-nav re-renders gated on currentImageId, no mousemove-driven setState found; ImageZoom is ref-based per CLAUDE.md), `histogram.tsx` (Worker-offloaded O(n), 256px cap, lazy-mounted via lightbox-color-pip), `auth-rate-limit.ts` (bounded maps), page render fan-out (`/p/[id]`, `(public)/page.tsx`, `[locale]/layout.tsx`).

No relevant file skipped. No CRITICAL architectural or performance defect found in the working tree; the AGG-5 change is correct in code but leaves stale operator-facing documentation (ARCH-R6C1-01), and the real performance leverage is the per-size decode multiplication (PERF-R6C1-03) and the uncached connection-hungry photo path (PERF-R6C1-04) that the backfill cap is fundamentally fighting (ARCH-R6C1-02).
