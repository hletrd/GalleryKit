# Run-10 Cycle 4 — Performance Review (perf-reviewer lane)

Start HEAD: `ec433dc4` (clean tree). Angle: performance, concurrency, CPU/memory,
I/O amplification, UI responsiveness. Method: direct code verification of the five
cycle-3 perf-relevant commits, then a whole-repo sweep (own pass over
`image-queue.ts`, `serve-upload.ts`, `data.ts`, `proxy.ts`, `process-image.ts`,
`sw.template.js`/`sw-cache.ts`, `gallery-config.ts`, `admin-backfill-runner.ts`;
two read-only general-purpose sub-lanes over client components and API
routes/actions, with every HIGH/MED sub-lane finding re-verified by this lane
against the cited code before inclusion).

## File inventory swept

- `apps/web/src/lib/` — all 100 modules enumerated; deep-read: image-queue.ts (full),
  serve-upload.ts (full), data.ts (structure + hot spots), process-image.ts (I/O map),
  gallery-config.ts, sw-cache.ts, upload-processing-contract-lock.ts,
  admin-backfill-runner.ts (config-read site), clip-embeddings.ts (retention contract);
  sub-lane coverage: rate-limit.ts, auth-rate-limit.ts, bounded-map.ts, upload-tracker*.ts,
  background-db-writes.ts, view-retention.ts, analytics-data.ts, atom-feed.ts,
  smart-collections.ts, data-timeline.ts, og-photo-fetch.ts, clip-model.ts, clip-inference.ts.
- `apps/web/src/app/api/` — all 10 route files covered (og ×2, search ×2, health, live,
  admin/db/download, admin/lr/upload).
- `apps/web/src/app/actions/` — images.ts (upload path re-verified by this lane),
  public.ts, settings.ts, sharing.ts, topics.ts, tags.ts via sub-lane.
- `apps/web/src/components/` — all 21 priority heavy-client files via sub-lane
  (photo-viewer.tsx and image-zoom.tsx re-verified by this lane); shadcn `ui/*` skipped
  as thin primitives.
- `apps/web/src/proxy.ts`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`
  (hash-verified), `apps/web/scripts/build-sw.ts` — read in full by this lane.
- Shared-view page `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` and e2e
  `apps/web/e2e/swipe-visual-reset.spec.ts` — read for PERF4-01 verification.

## Cycle-3 perf-commit verification (primary scope 1)

| Commit | Verdict |
|---|---|
| `1dff18d6` (config micro-cache, clamp warn, timer tracking) | **Delivered, one residual.** Clamp warning fires only on genuine clamp-down (`image-queue.ts:151-157`), formula mirrors the backfill runner. Retry timers are tracked on state (`image-queue.ts:446-460`), cleared at shutdown (`:648`), defensive re-init (`:409-414`), and restore reset (`:1292`) — no leak path found; timers self-deregister on fire. The 25s comment is fixed (`:944-949`). Micro-cache (`gallery-config.ts:212-233`): TTL check correct, in-flight dedupe has no reentrancy gap, failures are NOT negatively cached (in-flight cleared in `finally`, cache only set on success), shared object reference is safe (all consumers read-only). Residual: the cache is never invalidated on settings writes → **PERF4-08**. |
| `fc9e4407` + `d07c6d32` (serve-upload fd-free HEAD/304) | **Delivered, no regression.** 304 (`serve-upload.ts:263-273`) and HEAD (`:280-290`) branches provably never open an fd (open happens at `:296`, after both returns). GET body path keeps the fd-stat coherence contract: `bodyStats = await fileHandle.stat()` (`:297`) and the ETag/Content-Length at `:302-305` describe the streamed descriptor; `d07c6d32` re-pins this in `resolved-stream-source.test.ts`. ETag parity: both paths use the identical format and the same per-request `settingsHash` (`:253`); a HEAD-vs-GET tag difference can only arise from a genuine file replacement between requests — correct HTTP semantics. No fd leak: every error path closes handle or destroys stream (`:298-301`, `:356-363`); after `createReadStream({autoClose:true})` ownership transfers (`:322-323`). Root-realpath memoization caches success only (`:28-40`); ENOENT fallback stays per-request. INFO-level operational note: if `UPLOAD_ROOT` is reached through a symlink whose target is repointed at runtime, the cached realpath now requires a process restart to heal (previously self-healed per request) — acknowledged in the code comment, acceptable. |
| `0ae67c25` (SW durable touch, no size-0 entries) | **Delivered; the durability trade adds a quantifiable display-path cost → PERF4-03.** `resolveSize` uses `response.clone().blob()` (`sw.template.js:224-233`) so the lazily-sized `cached` response is NOT body-consumed before being returned — the obvious hazard is absent. Size-0 skip logic correct: skip also skips the recency reposition, so an unsizable entry ages out and is re-recorded by the next full revalidation (self-healing). `sw-cache.ts` mirror is in lockstep (`touchMeta(url, knownSize, resolveSize?)` + skip-on-0). `sw.js` regenerated in sync — recomputed `sha256(template + "\nPIPELINE=7").slice(0,8)` = `26516421` matches the committed stamp. |
| `200a74bf` (embedding-scan cursor) | **Delivered; cannot skip or loop.** Skip-safety: ids are auto-increment (no new rows below cursor); a capped run persists the last processed batch tail (`image-queue.ts:538-541`) and failed rows behind the cursor are retried on wrap-around after a clean pass resets to 0 (`:580-586`); exact-multiple-of-batch candidate sets terminate via the empty next batch (`!lastRow`). Loop-safety: `scanned` grows monotonically per batch and the cap check precedes each query; empty batch breaks. Concurrency: single-flight guard `embeddingBootstrapInFlight` is set with no await between check (`:1161`) and assignment (`:1169`) — no reentrancy window. Restore resets the cursor (`:1291`). Residual INFO → PERF4-12 (mode-flip staleness of the cursor). |
| `c7f32eef` (defensive embedding copy) | **Delivered; cost negligible.** One 2048-byte `Float32Array` copy per similar-image request, off the scan loop — sub-microsecond against a route that scans up to `SEMANTIC_SCAN_LIMIT` rows; the copy also un-pins the underlying mysql2 socket-read ArrayBuffer that the retained view previously kept alive for the request tail. Verified (both search routes) that every other `decodeEmbeddingColumn` result is consumed transiently inside a synchronous `.map()` with no intervening await (`semantic/route.ts:302-309`, `similar/[id]/route.ts:204-212`), and the retained `queryEmbedding` in the semantic route is never a wire-buffer view (`embedTextReal` → `truncateAndNormalize` fresh arrays; `embedImageStub` → fresh `Float32Array`). Retention contract now documented at `clip-embeddings.ts:117-131`. |

## Findings table

| ID | Sev/Conf | Status | Location | Title |
|----|---------|--------|----------|-------|
| PERF4-01 | HIGH/Med-High | likely | `components/photo-viewer.tsx:307-310`, `g/[key]/page.tsx:105-107`, `lib/rate-limit.ts:96-97,345-353` | Shared-group in-place photo stepping fires a full dynamic SSR + share-limiter slot per step; legitimate browsing can exhaust the 60/min budget and 404 the open viewer |
| PERF4-02 | MED/High | confirmed | `public/sw.template.js:410-432` | SW `networkFirstHtml` awaits the full-body `cache.put` (+ eviction walk) before resolving `respondWith` — HTML streaming/first-paint gated on full download + storage write for every SW-controlled public navigation |
| PERF4-03 | LOW-MED/High | confirmed | `public/sw.template.js:368,387,98-104,178-213` | Awaited `touchMeta` serializes confirmed-fresh tile responses behind the global meta mutex — a warm masonry revalidation pays N serialized full-meta-document read-parse-rewrite cycles on the display path |
| PERF4-04 | MED/Med | likely | `actions/images.ts:198→finally ~651`, `api/admin/lr/upload/route.ts:272→608`, `lib/upload-processing-contract-lock.ts:9-56` | Exclusive upload-contract lock serializes ALL uploads deployment-wide across the slow save/GPS-strip/insert window; concurrent second uploader stalls 5 s on a second pinned pool connection then gets a misleading `uploadSettingsLocked`/409 |
| PERF4-05 | MED/Med | likely | `api/admin/lr/upload/route.ts:60-74,180-186,348,489` | LR multipart parse slot released immediately after `formData()`; k staggered in-flight uploads retain k × ~216 MiB in-memory blobs through the multi-second processing window (RSS spike/OOM risk on small hosts) |
| PERF4-06 | LOW/High | confirmed | `api/health/route.ts:40-46` | Timed-out DB readiness probe is not cancelled — during a wedged-MySQL incident an orchestrator probing every ~10 s stacks pending `SELECT 1`s toward the pool queue limit (only when `HEALTH_CHECK_DB=true`) |
| PERF4-07 | LOW/Med-High | likely | `lib/og-photo-fetch.ts:72-87`, `api/og/photo/[id]/route.tsx:188-201` | Per-photo OG card buffers its own LOCAL derivative via a public-HTTPS self-fetch (DNS/TLS/nginx round-trip per attempt + hairpin-routing availability coupling) where a capped `fs.readFile` would do; route comment's "Satori fetches it" rationale is inaccurate (code inlines base64 itself) |
| PERF4-08 | LOW/High | confirmed | `lib/gallery-config.ts:212-236`, `actions/settings.ts:225` | The `getGalleryConfigUncached` 2 s micro-cache is never invalidated on settings writes — the C3-04/detached-freshness contract now carries a ≤2 s skew (flip-then-reencode; mode-flip vs in-flight embedding write) with a one-line exact fix available |
| PERF4-09 | MED/Med | likely | `components/image-zoom.tsx:262-303,354,360` (contrast `:114`) | `e.preventDefault()` in React `onTouchMove` is a no-op (React ≥17 passive root listener): pinch-from-unzoomed fights browser page zoom + per-frame console intervention warnings; the wheel path already uses the correct native `{passive:false}` pattern |
| PERF4-10 | LOW/Med-High | likely | `components/photo-viewer.tsx:256-305` | Info-sidebar toggle changes `photoViewerSizes` → neighbor-preload effect re-runs and re-fetches both neighbor derivatives at a new `imagesizes` per toggle (multi-MB on large ladders) |
| PERF4-11 | LOW/Med-High | likely | `components/upload-dropzone.tsx:503,524-532,284-286` | Upload previews decode full-resolution originals (object-URL `<img>`, no thumbnail downscale) and the whole file grid re-renders ~3× per uploaded file (admin-only, sequential upload masks most of it) |
| PERF4-12 | INFO/High | confirmed | `lib/image-queue.ts:532-588` | Embedding-scan cursor persists across semantic-mode flips: after stub→production mid-backlog, rows below the cursor for the NEW model version wait until wrap-around (delayed, not starved) |
| PERF4-13 | INFO/Med-High | confirmed | `components/histogram.tsx:472-480` | Sidebar `Histogram` (not keyed by photo id) accumulates one `failedUrls` string per legacy photo browsed for the session lifetime — KB-scale, cosmetic |
| PERF4-14 | INFO/High | confirmed | `actions/topics.ts:323-349` | Topic rename full-scans `smart_collections` + per-row JSON parse inside the rename transaction while holding the topic route lock — bounded by admin-created collection count, fine at current scale |

## Details

### PERF4-01 — Shared-view stepping: full SSR + rate-limit burn per step (HIGH/Med-High, likely)

Mechanism (all verified in code): `/g/[key]` passes
`syncPhotoQueryBasePath` (`g/[key]/page.tsx:164`) and PhotoViewer syncs the URL on
every in-place image change:

- `photo-viewer.tsx:307-310` — `router.replace(\`${base}?photoId=${image.id}\`)` in an
  effect keyed on `image`. Every swipe (`:218`), arrow/nav, shared-grid `onSelectId`
  (`:657`), and **each 5 s slideshow advance** (`:981`) changes `image` and fires it.
  It also fires once on mount (adding `?photoId=` to a bare share URL — one extra SSR
  per share open).
- `router.replace` on a `revalidate = 0` page is a real RSC navigation: the server
  re-runs the whole page — restore check, `isShareLookupRateLimited()`
  **pre-increment** (`g/[key]/page.tsx:105-107`), `getSharedGroupCached` + SEO +
  config + translations — for a photo switch the client already performed instantly
  with `setCurrentImageId`. The in-place-switch design exists precisely to avoid a
  navigation, and this effect re-adds one per step.
- Budget math: `SHARE_MAX_REQUESTS = 60`/min per IP (`rate-limit.ts:96-97`), and the
  same budget is drained by the shared grid's viewport-entry RSC prefetches (each
  visible tile links to `?photoId=`). Over budget, `preIncrementShareAttempt` returns
  limited → the page returns `notFound()` → the RSC payload **replaces the open viewer
  with the 404 page** mid-browse. A recipient swiping ~1.5 photos/s, a slideshow left
  running plus manual browsing, or a NAT-shared household/office collectively, all
  plausibly cross 60/min.
- The repo already produced evidence of this pressure: cycle-3 commit `24c46745`
  rewrote the swipe e2e into a single session because "parallel e2e workers plus the
  shared grid's viewport-entry RSC prefetches share the 127.0.0.1 budget" — the test
  was hardened around the limiter; the per-step product cost that drains the budget
  was left in place.
- Needs-validation sub-note: after each RSC payload lands, `images` arrives with fresh
  object identities and `image = images[currentIndex]` (`:116-117`) is unmemoized, so
  the effect re-fires with an UNCHANGED URL. If `router.replace` to the identical URL
  re-fetched, this would self-sustain a fetch loop; the e2e suite's stability (41
  passed with this flow exercised) argues Next bails on identical-URL replaces, but
  this was not runtime-verified here. A guard (skip when URL already matches) is
  cheap insurance either way.

Fix: sync the query param with shallow history — `window.history.replaceState(null,
'', url)` (App Router-supported since 14.1, updates `useSearchParams` without a server
round-trip) — plus skip-if-URL-already-matches. Optionally `prefetch={false}` on
shared-grid tile links so viewport entry stops draining the enumeration budget.
This removes both the per-step SSR cost and the limiter burn without touching the
anti-enumeration posture for genuinely new key lookups.

### PERF4-02 — SW defeats HTML streaming on cache-eligible navigations (MED/High, confirmed)

`networkFirstHtml` (`sw.template.js:410-432`) does `await htmlCache.put(request,
responseToCache)` and `await evictHtmlCacheIfNeeded()` BEFORE `return
networkResponse`. `cache.put` resolves only after the tee'd body stream is fully
consumed and written, so on every SW-controlled public HTML navigation the browser
receives the Response object — and can begin parsing/painting — only after the ENTIRE
HTML document has been downloaded and stored. Progressive HTML/RSC streaming (which
Next.js relies on for perceived latency) is fully serialized behind download+storage;
on slow links a few-hundred-KB gallery page costs seconds of added first-paint. The
eviction walk (when >50 entries: one `cache.match` per key, `:143-160`) is also on
this path. Pre-existing (predates cycle 3; not a regression from `0ae67c25`).

Fix: return the network response immediately and perform the put via
`event.waitUntil(...)` (plumb the event or return a `{response, pending}` pair). Note
the C3-10 durability rationale does NOT apply here: this cache is an offline-only
best-effort fallback, not a sole-authority record — a termination-dropped put costs
nothing but a missed fallback entry, and `cache.put` does not store partial bodies.

### PERF4-03 — Awaited touchMeta serializes the warm-paint display path (LOW-MED/High, confirmed)

The C3-10 fix moved `touchMeta` from fire-and-forget to awaited on the 304
(`sw.template.js:368`) and same-ETag (`:387`) branches. `touchMeta` runs under
`withMetaMutation` — a single global promise chain (`:98-104`) — and each touch is a
full meta-document cycle: `caches.open` + `match('/__meta__')` + `resp.json()` parse
of ALL entries + delete/set + `JSON.stringify` of ALL entries + `cache.put`
(`:178-213`). A warm masonry paint revalidating N cached tiles queues N such cycles;
tile k's response (the `return cached` at `:369`/`:388`) now waits for its HEAD probe
(bounded 300 ms) PLUS k−1 serialized meta rewrites. With ~250 meta entries (50 MB cap
÷ ~200 KB derivatives ≈ 25 KB JSON document) at ~1-5 ms per cycle, the last of 50
tiles adds roughly 50-250 ms; total work is O(N·M) per paint. Before cycle 3 the same
work ran in the background without delaying responses. The durability rationale is
sound (the meta timestamp IS the sole recency authority) — but durability and
non-blocking are simultaneously achievable.

Fix (when warranted): plumb `event.waitUntil` into the image strategy so the touch is
lifetime-covered without gating the response; independently, coalesce touches (queue
URLs, flush one combined meta write per tick) to collapse the O(N·M) rewrite pattern
that `recordAndEvict` shares. Suggest recording as a measured-exit-criterion deferral
rather than immediate rework: the absolute numbers are modest and only the warm
revalidation path pays them.

### PERF4-04 / PERF4-05 — Upload concurrency (MED/Med, likely; sub-lane findings re-verified at the acquisition sites)

PERF4-04: both upload paths take the exclusive `gallerykit_upload_processing_contract`
`GET_LOCK` (browser action `actions/images.ts:198` before any file work; LR route
`api/admin/lr/upload/route.ts` similarly) and hold it across original save, Sharp
metadata probe, GPS byte-rewrite (up to a second full read+write of a 200 MB file),
and the insert. CLAUDE.md documents the lock's intent as upload-vs-settings-change
serialization; upload-vs-upload mutual exclusion is a side effect of using one
exclusive lock for both roles. Two concurrent uploaders (two admins, or two LR PAT
clients): the second waits in `GET_LOCK(...,5)` pinning a second pool connection, then
fails with the misleading settings-locked message. Single-admin sequential-dropzone
flows are unaffected, hence MED. Fix shape: reader/writer semantics (uploads shared,
settings-change exclusive), or shrink the exclusive window to the first-commit check +
insert.

PERF4-05: `LR_MULTIPART_PARSE_MAX_IN_FLIGHT = 1` bounds only the `formData()` parse;
the materialized ~≤216 MiB Blob stays referenced through the whole processing window
after the slot is released. Staggered concurrent requests (multiple tokens/IPs — the
tracker key is per `lr:${user??ip}`) can retain several such buffers simultaneously.
Fix: hold the slot (or a small semaphore) until the original is flushed to disk and
the `File` reference dropped. Related to the deferred C1-33/C2-20 memory-measurement
class but a distinct, code-visible retention window.

### PERF4-08 — Micro-cache invalidation gap (LOW/High, confirmed)

`_uncachedConfigCacheReset()` (`gallery-config.ts:236`) is called only by tests. The
settings mutation (`actions/settings.ts:225`) calls `revalidateAllAppData()` (Next
cache) but never resets the module-level micro-cache, so every consumer of
`getGalleryConfigUncached` — the queue's per-image side-effect gates AND the
`admin-backfill-runner.ts:698` detached read that cycle-3's C3-04 fix specifically
made "uncached" — can observe a value up to 2 s stale after a settings commit.
Concrete windows: (a) flip color setting → immediately click Re-encode → first images
re-encode at stale settings IF a queue side-effect read warmed the cache within 2 s
(requires active processing at flip time; human click latency usually exceeds 2 s);
(b) flip `semantic_search_mode` production→stub (or vice versa) → a job completing
within 2 s writes an embedding for the OLD mode; the `onDuplicateKeyUpdate` write can
replace a production row's `modelVersion` with stub — self-healed by the next
`bootstrapMissingActiveEmbeddings` pass, so bounded. The plan accepted this skew
explicitly; recording it because the exact fix is one line: call the reset from the
settings action after commit (exact in the single-process topology; harmless
otherwise), and rename it from test-hook to first-class invalidation.

### PERF4-06 / PERF4-07 / PERF4-09..14 — see table; sub-lane details

- PERF4-06: the `Promise.race` bounds the HTTP response, not the query; the losing
  `db.execute` holds its pool slot until mysql2 settles, and the C1-16 comment
  overclaims ("prevents pinning"). Fix: dedicated probe connection destroyed on
  timeout, or reuse a single in-flight probe promise.
- PERF4-07: transport-level only (the budget/timeout design is settled and not
  re-litigated). An `fs.readFile` with the existing 1 MB/size caps and
  serve-upload-style containment checks removes a network round-trip per cold OG
  render and the container-must-reach-its-own-public-origin coupling (broken hairpin
  DNS currently degrades every photo card to the site-default fallback after 10 s of
  budget).
- PERF4-09: verified — pinch handling lives in React `onTouchMove`
  (`image-zoom.tsx:360`) whose `preventDefault` (`:264,:295`) is dead under React's
  passive root-level touch listeners, while `touchAction` is `'auto'` at zoom 1
  (`:354`) and mid-gesture flips don't affect in-progress gestures; the same file's
  wheel path already uses native `{passive:false}` (`:114`). Fix: mirror the wheel
  pattern for touchmove. (UX-correctness-adjacent; flagged here for the jank +
  console-spam cost; the designer lane may want the interaction half.)
- PERF4-10: preload effect deps include `photoViewerSizes` (`photo-viewer.tsx:305`),
  which flips with the info panel; cleanup removes and re-inserts the
  `<link rel=preload>` elements with a different `imagesizes`, so the browser can
  legitimately pick a different srcset width → re-download. Fix: key on neighbor ids;
  read sizes from a ref.
- PERF4-12: recommend resetting `embeddingScanCursorId` to 0 whenever the active
  model version changes between invocations (one comparison against a remembered
  `activeModelVersion` on state) — cheap and removes the wrap-around wait after an
  operator enables production mode mid-backlog.

## Deferred-register check (no exit criteria fired; no re-reports without new evidence)

- **C2-14b rider honored**: the mandatory-copy constraint (PERF3-04) is now enforced
  in code and documented at `clip-embeddings.ts:117-131` by `c7f32eef`.
- **C2-12 (map)**: unchanged shape — server query is LIMIT-bounded
  (`MAP_MAX_MARKERS`, `data.ts:1768`); client still renders one `<Marker>` per photo,
  popups lazy. No new evidence; exit criterion (≈1000 geotagged photos or measured
  multi-second mount) not fired.
- **C3-28 (middleware CSP rebuild)**: unchanged (`proxy.ts:41-52`); the per-call
  fail-degrade semantics that block memoization are still pinned. Not re-reported.
- **C2-20 (GPS-strip whole-file read)**: still present (`process-image.ts:1751`),
  unchanged, no new evidence. PERF4-05 is a distinct adjacent retention window on the
  LR route, not a re-report.
- **C2-15/16/21/28/55, C3-17/30/31**: nothing in this pass produced new evidence or
  fired an exit criterion.
- PERF4-01's limiter interplay is NEW (product-behavior cost, not the C2-07 edge-limiter
  chain), evidenced by cycle-3's own e2e workaround commit `24c46745`.

## Verified clean (do not re-derive)

- **image-queue.ts**: retry-timer tracking leak-free across shutdown/re-init/restore;
  clamp warning correct; bootstrap single-flight airtight (no await gap);
  `pruneRetryMaps`/`permanentlyFailedIds` bounds hold; side-effect drain loop bounded.
- **serve-upload.ts**: fd-free 304/HEAD verified branch-by-branch; GET fd-stat
  coherence intact; ETag parity via shared per-request settingsHash; stale-while-
  revalidate settings-hash cache non-blocking (cold-start-only wait).
- **sw.template.js ↔ sw-cache.ts ↔ sw.js**: mirror in lockstep; version stamp
  independently recomputed and matching (`26516421-p7`); `resolveSize` clones before
  blob (no consumed-body hazard); size-0 skip self-healing.
- **data.ts**: view-count buffer bounded (cap + retry cap + FIFO eviction +
  drain-awaited shutdown); `tagNamesAgg` contract intact across all four listing
  queries; `getMapImages` LIMIT-bounded; sitemap bounded (24 000); share-key lookup
  single-query GROUP_CONCAT shape intact; React `cache()` wrappers present for all
  request-path accessors.
- **process-image.ts**: per-format fresh-instance fan-out unchanged; ICC verify uses
  partial reads (not whole-file); atomic rename chains with backup-restore reverse
  order; per-size sequential within format bounds memory.
- **proxy.ts**: nothing beyond deferred C3-28; body-less NextRequest clone is safe
  (middleware never forwards the body).
- **Search routes**: scan caps enforced; no other retained zero-copy decode across
  awaits; CLIP model lazy-singleton with bounded inference queue.
- **rate-limit/auth-rate-limit/bounded-map**: caps genuinely enforced in `set()`;
  no await between read-modify-write (no lost updates on single thread).
- **upload-tracker**: claim-before-first-await + settle-on-every-early-return
  contracts hold as documented.
- **Components** (sub-lane, spot-checked): masonry-card, home-client, grid-picture(+
  fallback), lightbox, lightbox-color-pip, load-more, search, similar-photos,
  optimistic-image (fallback-retry-base fix verified), on-this-day-widget, tag-filter,
  info-bottom-sheet, use-display-capability (React #185 snapshot guard intact),
  image-zoom-math, map-loader, histogram worker lifecycle (per-mount worker,
  terminated on unmount, requestId-guarded). **photo-navigation cycle-3 fix
  (`9c45e933`): no perf regression** — the added `useLayoutEffect` runs only on
  photo-id/reduced-motion changes, four direct style writes, nothing per-frame.
- **Misc server**: og/route.tsx (ETag 304, no per-request font load), db download
  (streams from fd), view-retention (chunked+capped), analytics-data (bounded),
  atom-feed (pure), smart-collections (AST budgets), data-timeline (accepted
  non-sargable, LIMIT+1), background-db-writes (self-removing set), actions/tags.ts
  (C2-17 join-UPDATE present in update+delete).

## Final sweep confirmation

Every file class named in the lane scope was covered: the five cycle-3 perf commits
(deep-verified above), image-queue.ts / process-image.ts / data.ts / serve-upload.ts /
proxy.ts / sw.template.js + sw-cache.ts (direct read), all `app/api/` routes and the
heavy client components (sub-lanes + this lane's re-verification of every HIGH/MED),
plus the actions and supporting libs listed in the inventory. The `ui/*` shadcn
primitives and pure-constant modules (constants.ts, image-types.ts, etc.) were
intentionally skimmed-not-audited as having no perf surface. No scoped file was
skipped.
