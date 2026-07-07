# Run-10 Cycle 5 — Performance Review (perf-reviewer lane)

Start HEAD: `d9bcbf4c` (clean tree; == origin/master). Angle: performance,
concurrency, CPU/memory, DB query efficiency, N+1, blocking I/O, React
re-render/effect thrash, bundle/payload.

Method: (1) diffed the cycle-4 baseline `ec433dc4..d9bcbf4c` to isolate the
freshest code — the 15 cycle-4 fix commits are the highest-yield surface for
*new* regressions and were deep-read directly; (2) two read-only Explore
sub-lanes over `components/` and `app/api|actions|page.tsx`, with every
candidate re-verified by this lane against the cited code before inclusion;
(3) a targeted own-pass over the data-access hot paths (`data.ts`,
`data-timeline.ts`, `analytics-data.ts`), the SW, and `single-writer-guard.ts`.

Read the cycle-4 aggregate + perf-reviewer.md + deferred-carry-forward.md first;
findings already covered there (PERF4-01..14, C4-01..47, and the C2-*/C3-*
deferred rows) are NOT re-reported. Where a cycle-4 fix left a residual, or a
deferred exit criterion was checked, it is called out as a status note, not a
new finding.

## File inventory swept

- **Cycle-4 fix commits (deep-read, primary scope):** `b68d09e2` migrate.js,
  `ce15103a` single-writer-guard.ts (full), `12037508` gallery-config.ts +
  settings.ts, `ad1fd22d`/`31ff51f5` sw.template.js (full), `4afacfa8`/`0da58d6b`/
  `d79f6f70` photo-viewer.tsx, `9dccebcd` image-zoom.tsx, `678ebbeb`
  photo-navigation.tsx, `18b6cbb4` health/route.ts, `5f0388ed` settings-hash.ts,
  `e3d221e3` serve-upload.ts, `d7ca37de` image-queue.ts.
- **Data layer:** data.ts (`getImageWithSelectFields`, the cache() wrapper set,
  listing queries), data-timeline.ts (full), analytics-data.ts (query shapes),
  db/schema.ts (index coverage cross-check).
- **Public pages:** `(public)/page.tsx`, `p/[id]/page.tsx` (full), `g/[key]`.
- **Components (sub-lane + re-verify):** masonry-card, home-client, photo-viewer,
  image-zoom, info-bottom-sheet, lightbox, load-more, histogram, upload-dropzone,
  photo-navigation.
- **Server (sub-lane + re-verify):** all `app/api/**` routes, `actions/images.ts`
  (`bulkUpdateImages`), `actions/tags.ts` (`batchUpdateImageTags`),
  `actions/public.ts`, `sql-like.ts`.

## NEW findings

| ID | Sev/Conf | Status | Location | Title |
|----|---------|--------|----------|-------|
| PERF5-01 | MED/High | Confirmed | `p/[id]/page.tsx:148-159`, `data.ts:1057-1211,1782-1784` | Admin photo view double-runs `getImageWithSelectFields` (2 separate `cache()` wrappers) → 3 byte-identical redundant queries per admin `/p/[id]` render, including the two OR-heavy prev/next neighbor lookups |
| PERF5-02 | LOW-MED/High | Confirmed | `components/info-bottom-sheet.tsx:140-151,296` | `onTouchMove` `preventDefault()` is a no-op under React's passive root listener — the exact C4-12 bug in an UN-fixed sibling file: background scrolls during sheet drag + one console intervention warning per touchmove frame |
| PERF5-03 | LOW-MED/Med | Likely | `components/masonry-card.tsx:40-64,84-100` | Every 48 px viewport-bucket crossing during window resize busts `React.memo` for ALL loaded cards and re-derives title/alt/aria/AVIF+WebP srcset strings that don't depend on the changed prop; only `cardIntrinsicHeight` needs the new width |
| PERF5-04 | LOW-MED/Med | Likely | `actions/images.ts:1170-1180` | `bulkUpdateImages` alt-suggested mode issues up to N (≤100) sequential per-row `tx.update` statements inside one transaction, pinning image-row locks across N round-trips on the admin-serialized write path; collapsible to a single CASE UPDATE |
| PERF5-05 | LOW/High | Confirmed | `components/photo-viewer.tsx:375-394` | Info-panel/bottom-sheet toggle churns a `window.matchMedia` subscription: the breakpoint-sync effect deps `[showBottomSheet, isPinned]` tear down + recreate the `change` listener on every pin/unpin/open/close |
| PERF5-06 | INFO/Low | Needs-validation | `components/image-zoom.tsx:104` | Wheel handler reads `container.getBoundingClientRect()` per wheel event; likely NOT a forced reflow (the zoom transform is on a composited child), but the drag/pinch paths already cache the rect at gesture start and the wheel path could too |

## Details

### PERF5-01 — Admin `/p/[id]` runs the full 4-query image lookup twice (MED/High, Confirmed)

`getImageWithSelectFields` (`data.ts:1057-1211`) is one row query + a
`Promise.all` of three more: the tag join, the prev-neighbor lookup, and the
next-neighbor lookup. The two neighbor queries are the OR-heavy ones — up to
four `AND(...)` range branches over `(processed, capture_date, created_at, id)`
(`:1107-1149`) `OR`-ed together, each `ORDER BY … LIMIT 1`.

The page wires two DIFFERENT `cache()` wrappers over this:
- `getImageCached = cache(getImage)` → `getImageWithSelectFields(id, publicSelectFields)` (`:1213-1214,1782`)
- `getImageForViewerCached = cache(getImageForViewer)` → `getImageWithSelectFields(id, adminSelectFields)` (`:1235-1236,1784`)

React `cache()` dedupes by `(fn, args)`, so these two never share a result. In
`p/[id]/page.tsx`:
- `generateMetadata` calls `getImageCached(imageId)` (`:66`) — 4 queries, public fields.
- The page body sets `publicImagePromise = getImageCached(imageId)` (`:148`) — a
  cache HIT of the metadata call (the comment at `:55-56` correctly notes this).
- For an admin (`:157-158`): `await getImageForViewerCached(imageId, true)` — a
  SEPARATE wrapper, so it runs `getImageWithSelectFields` AGAIN (4 more queries,
  admin fields).

Net: a **non-admin** photo view = 4 queries (public, deduped across metadata +
page). An **admin** photo view = 8 queries, of which the tags + prev-neighbor +
next-neighbor (3 of 4) are byte-identical between the public and admin runs —
they select `id/filenames/dims` and the tag join, both field-set-independent.
The metadata dedup comment reasons only about the public↔public case and misses
the public↔admin duplication. Admin-only, so MED not HIGH, but each admin photo
view redundantly executes the two most expensive queries in the function.

Fix: keep neighbor + tag resolution in a select-field-independent unit cached on
`id` alone (shared by both public and admin paths), so only the main row's field
set differs; or, cheaper, gate the metadata/page public fetch so an admin skips
it (metadata still needs public title/desc, so the clean fix is the shared
neighbor/tag unit). Confirm current cost with `SHOW SESSION STATUS LIKE
'Questions'` around one admin `/p/[id]` render.

### PERF5-02 — info-bottom-sheet touchmove preventDefault is a passive no-op (LOW-MED/High, Confirmed)

`handleTouchMove` (`info-bottom-sheet.tsx:140-151`) is a React `onTouchMove`
handler (wired at `:296`) that calls `e.preventDefault()` (`:142`, comment:
"prevent background scroll while dragging the sheet"). React ≥17 attaches touch
listeners **passive** at the root, so `preventDefault()` in a React `onTouchMove`
is a silent no-op — this is the identical defect cycle 4 just fixed in
image-zoom (C4-12): image-zoom now uses
`container.addEventListener('touchmove', handleTouchMove, { passive: false })`
(`image-zoom.tsx:317`) with a comment (`:262-267`) spelling out this exact
trap. info-bottom-sheet is the un-fixed sibling — the "fix one sibling, miss the
next" theme recorded repeatedly in CLAUDE.md's touch-target section.

Consequences: (a) the background page scrolls while the user drags the sheet
(the stated intent fails); (b) Chrome logs "Unable to preventDefault inside
passive event listener" once per touchmove frame — ~60 warnings/sec for the
whole drag, console-spam + per-event intervention overhead. Mobile-only path.

Fix: mirror C4-12 — attach touchmove natively with `{ passive: false }` on the
sheet ref; OR the cleaner declarative fix, set `touch-action: none` on the
draggable sheet element (info-bottom-sheet currently sets no `touch-action`,
unlike image-zoom's `:370` `touchAction` toggle). The interaction-correctness
half may be designer-owned (same cross-listing as C4-12).

### PERF5-03 — MasonryCard re-derives image-only strings on every resize bucket cross (LOW-MED/Med, Likely)

`estimatedCardWidth` is a per-card prop that "must force a re-render" (comment
`:25-27`) and changes for EVERY card whenever the quantized viewport width (48 px
bucket) or column count changes. Because it changes, `React.memo`'s shallow
compare never bails, so all mounted cards re-render. But of the derived values,
only `cardIntrinsicHeight` (`:58-60`) depends on `estimatedCardWidth`;
`displayTitle`/`altText` (`:47-48`, each walking tag names), `isWideGamut`
(`:61`), `photoAriaLabel` (`:62-64`), and the AVIF/WebP srcset template strings
+ regex replaces (`:84-100`) depend only on `image`. They all re-run per card
per bucket cross.

Scenario: after deep infinite scroll (~1000-1500 cards loaded), the user drags
the window edge; the rAF-debounced resize crosses a new 48 px bucket roughly
per frame, and each crossing re-runs N cards' string/regex derivations in one
synchronous commit → dropped frames on mid hardware during the drag. Off-screen
*paint* is already skipped by `content-visibility:auto`, but React reconciliation
+ the JS derivations still run. The C2-19 extraction (`:16-20`) helped the
append/unrelated-parent-flip cases but not the estimatedCardWidth-change case.

Fix: memoize the image-only derivations on `image` (a `useMemo` keyed on
`image`+`t`+`locale`), so a width-only change recomputes just
`cardIntrinsicHeight`; or pass the width to the grid container as a CSS custom
property and read `containIntrinsicSize` from it in CSS, so a bucket change
updates one element's style rather than busting N memoized children.

### PERF5-04 — bulkUpdateImages alt-suggested loop: N sequential UPDATEs in one txn (LOW-MED/Med, Likely)

`bulkUpdateImages`'s `applyAltSuggested` branch builds `toUpdate` then issues one
`tx.update(images).set(...).where(eq(images.id, id))` per row in a loop
(`:1170-1180`), up to the batch size (≤ `UPLOAD_MAX_FILES_PER_WINDOW`-class, 100).
All inside a single `db.transaction`, so the transaction holds row locks on up
to 100 image rows across ~100 sequential round-trips. On a NAS/remote MySQL
(5-10 ms RTT) that pins the transaction ~0.5-1 s, and every GalleryKit write is
already funneled through the admin-mutation barrier, so it serializes other
admin writes for that window.

Note the tag add/remove loops in the SAME function are already correctly batched
— one `insert(imageTags).ignore().values(existingImageIds.map(...))` per DISTINCT
tag (`:1189-1191`) and one `delete … where inArray(...)` per tag (`:1202-1204`),
bounded by tag count, not image count — so those are NOT a finding (the sub-lane
over-counted them). Only the per-row alt-caption UPDATE loop is sequential.

Fix: collapse `toUpdate` into one `UPDATE … SET title/description = CASE id WHEN
? THEN ? … END WHERE id IN (…)`, or group rows by identical caption. Admin-only
maintenance action, so MED-LOW; folds naturally with the C2-28/C4-24 admin-table
perf class.

### PERF5-05 — matchMedia subscription churn on info-panel toggle (LOW/High, Confirmed)

The breakpoint-sync effect (`photo-viewer.tsx:375-394`) creates a
`window.matchMedia('(min-width: 1024px)')` and adds a `change` listener, with
dependency array `[showBottomSheet, isPinned]`. The handler only READS those two
values. Every pin/unpin (I key or toolbar) or bottom-sheet open/close changes one
of them, so React runs the cleanup (`removeEventListener`) and re-runs the effect
(`matchMedia` + `addEventListener`) on each toggle — pure subscription churn while
a user flips the info panel across photos. Low absolute cost; it is exactly the
"matchMedia re-created per state change" pattern.

Fix: keep `showBottomSheet`/`isPinned` in refs synced by a tiny effect and give
the matchMedia effect `[]` deps so the subscription is created once per mount.

### PERF5-06 — per-wheel getBoundingClientRect during zoom (INFO/Low, Needs-validation)

The wheel handler reads `container.getBoundingClientRect()` per wheel event
(`image-zoom.tsx:104`) then writes `innerRef.style.transform`. The drag and pinch
paths read the rect once at gesture start; the wheel path reads per event. Honest
caveat: the zoom transform is applied to a composited CHILD (not a layout
property of the container), so the parent-rect read is unlikely to force a
synchronous reflow — this is marginal, flagged only because caching the rect for
the gesture duration (as the sibling paths do) removes the per-event read for
free. Lower priority than the sub-lane's initial rating.

## Cycle-4 fix verification (freshest-code regression check — all CLEAN)

- **SW respondWith de-gate (C4-08/`31ff51f5`, C4-42/`ad1fd22d`+`31ff51f5`):**
  `extendLifetime` (`sw.template.js:295-302`) returns `Promise.resolve()` when an
  `event` is present, so `await extendLifetime(event, touchMeta(...))` on the
  304/same-ETag branches (`:396,:415`) resolves IMMEDIATELY — the response is no
  longer gated behind the meta write. `networkFirstHtml` (`:456-474`) tees the
  body synchronously (`new Response(networkResponse.clone().body, …)` at `:460`)
  BEFORE `return networkResponse` (`:474`) and does `htmlCache.put` +
  `evictHtmlCacheIfNeeded` inside `void extendLifetime(...)` — streaming is
  restored, tee ordering is correct. No regression.
- **SW phantom-bytes (C4-02/`ad1fd22d`):** the eviction walk now decrements
  `total -= entry.size` UNCONDITIONALLY (`:129-137`), not gated on delete-success
  — verified against both `sw.template.js` and the `sw-cache.ts` mirror. Correct.
- **single-writer-guard self-heal (C4-06/`ce15103a`):** the re-acquire loop is
  sound — `scheduleReacquire` guards `stopping || heldConnection || reacquireTimer`
  (`:167-173`), the keepalive-catch and `conn.on('error')` paths both null
  `heldConnection` under an `=== conn` check so they can't double-schedule
  (`:130-155`), and the `stopping` latch is set first in `stopSingleWriterGuard`
  (`:310`) and re-checked after every await in reprobe/reacquire so a shutdown
  race never takes ownership. Not a hot path (startup + 60 s intervals). Only nit:
  `conn.on('error')` does not itself call `conn.end()` (relies on mysql2's fatal-
  error auto-destroy) — benign, not worth a finding.
- **gallery-config write-invalidation (C4-07/`12037508`), settings-hash no-arg
  sort (C4-19/`5efc…`), health probe coalesce (C4-20/`18b6cbb4`), embedding
  model-flip reset (C4-09/`d7ca37de`), serve-upload shared ETag helper
  (`e3d221e3`):** read, consistent with their commit intent, no new perf regression.

## Residual / status notes (NOT new findings)

- **PERF4-03 (touchMeta O(N·M)) — half-open.** The C4-42 de-gate removed the
  RESPONSE-path blocking, but the per-tile cost itself is unchanged: `touchMeta`
  (`sw.template.js:180-215`) still does a full `getMeta` parse + `setMeta`
  stringify of the ENTIRE meta document per confirmed-fresh tile, now under
  `withMetaMutation` in the background/`waitUntil`. A warm masonry paint still
  queues N serialized full-document rewrites (~25 KB JSON × N) — off the display
  path, so SW-lifetime CPU/IO, not first-paint latency. The "coalesce touches"
  half of PERF4-03's suggested fix is still unaddressed. Recording as the honest
  residual of the C4-42 close, per the CRIT3-07 forward-honesty lens.

## Deferred-register checks (no exit criteria fired)

- **C2-16 (non-sargable MONTH()/DAY() on-this-day scan per home render):**
  UNCHANGED at `data-timeline.ts:97-119`; still rendered on the highest-traffic
  surface (`(public)/page.tsx:234` `<OnThisDayWidget/>`, `revalidate = 0`). The
  in-code comment (`:88-96`) already documents the non-sargability. Exit criterion
  ("measured home latency OR next schema cycle folds the index") has NOT fired — no
  measurement this cycle, no schema cycle. Do NOT re-report; noting only that the
  home-page instance remains the highest-frequency of the three
  (home/timeline/year) YEAR/MONTH/DAY non-sargable sites, so it is the one to
  measure first if C2-16 is ever scheduled.
- **C2-12 (map one-marker-per-photo), C2-15 (view-record latency), C2-20
  (GPS-strip whole-file read), C2-21 (`(processed, updated_at, id)` index),
  C2-28/C4-24 (admin bulk-upload perceived lag), C2-55 (perf long-tail):** no new
  evidence produced this pass; exit criteria not fired.
- **Public `searchImages` leading-wildcard `LIKE '%term%'`** (`sql-like.ts:10` →
  `data.ts:1628-1646`, `actions/public.ts`): full-scan by design, rate-bounded
  (`SEARCH_MAX_REQUESTS`/min/IP), fundamental to the feature — long-standing, not
  new, out of scope for a fix without a FULLTEXT/external-index product decision.

## Verified clean (do not re-derive)

- Home page (`(public)/page.tsx:161-177`): the 6 independent fetches are
  `Promise.all`-parallelized; `getImagesLitePage` is legitimately serial (needs
  validated tag slugs). `getCspNonce` (`:170`) is a cheap header read.
- Analytics aggregation (`analytics-data.ts`): admin-only, retention-bounded
  (VIEW_RETENTION_DAYS), backed by the migration-0026 `(bot, viewed_at, id)`
  indexes. Not a public hot path.
- `batchUpdateImageTags` (`tags.ts`) and `bulkUpdateImages` tag loops: batched by
  tag count via `inArray`, not per-image N+1.
- data.ts listing queries (`getImagesLitePage`, feed, sitemap, smart-collection):
  LIMIT-bounded with `+1` lookahead; `tagNamesAgg` GROUP_CONCAT shape intact.
