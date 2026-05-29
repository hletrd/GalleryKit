# Perf Reviewer — Run-2 Cycle 3 (HEAD 420b7852)

Angle: performance, concurrency, CPU/memory/UI responsiveness.

## Files examined
serve-upload.ts, image-queue.ts, feed.xml, sitemap.ts, og routes, db-actions.ts (CSV/backup/restore), rate-limit.ts.

## Findings
NONE net-new actionable.

### Verified-clean / notes
- `serve-upload.ts`: `getGalleryConfig()` + `getColorSettingsHash()` run on every image request including the 304 path. This is a per-request DB-config read on the hot image path. HOWEVER `getGalleryConfig` is React-`cache()`-deduped within a render and the settings hash is a cheap SHA-256 over a handful of fields; the existing cycle history (R8-H1/P4-E2) accepted this cost as the price of settings-hash cache invalidation. Not a regression; not actionable.
- `image-queue.ts`: bootstrap caps at `BOOTSTRAP_BATCH_SIZE=500` with cursor continuation on `queue.onIdle()` — bounded memory. Retry maps capped at `MAX_RETRY_MAP_SIZE=10000` with FIFO prune. `permanentlyFailedIds` capped at 1000. All bounded. Parallel `verifyFile` via `Promise.all`. Correct.
- `feed.xml`: `FEED_LIMIT=50`, conditional 304 via `isFeedNotModified`, `s-maxage=1800` CDN cache. Bounded.
- `sitemap.ts`: ISR `revalidate=3600` (force-dynamic correctly dropped in AGG8F-02); image budget math caps at `MAX_SITEMAP_URLS=50000`. Bounded.
- OG routes: per-IP rate limit (30/min) on the CPU-bound Satori→Sharp pipeline; ETag 304 short-circuit avoids re-render. Correct posture.
- `exportImagesCsv`: 50K row cap, `results.length = 0` to release the array before joining the CSV string. Documented ~15-25MB peak. Acceptable for personal-gallery scale.
- Carryover perf deferrals DEF-02 (page candidate fetch), DEF-03 (batch runner UPDATEs), DEF-04 (atomic progress counters): re-verified, LOW, exit criteria NOT fired. Personal-gallery scale; Sharp encode dominates wall-time at default concurrency 1.

Confidence: High.
