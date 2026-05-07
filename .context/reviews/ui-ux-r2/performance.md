# GalleryKit Performance Review — Color-Management UI Pass

Reviewer: The Veteran (perf-reviewer)
Scope: ~30 commits, ~4800 LoC delta around color-management, HDR plumbing, tooltip, color-details panel, AVIF histogram switch, service-worker HDR bypass, ICC + CICP detection, encoder, and backfill script.
Premise (locked): photos are uploaded post-edit; no in-browser editor or scoring; the encoder runs on upload only — never on render.

I started hostile. Most of the surface is competent. There is one user-visible perf bug, several memory-budget fumbles in the encoder, a couple of concurrency mistakes, and a fistful of small reconciliations that bleed cycles on touch hardware. Numbers below are estimates from reading the code; instrument before treating them as canonical.

---

## 1. Photo viewer render perf — re-renders, reconciliation, HDR badge, dynamic download menu

`apps/web/src/components/photo-viewer.tsx` is 1031 lines, 27 hook sites in a single component. The top-level `PhotoViewer` carries 9 `useState`s + 6 `useEffect`s + 4 `useMemo/useCallback` + 3 `useRef`s, and the JSX renders the sidebar inline rather than as a memoized child.

[PERF-MED] photo-viewer.tsx:113-1030 — the entire 1000-line component re-renders on every state change.
A keypress that toggles `isPinned` (`'I'` key, photo-viewer.tsx:374-381) re-renders ~25 EXIF rows + 5 color rows + the histogram + the download `DropdownMenu` + the bottom sheet, even though only the layout grid columns and one Card visibility flip. There is no `React.memo` on `Histogram`, `InfoBottomSheet`, `Lightbox`, or `PhotoNavigation`. Estimated cost on a 60Hz frame budget: ~6-12ms per `setIsPinned` toggle on a Pentium III-class CPU profile (modern phones land at ~1-2ms). The memoized `srcSetData` (photo-viewer.tsx:387-445) and `blurStyle` (photo-viewer.tsx:202-211) are good — but `photoViewerSizes`, `downloadFilename`, `downloadExt`, `downloadHref`, `avifDownloadHref`, `hdrAvifFilename`, `hdrDownloadHref`, `isWideGamutSource`, `formattedCaptureDate`, `formattedCaptureTime` (photo-viewer.tsx:222-242) are recomputed every render. Cheap individually but they all run unconditionally per render.

[PERF-LOW] photo-viewer.tsx:213-219 — `document.title` write on every change of `normalizedDisplayTitle` or `siteTitle`. The dependency includes `siteTitle` which is a stable prop, so this only fires when the photo changes — fine. Listed for completeness because writing `document.title` triggers a tab/title repaint.

[PERF-LOW] photo-viewer.tsx:336-339 — `router.replace(...)` inside an effect on every `image` change when `syncPhotoQueryBasePath` is set (shared view). With slideshow auto-advance at 5s intervals, this calls `history.replaceState` every 5s — cheap but wakes the URL bar handler. Acceptable.

[PERF-LOW] photo-viewer.tsx:241-242 — `formatStoredExifDate` / `formatStoredExifTime` rebuild Intl formatters per render unless internally cached. Worth checking; if `Intl.DateTimeFormat` is recreated each call, it is ~50µs each, twice per render.

Net for #1: re-renders are not catastrophic — the component is heavy but the inner `<picture>` is memoized. The biggest win is splitting the sidebar Card into a separate `React.memo` component keyed on `image.id`, isolating the Histogram and the dropdown so the keyboard `'I'` toggle doesn't re-walk a thousand-line tree.

---

## 2. AVIF histogram switch — feature-detect cadence, P3 canvas memory

`apps/web/src/components/histogram.tsx` looks careful at first read but has two real issues.

[PERF-MED] histogram.tsx:247-252 — the AVIF probe runs on every `Histogram` mount, not once per session. On the public photo page each navigation unmounts + remounts the histogram (the photo viewer recreates the histogram with a new `imageUrl` prop on every photo change because the `<Histogram>` element is rendered inline and image-keyed). A 1x1 AVIF data URL decode is fast (~1-3ms on a phone), but the `Image` object plus `setAvifSupported(false)` initial state means the first histogram render of every photo navigation falls back to the JPEG URL until the probe completes asynchronously. Net: every photo load wastes one JPEG fetch that is immediately replaced by an AVIF fetch ~3ms later — a guaranteed double-fetch on every navigation for wide-gamut images. Roughly a 200-400 KB extra JPEG download per photo on a wide-gamut roll. Move the probe into a module-level `Promise<boolean>` singleton so it runs once per page load.

[PERF-LOW] histogram.tsx:254-257 — `supportsCanvasP3` evaluates `window.matchMedia('(color-gamut: p3)')` on every render of the function body. matchMedia is cheap (~5µs) but unnecessary; lift to module-level memoization or a `useMemo`.

[PERF-MED] histogram.tsx:115-148 — the canvas is capped at 256x256 (good), but `getImageData` is called on the main thread before posting to the worker. For a 256x256 RGBA buffer that's 256KB — fine, but `imageData.data.buffer` is then transferred (line 102) so the buffer becomes detached. That detachment is correct and zero-copy. No memory leak. The issue is that the AVIF source path is now a separate `Image` decode entirely from the `<picture>` element on the same page — meaning the same AVIF is decoded TWICE: once for display (via `<picture>` in photo-viewer), once for histogram (via `new Image()` here). On a 4MP P3-tagged AVIF, that's roughly 16 MB of decoded RGBA each, peaking at 32 MB during overlap. Acceptable on modern phones, painful on 4 GB Android. There is no shared decode path; the browser may still de-duplicate via the HTTP cache, but the decoded pixels are not shared.

[PERF-LOW] histogram.tsx:115 — `document.createElement('canvas')` on every histogram compute. Reuse a single canvas via ref to dodge GC churn.

[PERF-LOW] histogram.tsx:265-272 — `modeLabels` is rebuilt every render (5 string lookups via `t()`). Move into a `useMemo([t])` or skip entirely; the cost is ~3µs.

---

## 3. `<picture> media="(dynamic-range: high)"` — what does the browser do when the URL 404s?

[PERF-CRIT] photo-viewer.tsx:413-420, lightbox.tsx:418-425, home-client.tsx:282-289 — this is the headline bug.

The `<source media="(dynamic-range: high)" srcSet="…_hdr_640.avif 640w, …">` is rendered any time `HDR_FEATURE_ENABLED && image.is_hdr`. But `HDR_FEATURE_ENABLED` is a build-time env flag (`feature-flags.ts:10`) and the upstream encoder for HDR variants is explicitly not yet implemented (per the user's premise: "encoder deferred"). So if `NEXT_PUBLIC_HDR_FEATURE_FLAG=true` is ever set in any environment without HDR encoder output, every HDR-capable display renders the `<picture>` element, the browser picks the highest-priority matching `<source>` (this one, because `(dynamic-range: high)` matches), and issues a fetch for `…_hdr_<size>.avif`.

That URL doesn't exist. The browser will:
1. Fetch the URL — 404.
2. Per the `<picture>` spec, when the chosen source fails to load, the user agent **does not fall back to the next `<source>`**. It falls back to the `<img>` element only. So the browser fires the 404 *and* fires the JPEG fallback fetch, skipping AVIF and WebP entirely on HDR-capable devices.
3. Service-worker tries the request, sees `_hdr.avif` in the path, and intentionally bypasses cache (sw.js:42-46, 261-262), so each navigation re-issues the 404 — *no negative caching at the SW layer*.

Net cost on a P3 + HDR display (modern iPhone, MBP M-series external HDR display): every photo navigation issues N 404s (one per `srcSet` candidate the browser actually tries, typically 1-2 based on viewport size), abandons AVIF entirely, downloads the full JPEG instead of the AVIF (3-5x larger), and does this repeatedly because SW bypasses cache. Estimated bandwidth waste: 200-800 KB per HDR-display photo navigation in the worst case. The browser will not retry AVIF after the HDR source 404s — the spec is firm on this.

Recommendation flag: gate the `<source media="(dynamic-range: high)">` element on a runtime existence check (the photo-viewer already does this for `hdrExists` for the download menu — same pattern is needed for the `<picture>` source) OR keep `HDR_FEATURE_ENABLED=false` until the encoder ships. The flag system is fine; the call sites need to honor it.

[PERF-HIGH] sw.js:261-263 — `isHdrVariant(pathname)` returns true and the SW returns from the fetch handler (`return`), letting the browser handle the request. That means HDR variants never get cached, never get coalesced. With the `<picture>` 404 problem above, every page-navigation worst-case repeats the same 404. A cleaner contract is for the SW to respond with a synthetic 404 for HDR paths until the encoder lands, so the browser caches the negative result and stops asking. Pure pass-through means every load asks again.

---

## 4. Tooltip mounting cost

`apps/web/src/components/ui/tooltip.tsx` is the standard Radix shadcn pattern. Every `<Tooltip>` wraps its children in its OWN `<TooltipProvider>` (line 25-28). That is a Radix anti-pattern.

[PERF-LOW] tooltip.tsx:21-29 — for the photo viewer there is exactly ONE `<Tooltip>` on the entire page (photo-viewer.tsx:847-856). One provider, one trigger, one portal — total DOM cost is negligible. `TooltipPrimitive.Content` is wrapped in `Portal` (line 44), so the popup DOM nodes don't exist until hover/focus. The portal renders only the `<TooltipPrimitive.Trigger>` (line 32-35) eagerly; the content is mounted on `data-state=open`. That is correct lazy mounting.

The structural issue is that wrapping every `Tooltip` in its own `TooltipProvider` means a new React context per tooltip. Radix specifically warns against this in its docs: place `<TooltipProvider>` once near the app root and let all tooltips share its delay timer. The current pattern works but spawns ~1 KB of context state per tooltip and prevents shared `delayDuration` inheritance. With one tooltip on the photo viewer this is invisible. If the admin surface or pages grow to 10+ tooltips, lift the provider to the root layout.

[PERF-LOW] photo-viewer.tsx:847-856 — the tooltip is rendered unconditionally inside the color details panel. Since the panel itself is conditional on `(image.color_primaries || image.is_hdr)` (line 838), the tooltip only mounts when color metadata exists. Acceptable.

Initial-DOM-size impact: zero before hover. Bundle impact addressed in #8.

---

## 5. Color details panel — admin-only conditional render correctness

[PERF-LOW] photo-viewer.tsx:838-894 — the entire color-details collapsible is gated on `(image.color_primaries || image.is_hdr)`. For a non-admin photo, only the `color_pipeline_decision` row inside is admin-gated (line 872-877). The full collapsible mounts for all visitors, which is correct because non-admin still want to see "Display P3" and "PQ" info.

[PERF-LOW] photo-viewer.tsx:872 — the admin-only field correctly checks `isAdmin && image.color_pipeline_decision`. That field arrives in `publicSelectFields` (data.ts:213), which means it is fetched for all viewers but only rendered for admins. See section #15 — the field flows down for everyone, wasting ~30 bytes/row over the wire on public listings. Not catastrophic. Worth flagging.

[PERF-LOW] photo-viewer.tsx:858-892 — when the panel is collapsed (`!showColorDetails`), the inner `<div>` is not rendered (`{showColorDetails && (...)`). Correct lazy DOM behavior. No wasted hooks because the `<style>` block (line 880-885) only renders when `image.is_hdr` AND the panel is open.

Verdict: the admin-only path correctly does not mount admin-only DOM. The data layer over-fetches by a few bytes; not a render-time concern.

---

## 6. Download menu — split-button mounting cost

[PERF-LOW] photo-viewer.tsx:940-996 — the dropdown only mounts when the photo is wide-gamut AND has an AVIF derivative AND has no paid-license tier. Otherwise a plain `<Button asChild>` link is rendered. The Radix `<DropdownMenu>` content is portal-mounted lazily on click (Radix default). So the menu's actual `<DropdownMenuItem>` rows do not exist in the DOM until interaction. Correct.

[PERF-MED] photo-viewer.tsx:230-240 — the `HEAD` probe for the HDR variant existence runs an unconditional `fetch(hdrDownloadHref, { method: 'HEAD' })` whenever `image.is_hdr` is true and `hdrDownloadHref` is set. With the encoder deferred, this 404s every time on every photo navigation. The `useEffect` dependency array is `[hdrDownloadHref, image?.is_hdr]`, so the probe re-fires on each photo change. That is one wasted network round-trip per photo, ~50-300ms cost depending on RTT, hitting the same 404 over and over. Service-worker bypass means the response is not cached either. Same fix as #3: gate on a runtime detection or cache the negative result.

[PERF-LOW] photo-viewer.tsx:954-984 — the dropdown's three menu items mount only when the menu is opened (Radix portal). Each item is a plain `<a>` with a known download href; there is no fetch on hover.

---

## 7. Service worker cache — HDR bypass scope

[PERF-MED] sw.js:42-46, 261-263 — `isHdrVariant(pathname)` matches `pathname.includes('_hdr.avif')`. That is overly broad. Any user-uploaded original named `family_hdr.jpg` is fine because the check requires `.avif`. But a hypothetical AVIF derivative whose UUID happens to contain the substring `_hdr` (vanishingly unlikely with crypto.randomUUID, but possible) would also bypass. Acceptable — `crypto.randomUUID()` produces only `[0-9a-f-]` so `_hdr` cannot appear in the UUID. Safe.

[PERF-LOW] sw.js:264 — `event.respondWith` is not called for HDR paths. The fetch event handler returns without calling respondWith, falling through to default browser behavior. Correct.

The real question: with the HDR variants 404'ing (because the encoder is deferred), the SW bypass means every photo nav re-incurs the 404 round-trip. See #3.

Verdict: the bypass logic is correct. The interaction between bypass and missing encoder is the bug.

---

## 8. Bundle size impact

[PERF-MED] feature-flags.ts is 10 lines (~427 bytes). It exports a single boolean built at compile time. This will tree-shake correctly because it's a `const` from `process.env`, so when `NEXT_PUBLIC_HDR_FEATURE_FLAG !== 'true'`, the entire `<source>` JSX block in three components is dead code. Webpack/Next will eliminate it. Verify with `next build --profile` and a webpack-bundle-analyzer pass — TerserPlugin generally folds `const X = false; if (X && …)` reliably but not always at JSX tree level. If `NEXT_PUBLIC_HDR_FEATURE_FLAG` flips at build time the build cache must be cleared.

[PERF-LOW] icc-extractor.ts is 91 lines and imports only `TextDecoder` (browser global) and Buffer (node-only). The `Buffer.isBuffer` and `Buffer.byteLength` make it a server-only module. Verify it does not get bundled into the client. The reachable callers are `process-image.ts` (server) and `color-detection.ts` (server). The photo-viewer imports nothing from this file directly. Tree-shaking should keep it server-side. Worth a quick `next build` check that confirms no `icc-extractor` chunk lands in the client.

[PERF-LOW] color-detection.ts is 285 lines, imports `fs/promises`, `sharp`. Server-only. Confirm via build output.

[PERF-LOW] tooltip.tsx pulls in `@radix-ui/react-tooltip`. Radix tooltip is ~10 KB minified. Adds about 4-5 KB gzipped to the photo viewer chunk. Acceptable for a self-hosted gallery; on a strict mobile budget it would warrant lazy-loading the color details Card via `dynamic(() => …, { ssr: false })`.

[PERF-MED] Net client bundle delta from this work: ~5-8 KB gzipped (Radix tooltip + the new humanize/colorPipeline/HDR strings + 5 new humanize functions in photo-viewer.tsx). Within reasonable bounds.

---

## 9. Image queue worker concurrency — does the WI-15 cap actually fire on a 100MP wide-gamut source?

[PERF-MED] process-image.ts:660-672 — `WIDE_GAMUT_MAX_SOURCE_WIDTH = 6000`. The cap is on width only, not pixel count. A 100MP image is approximately 12000x8000 (or 16000x6250). Both have width >= 6000, so the cap fires and downscales to 6000-wide before fanning out. But a 9999x10000 pano (99.99 MP) has width < 6000? No — width 9999 > 6000, fires. Good. A 5999x16000 image (96 MP) has width 5999, does NOT fire. That goes straight into the `pipelineColorspace('rgb16')` path at full resolution. 5999*16000 pixels * 6 bytes/pixel (rgb16) ≈ 575 MB peak heap on the wide-gamut resize. That is a real OOM risk on a small VPS. Cap should be on pixel count, not width.

[PERF-MED] process-image.ts:660-672 — the cap creates a temporary file `inputPath + '.wi15.tmp'` and then opens THAT file in the rgb16 path (line 727-732). For wide-gamut sources, the original is read TWICE: once to write the downscaled tmp, then for each format encoder. With three formats fanned out in parallel (line 842-846), the tmp is read THREE times in parallel. On a slow disk + a 6000-wide intermediate AVIF (~30 MB), that's ~90 MB of disk reads in parallel. Acceptable on SSD; painful on a network-mounted volume.

[PERF-LOW] process-image.ts:28 — `maxConcurrency = Math.max(1, Math.floor((cpuCount - 1) / 3))` — divides by 3 for the AVIF+WebP+JPEG fan-out. Sensible. On an 8-core box: `(8-1)/3 = 2`. Combined with `QUEUE_CONCURRENCY=1` default, peak threads at any time ≈ 2*3 = 6 worker threads + 1 main = 7. Within libuv default 4 threads — wait, libuv default thread pool is 4. Setting `sharp.concurrency(2)` requests 2 per Sharp call but Sharp uses its own thread pool (libvips), not libuv. Confirmed safe.

[PERF-LOW] process-image.ts:53-79 — `_highBitdepthAvifProbePromise` singleton is correct concurrency-safe pattern. Won't double-probe.

[PERF-LOW] process-image.ts:758-783 — when a wide-gamut AVIF encode fails specifically with a `bitdepth` error, the code falls back to 8-bit by calling `base.clone()` again. But `base` was already partially used for the failed `.avif().toFile()` invocation. Sharp pipelines are immutable until `.toFile()` is called, so `base.clone()` is correct — but it pays for the rgb16 resize TWICE on the failure path. Rare path, acceptable.

[PERF-LOW] process-image.ts:842-846 — `Promise.all` for AVIF+WebP+JPEG. For a wide-gamut source with `needsRgb16`, each format fork reads `processingInputPath` independently and runs its own rgb16 pipeline (line 727-732). That's THREE independent rgb16 resizes in parallel. Memory peak is roughly 3 * (6000 * resize_height * 6 bytes). At a 16:9 6000x3375 frame, that is 6000*3375*6*3 = 364 MB peak heap. On a 1 GB RAM container, this is the real OOM risk, not the 100 MP source.

Throughput estimate post-cap on an 8-core 16GB box, single 100MP wide-gamut input:
- Pre-cap (no WI-15): would attempt 100MP rgb16 resize, almost certainly OOM at ~3.6 GB peak, kernel SIGKILL.
- Post-cap (WI-15 fires): downscales to 6000-wide first (~10s), then fans out 3 rgb16 encodes (~15-25s total wall). Net: a 100MP wide-gamut photo lands in ~30s with peak RSS ~500 MB. Survivable.

A proper fix would be a single-shared rgb16 staging file the three formats consume, instead of three independent rgb16 pipelines.

---

## 10. Backfill script — N+1 query risk, memory on a large gallery

[PERF-MED] backfill-color-pipeline.ts:126-133 — fetches every candidate row in a single query. No pagination. On a 100k-image gallery with 80k unprocessed at v5, the result set materializes as one big array (line 134, `rows as unknown as ImageRow[]`). At ~8 fields * 50 bytes = ~400 bytes per row, 80k rows ≈ 32 MB heap. Acceptable for this purpose but could be streamed for very large catalogs.

[PERF-LOW] backfill-color-pipeline.ts:151-172 — concurrency-2 PQueue with one DB UPDATE per row (line 157-159). That's a per-row UPDATE — not strictly N+1 because it's not nested inside another query, but it is one round-trip per image. For 80k rows at ~5ms each over a network: 80k * 5ms / 2 concurrent = 200s of DB time alone. Acceptable for one-shot operator script. Could batch via `WHERE id IN (1,2,3,…)` chunks of 1000 to cut to ~80 round-trips. Low priority, since backfill is offline.

[PERF-LOW] backfill-color-pipeline.ts:151 — `for (const [index, row] of rows.entries()) { queue.add(...) }` — this enqueues all rows immediately, which is fine for PQueue (which queues internally) but means the full 80k-row array is held in heap until queue drains. Combined with the row materialization above, peak heap is ~32 MB plus PQueue's ~80k closures. Not a problem at this scale.

[PERF-LOW] backfill-color-pipeline.ts:152-171 — the inner `await reprocessRow(row)` calls `processImageFormats(...)` which spawns Sharp threads. With concurrency 2 outer + 6 Sharp threads per call = up to 12 concurrent Sharp threads. The default Sharp concurrency cap (process-image.ts:28) divides by 3, so realistically up to ~6 threads per worker. On a 4-vCPU VPS that swamps the box. Set `BACKFILL_CONCURRENCY=1` for production runs if the live web is sharing the box.

---

## 11. Masonry grid layout perf — clamp column count, restore scroll position

[PERF-LOW] home-client.tsx:184-188 — `Math.min(itemCount, N)` for each breakpoint. Cheap. The only side effect is that with `itemCount=0`, the resulting className is `columns-0`, which doesn't exist in Tailwind's safelist. Verify the classNames are in the safelist (the CLAUDE.md mentions a `py-0.5` safelist fix; same family of issue). If `columns-0` is missing, the browser falls back to `columns: auto` and renders zero items in one column — visually fine because itemCount=0 also means no items to render. No real harm.

[PERF-MED] home-client.tsx:133-158 — scroll restore uses three sequential RAF + 100ms timeout strategy. That's three `scrollTo` calls on first render, all firing the scroll handler (line 169-176), which sets `showBackToTop` 4 times in 100ms. With `setShowBackToTop(prev => prev === shouldShow ? prev : shouldShow)`, the conditional bails when value is unchanged — good, no extra renders. Net cost is fine.

[PERF-LOW] home-client.tsx:20-57 — `useColumnCount` uses RAF-debounced resize. Correct. One state update per resize burst.

[PERF-LOW] home-client.tsx:237-345 — `orderedImages.map()` renders a `<picture>` with two AVIF sources, one WebP, one JPEG `<img>` per card. For a 60-image masonry, that's 60 * 4 = 240 source elements. The HDR source (line 282-289) is rendered inline only when `HDR_FEATURE_ENABLED && image.is_hdr`. Same risk as #3: HDR `<source>` triggers fetches on HDR-capable devices but the URL doesn't exist. On the homepage with 60 images, that is potentially 60 wasted 404 fetches per page load on an HDR-capable device. Magnify by every load-more bump.

[PERF-LOW] home-client.tsx:117 — `setAllImages(prev => [...prev, ...newImages])` allocates a new array on every load-more. On a 1000-image gallery this becomes a 4 KB allocation per page. Negligible.

[PERF-LOW] home-client.tsx:255-259 — `containIntrinsicSize: auto Npx` is set per card. Good — primes content-visibility for fast scroll. Verify the parent uses `content-visibility: auto`. Looking at the className string on line 252-254, it doesn't. Add `content-visibility-auto` (Tailwind plugin) on the masonry-card wrapper if browser support is acceptable — not all builds expose this Tailwind class.

Layout thrash on first render: minimal. The masonry uses CSS columns which lays out in a single pass. The biggest hazard is the scroll restore triggering 3 RAF + 1 timeout firing back-to-back — could be 4 scroll-handler calls in 100ms. With the early-bail in `setShowBackToTop`, this is a non-event.

---

## 12. Translation file size

[PERF-LOW] messages/en.json = 35 KB (uncompressed), messages/ko.json = 43 KB. Both are 794 lines. Korean is heavier because UTF-8 encoding of Korean syllables averages 3 bytes/char vs 1 for ASCII English. Gzipped: en ~9 KB, ko ~12 KB. Per-locale loading via next-intl is correct (only the active locale is shipped). 24 new lines per file is +4-5 KB uncompressed, +1 KB gzipped per locale.

[PERF-LOW] If next-intl is configured to ship the JSON inline via Server Components, the messages are tree-shakable per route. If client components call `useTranslation()` they consume the full bundle for the active locale. With ~9 KB gzipped, this is fine — not worth code-splitting. Worth flagging only if either file crosses ~50 KB gzipped.

---

## 13. Lighthouse / Core Web Vitals

[PERF-MED] LCP — the photo viewer renders `<picture>` with `loading="eager"` and `fetchPriority="high"` (photo-viewer.tsx:440-441). The blur background (line 642 via `blurStyle`) shows immediately. With Next.js `<Image priority unoptimized>` fallback when WebP/AVIF basenames are missing (line 397-407, the path that uses NextImage). LCP target is the photo `<img>` in `<picture>`. The HDR `<source>` 404 problem (#3) directly damages LCP on HDR devices because the chosen-but-failing `<source>` causes the browser to fall back to JPEG (3-5x larger) without trying WebP/AVIF first.

[PERF-LOW] FID/INP — keyboard shortcuts and the `'I'` toggle re-render the whole component (#1). On a Pentium III-class profile this is borderline (10ms+ for a state-driven re-render), on modern phones it's negligible. INP target on mobile (200ms) is comfortable.

[PERF-LOW] CLS — masonry grid uses explicit `aspectRatio` (home-client.tsx:256) and `containIntrinsicSize` (line 258), so cards reserve their final size before image decode. CLS should be near zero. The collapsible color details panel (photo-viewer.tsx:858) inserts content below the EXIF grid when expanded — that pushes the histogram and download button down and can trigger CLS if a user expands during load. Acceptable since it's user-initiated.

[PERF-LOW] photo-viewer.tsx:880-885 — inline `<style>` tag for the HDR badge re-renders every time the color details panel opens. Three runs of the CSS parser per open-close cycle. Inline style tags inside React tree are a known CLS hazard. Cost is sub-millisecond, but lifting the style to a global stylesheet is cleaner.

---

## 14. Animation / transition — GPU acceleration

[PERF-LOW] photo-viewer.tsx:600-602 — main grid uses `transition-all duration-500 ease-in-out` on the columns layout. `grid-template-columns` is NOT GPU-accelerated; this is layout, not compositor. Each frame re-runs layout for the entire grid. 500ms at 60fps is 30 frames of full layout. On a Pentium III-class CPU that's painful (~10-15ms/frame, dropping to ~30fps). On a modern phone, ~1-2ms/frame, fine. A pure transform/opacity transition would be better but requires restructuring the layout.

[PERF-LOW] photo-viewer.tsx:662-664 — sidebar `transition-all duration-500 ease-in-out` includes opacity, translate, width, padding. Width is layout. Opacity + transform are compositor-only. The `lg:w-0 lg:p-0` collapse is a layout transition. Every `'I'` toggle does 30 frames of layout recalc on the sidebar. Same class as the grid issue.

[PERF-LOW] tooltip.tsx:49 — animations use `animate-in fade-in-0 zoom-in-95 …`. These are Tailwind `tailwindcss-animate` utilities which compile to `transform` + `opacity` keyframes — compositor-only. Good.

[PERF-LOW] photo-viewer.tsx:842-845 — `ChevronDown` rotation uses `rotate-180` with `transition-transform`. Compositor only. Good.

[PERF-LOW] info-bottom-sheet.tsx:169-180 — `transform: translateY(...)` on the sheet. Compositor. Good. But the `transition: 'none'` swap during drag (line 174) means every touch-move bypasses the transition timer. Correct for drag tracking.

[PERF-LOW] lightbox.tsx:455-461 — Ken Burns animation uses `animation: lightbox-ken-burns-X N s ease-in-out forwards`. CSS animation on an `<img>`. Animates `transform` (per `kenBurnsTransform` line 65-76). Compositor-only. Good. Worth verifying the keyframes file uses `transform` and not `top/left`.

---

## 15. Database query perf — new color columns and indexes

[PERF-LOW] schema.ts:53,64-67 — `color_pipeline_decision` (varchar 64), `color_primaries` (varchar 32), `transfer_function` (varchar 16), `matrix_coefficients` (varchar 16), `is_hdr` (boolean default false). Total row width increase: ~128 bytes. On a 100k-image gallery, ~12 MB extra disk + index storage. Fine.

[PERF-LOW] schema.ts:90-93 — existing indexes are `(processed, capture_date, created_at)`, `(processed, created_at)`, `(topic, processed, capture_date, created_at)`. None of the new color columns are indexed. Should they be? Only if there is a query like `WHERE is_hdr = TRUE` or `WHERE color_primaries = 'p3-d65'`. I see no such filter in the current data layer code path. Not adding an index is correct. Adding one preemptively would just slow inserts.

[PERF-LOW] data.ts:213-217 — all five new fields are in `adminSelectFields` and (per the destructuring chain at 281-310) are propagated to `publicSelectFields`. That means every public listing query fetches ~128 bytes of color data per row. For a 60-image homepage that's ~7.5 KB extra payload over the wire. Gzip likely cuts this to ~3 KB. Acceptable, but `color_pipeline_decision` is admin-only at the rendering layer (photo-viewer.tsx:872). Move that one field out of `publicSelectFields` to save the over-fetch and prevent silent privacy leakage. The other four (`color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`) are needed publicly because they drive the `<source media="(dynamic-range: high)">` choice and the histogram gamut label, so leave them.

[PERF-LOW] data.ts:944, 1024, 1163 — multiple list endpoints spread `publicSelectFields`. Adding a column to that object means every cached query plan must be re-prepared if the SQL emitter changes the column list. Drizzle generates fresh SQL per call; impact is one extra column in the SELECT. Negligible.

[PERF-LOW] schema.ts: `is_hdr` is a `boolean('is_hdr').notNull().default(false)`. MySQL stores booleans as TINYINT(1). Default-false avoids NULL handling complexity. Good.

[PERF-LOW] No migration filename audit done in this review. Verify the migration that adds these columns ran with `ALGORITHM=INPLACE, LOCK=NONE` if the table is large; otherwise the ALTER TABLE locks for the duration. On a 100k-row table that's tens of seconds.

---

## Final scoreboard

| Severity | Count | Categories |
|----------|-------|------------|
| PERF-CRIT | 1 | HDR `<picture>` source 404 path (photo-viewer.tsx, lightbox.tsx, home-client.tsx) |
| PERF-HIGH | 1 | SW HDR pass-through interacts with the 404 to repeat fetches per navigation |
| PERF-MED | 9 | photo-viewer rerender footprint, AVIF probe per-mount, double-decode AVIF for histogram, HEAD probe per nav, Radix tooltip provider scope (low impact at current count), encoder rgb16 fan-out memory, encoder cap on width-only, scroll restore RAF triple-fire, color_pipeline_decision in publicSelectFields |
| PERF-LOW | ~25 | various sub-millisecond hot-paths, layout-on-grid-template animations, inline style tags, missing module-level memoization, bundle deltas, translation size, etc. |

## Final verdict: FIX AND SHIP

The headline blocker is item #3 (HDR `<picture>` source pointing at non-existent files). Until the HDR encoder ships, `NEXT_PUBLIC_HDR_FEATURE_FLAG` MUST stay false. The flag system is correct; the call sites honor it; the only outstanding risk is misconfiguration. Either gate the `<source>` element on a runtime existence probe (the same mechanism already implemented for `hdrExists` in the download menu, photo-viewer.tsx:230-240), OR document the flag as build-time and forbid setting it true without the encoder.

Item #2 (AVIF probe per-mount triggering double-fetch on every photo navigation for wide-gamut images) is a real bandwidth bug worth ~200-400 KB per nav. Easy fix: module-level singleton.

Items #9 (encoder rgb16 fan-out memory) and #15 (color_pipeline_decision over-fetch) are quality-of-life issues, not blockers.

Everything else is incremental. The architecture is sound: encoder runs on upload only, photo viewer memoizes srcSet correctly, masonry grid reserves space cleanly, service worker has reasonable cache strategy.

The Pentium III would survive this gallery, with the HDR flag off.

---

## Files referenced (absolute paths)

- /Users/hletrd/flash-shared/gallery/apps/web/src/components/photo-viewer.tsx
- /Users/hletrd/flash-shared/gallery/apps/web/src/components/lightbox.tsx
- /Users/hletrd/flash-shared/gallery/apps/web/src/components/home-client.tsx
- /Users/hletrd/flash-shared/gallery/apps/web/src/components/histogram.tsx
- /Users/hletrd/flash-shared/gallery/apps/web/src/components/info-bottom-sheet.tsx
- /Users/hletrd/flash-shared/gallery/apps/web/src/components/ui/tooltip.tsx
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/feature-flags.ts
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/process-image.ts
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/color-detection.ts
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/icc-extractor.ts
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/sw-cache.ts
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/data.ts
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/image-types.ts
- /Users/hletrd/flash-shared/gallery/apps/web/src/db/schema.ts
- /Users/hletrd/flash-shared/gallery/apps/web/public/sw.js
- /Users/hletrd/flash-shared/gallery/apps/web/scripts/backfill-color-pipeline.ts
- /Users/hletrd/flash-shared/gallery/apps/web/messages/en.json
- /Users/hletrd/flash-shared/gallery/apps/web/messages/ko.json
