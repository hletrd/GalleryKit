# Performance + Concurrency Review — run-8 cycle-2

**Reviewer:** perf-reviewer (architect agent, performance lane — read-only, Write disabled in-session; this file persisted by the orchestrator for provenance, content verbatim from the agent's returned report)
**Date:** 2026-06-13 · **HEAD:** `77867144` (working tree clean)

## Summary
All prior **AGG-R7-A1..A4** perf/arch dispositions re-confirmed unchanged — no regression. Four findings, one actionable (PERF-1, MED).

## AGG-R7-A* re-confirmed (record-only, no regression)
- **A1** (pool reserve protects one getImage fan-out): `admin-backfill-runner.ts:105-142` — `RESERVED=max(3,ceil(poolLimit/2))`, `cap=max(1,floor((limit−reserved−1)/2))`=2 at limit 10. Matches corrected docblock + `db/index.ts:16-22`.
- **A2 / PERF-03** (decode-once-per-format): `process-image.ts:1052-1097` still opens a fresh `sharp()` per (format×size) — up to ~18 decodes/image; `lastRendered` hard-link dedup (`:1060`) partially mitigates. DEFER stands (scope/CPU-only, **safe** — WI-14 isolation is for PARALLEL formats, not within-format sequential clones).
- **A3** (getImage 3 concurrent scans, revalidate=0): `data.ts:1015-1061` `Promise.all`. Deliberate freshness tradeoff.
- **A4** (backfill PQueue + live queue share libvips): `image-queue.ts:166` + `admin-backfill-runner.ts:596`. Single-writer topology.

## Open / new findings

### PERF-1 — SW blocks on a HEAD round-trip per cached image before serving cached bytes (MED, High) — NEW, the one that matters
`apps/web/public/sw.template.js:207-230`. In `staleWhileRevalidateImage`, when a cached image has an ETag, the code does `const head = await fetch(request.url, {method:'HEAD', headers:{'If-None-Match':cachedEtag}})` **before** every `return cached`. The PERF-R4C9-02 fix made the body GET lazy, but the HEAD validation itself sits on the display path. A warm-cache masonry paint (~30 thumbnails) now waits a network HEAD RTT per tile before painting bytes already in CacheStorage; on a slow/hung network the HEAD can stall up to the fetch timeout (the `catch` at `:227` only falls through to stale-serve *after* it settles), inflating LCP/INP on exactly the offline-resilient surface the SW exists to speed up. The cost/benefit is inverted — a rare admin ETag change is being paid for on every cached image view by every visitor.
**TENSION:** this synchronous HEAD was a DELIBERATE freshness choice (R11-M1/R4C9 comment — serve fresh colors immediately after an admin color-setting change). A full background flip reintroduces a one-paint color-staleness window the comment warns about.
**Fix (recommended):** bound the HEAD with `AbortSignal.timeout(~300ms)` and serve stale on abort — keeps fast-network freshness, removes the worst-case stall. (Alternative: move the ETag check into the background `startRevalidate()` for true SWR — stale colors self-heal next paint — but this contradicts the documented decision and is not recommended without sign-off.)

### PERF-2 — Atom feed `updated_at DESC` sort has no covering index → filesort (LOW, High) — NEW
`data.ts:771-794` (`getImagesForFeed`) orders by `updated_at DESC, created_at DESC, id DESC` filtered on `processed=true`, but the `images` indexes (`schema.ts:114-118`) lead with `capture_date`/`created_at`/`user_filename`/`uploaded_by` — none covers `updated_at`. MySQL filesorts the processed set per request. Bounded by `FEED_LIMIT=50` + route `Cache-Control: max-age=600, s-maxage=1800` (`feed.xml/route.ts:15`), and there is no shipped CDN, so it runs per origin miss. Fix: add `(processed, updated_at, created_at, id)` index, or document the accepted cost. → DEFERRED (plan-334 Deferred 1).

### PERF-3 — `containIntrinsicSize` divides by `image.width` (LOW, latent) — carry of AGG-R7-12
`home-client.tsx:280`. `width===0` → `Infinitypx` (lost CLS reservation for that card). NOT NULL Sharp metadata makes it near-impossible; latent, not live. Guard with a `width>0` fallback. → scheduled plan-333 Item 7.

### PERF-4 — `load-more.tsx` setState-after-unmount (LOW, hygiene) — carry of AGG-R7-10
`load-more.tsx:36-87`. Post-`await` setState block guarded by `queryVersionRef` (stale-query) but not unmount. Production no-op (React 18 dropped the warning); console-noise/hygiene only. → scheduled plan-333 Item 7.

## Swept CLEAN (no action)
No N+1 in admin batch-tag paths (`tags.ts:308` single batched insert); `getSharedGroup` batches tags (`data.ts:1196-1210`). Queue Maps bounded (`image-queue.ts:96-109,477-489`, hourly `unref()` GC). View-count buffer bounded+chunked with backoff (`data.ts:29-188`). Histogram off-main-thread, zero-copy transfer, 256-px cap, abort-on-nav. photo-viewer fully memoized; `getPhotoViewerImageSizes` returns a stable string. home-client masonry rAF-debounces resize, passive scroll listener, `blur_data_url` excluded from listing selects. Pool init awaits the per-connection `group_concat_max_len` promise (`db/index.ts:70-102`).

**Verdict:** one actionable MED (PERF-1, bounded-timeout fix scheduled plan-333 Item 5); PERF-2 deferred; PERF-3/4 scheduled as latent hygiene; all prior A* tradeoffs re-confirmed record-only.
