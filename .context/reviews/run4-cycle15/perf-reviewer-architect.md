# Run-4 Cycle 15 — perf-reviewer + architect angles

Single-subagent in-context execution (documented run-wide constraint).
Full passes over the cycle-15 rotation set with emphasis on the map
cluster, the app-shell render path, and the micro-libs' hot-path use.

## PERF-R4C15-02 — map popup downloads the full-resolution base JPEG for a 120×80 thumbnail (and bypasses `imageUrl()`) — MED/High (CONFIRMED)

**Files:**
- `apps/web/src/components/map/map-client.tsx:91-99` — popup `<img
  src={'/uploads/jpeg/' + marker.filename_jpeg}>` with `width={120}
  height={80}`.
- `apps/web/src/components/map/map-loader.tsx` — props carry no
  `imageSizes`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx` — never calls
  `getGalleryConfig()`.

**Why it is a problem:**
1. `filename_jpeg` is the BASE derivative name — the largest configured
   size (default 4096-class, multi-MB for detailed photos). Every
   marker-popup open fetches it to paint a 120×80 thumbnail. On mobile
   data over a map (the canonical traveling-photographer use case) this
   is the single most expensive image fetch in the product for the
   least pixels delivered.
2. The URL literal skips `imageUrl()`, so `IMAGE_BASE_URL`-fronted
   (CDN) deployments break for exactly this surface — every other image
   consumer in `src/` routes through `imageUrl`/`sizedImageUrl`.
3. The repo already standardized the solution: search rows (R23-M1),
   lightbox (R21-M1) and the per-photo viewer (R22-M1) all use
   `sizedImageUrl('/uploads/jpeg', name, target, imageSizes)` with a
   one-shot `onError` fallback to the base name for legacy photos
   (encoder atomic-rename contract guarantees the base exists).

**Concrete failure scenario:** gallery with 60 MP drone photos; admin
enables map for a travel topic; visitor on LTE taps three markers;
~30+ MB transferred for three 120 px thumbs; popups paint seconds late
(Leaflet shows the empty popup frame meanwhile).

**Fix:** plumb `imageSizes` page → MapLoader → MapClient (page uses the
React-cache()'d `getGalleryConfig()` — zero extra DB cost in a request
where Nav already resolved it), render thumbs via a small `MarkerThumb`
component that mirrors the SearchResultItem sized-URL + one-shot
fallback idiom (target 128 → nearest configured size, typically 640).
Confidence High.

## PERF-R4C15-B — `getMapImages()` is unbounded; FitBounds spreads coordinate arrays — LOW/Medium (defer)

**File:** `apps/web/src/lib/data.ts:1528-1545`;
`components/map/map-client.tsx:40-46`.

No LIMIT on the marker query: every processed GPS-tagged image in every
map-visible topic ships in the RSC payload on every request
(`revalidate = 0`) and mounts an individual Leaflet `<Marker>`. At
personal-gallery scale (hundreds of photos) this is fine; at ~2k+
markers the payload and marker-DOM cost will degrade the page; at
~65k+ `Math.min(...lats)` risks argument-list limits. No fix scheduled
this cycle — clustering (supercluster / leaflet.markercluster) is a
product decision. DEFER with exit criteria in plan-302.

## Architect angle

- **COR-R4C15-01 fix-shape** (concurs with critic): extract
  `resolveErrorShellThemeClass` next to `resolveErrorShellBrand` in
  `lib/error-shell.ts`. That module exists precisely to make the
  global-error shell's environment-sniffing logic pure and testable;
  the theme detection is the only remaining inline sniff. Keep the
  return contract closed (`'oled' | 'dark' | null`) so a future 5th
  theme forces a conscious decision here rather than silently falling
  through to light.
- **Audit-pattern erosion (DES-R4C15-03)**: this is the loop's
  recurring failure mode in its touch-target incarnation — a blocking
  gate exists, a violation shape evades its pattern set, and the gap
  persists precisely because the gate's green status reads as "policy
  holds". The FORBIDDEN set models size literals (`h-8`/`h-9`/`h-10`)
  on `Button|button` tags only; arbitrary-value classes
  (`min-h-[32px]`) and `asChild` slot wrappers (`<Badge asChild>` →
  className lands on the child `<button>` at runtime) are both
  invisible to it. Fix-shape: extend the normalizer tag set to include
  `Badge` and add sub-44 arbitrary `min-h-[NNpx]` FORBIDDEN patterns
  (with the same `h-11|min-h-11|size-11` negative-lookahead the
  size="sm" pattern uses), plus failing-fixture coverage, so the gate
  catches the next instance of this shape.
- **App-shell render path** — clean: `nav.tsx` parallelizes its three
  data fetches; `getGalleryConfig`/`getSeoSettings`/`getTopicsCached`
  are cache()-wrapped (per-request dedup verified at
  `gallery-config.ts:204`, `data.ts`); nav-client's matchMedia listener
  and rAF are cleaned up; masonry-adjacent surfaces untouched.
- **Micro-lib layering** — clean: `color-pipeline-decisions.ts`,
  `color-primaries.ts`, `image-types.ts`, `theme.ts`,
  `error-shell.ts` are all dependency-free client-safe modules;
  `bounded-map.ts` documents its consumer-driven `prune()` contract;
  `upload-paths.ts` is the single source for upload roots as
  documented. No layering violations found in the rotation set.
- **`lib/storage/*` honesty** — the types.ts header explicitly states
  the abstraction is NOT wired end-to-end, matching CLAUDE.md's
  "Storage Backend (Not Yet Integrated)" note. No drift.
