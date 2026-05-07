# Cycle 6 RPF (end-only) — Aggregate Review

## Method

Deep code review focused on professional photographer workflow: import/ingest flow, metadata handling, EXIF display, gallery browsing UX, sharing workflows, organization, search/discovery, download/export, mobile experience, and workflow friction. Single-pass review (no formal agent roster in `.claude/agents/`). Findings validated by cross-referencing multiple file paths and component interactions.

## Gate baseline

- Prior cycles verified clean gates. This cycle starts from current HEAD (fb46c09).

## Cycles 1-5 RPF carry-forward verification

~35 issues fixed across cycles 1-5. All prior cycle fixes verified in code. Focus exclusively on NEW findings.

## i18n completeness check

Ran full key-comparison between `en.json` and `ko.json`: **0 missing keys**. The C5-RPF-02 fix (lrToken keys) is confirmed complete.

## Findings (severity-sorted)

### MEDIUM

#### C6-RPF-01 — Lightbox missing visible photo position indicator

- File: `apps/web/src/components/lightbox.tsx:366-571`
- Reference: `apps/web/src/components/photo-viewer.tsx:619-625` (main viewer shows position)
- Severity: **Medium** | Confidence: **High**
- **What:** The main photo viewer shows a visible "1 / 5" position counter at the bottom of the image area (line 622). When the user enters fullscreen lightbox mode (pressing `F`), this counter disappears. The lightbox only encodes position in an `aria-label` on the `<img>` element (line 420-423: `aria-label="{currentIndex + 1} / {totalCount}"`), which is invisible to sighted users. A photographer evaluating a series of 50+ wedding photos in fullscreen mode has no visual indication of where they are in the sequence. The slideshow mode compounds this — after 30 seconds of auto-advance, the photographer has no idea how far through the album they've progressed.
- **Fix:** Add a visible position counter in the lightbox controls overlay (bottom center, matching the main viewer pattern), conditionally rendered when `currentIndex != null && totalCount != null && totalCount > 1`. Style with `bg-black/70 text-white text-xs px-3 py-1 rounded-full` to match the main viewer counter.

#### C6-RPF-02 — Shared group grid cards lack aspect-ratio, causing CLS on scroll

- File: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:177-209`
- Reference: `apps/web/src/components/home-client.tsx:198-199` (home grid sets aspectRatio)
- Severity: **Medium** | Confidence: **High**
- **What:** The shared group grid renders each image card as a `<Link>` with `block break-inside-avoid` but no explicit dimensions. Before the lazy-loaded `<img>` finishes rendering, each card has zero height. As the user scrolls, cards jump from zero to full height as each image loads, producing visible content displacement. This was noted in C5-RPF-06 but assessed as "Cosmetic perf issue; shared group pages are typically small." However, the impact is real: a 30-photo shared wedding gallery shows 30 layout jumps during the first scroll-through, which looks broken and unprofessional when shared with clients. The home grid avoids this entirely by setting `style={{ aspectRatio: \`\${image.width} / ${image.height}\` }}` on the container div.
- **Fix:** Add `style={{ aspectRatio: \`${image.width} / ${image.height}\`, backgroundColor: 'hsl(var(--muted))' }}` to the Link wrapper in the shared group grid, matching the home grid pattern. Also add `containIntrinsicSize` for content-visibility optimization.

#### C6-RPF-03 — Search results omit capture date — key disambiguator for photographers

- File: `apps/web/src/components/search.tsx:23-33, 308-315`
- Reference: `apps/web/src/lib/data.ts:1114-1128` (backend returns `capture_date`)
- Severity: **Medium** | Confidence: **High**
- **What:** The search result list shows title, topic label, and camera model, but not the capture date. The backend `searchImages()` already returns `capture_date` in its result set, and the server action `searchImagesAction` passes it through. The client-side `SearchResult` interface (line 23-33) simply doesn't include it. For a photographer searching their gallery for "wedding ceremony", the date is often the primary disambiguator between multiple events with the same topic. Without it, the photographer must click into each result to check the date.
- **Fix:** Add `capture_date` to the client-side `SearchResult` interface and render it (formatted via `formatStoredExifDate`) in the search result subtitle alongside the topic and camera model.

### LOW

#### C6-RPF-04 — Ken Burns CSS custom properties (`--kb-start`, `--kb-end`) are set but never consumed by `@keyframes`

- File: `apps/web/src/components/lightbox.tsx:429-430` (sets `--kb-start`, `--kb-end`)
- File: `apps/web/src/app/[locale]/globals.css:219-227` (defines keyframes with hardcoded transforms)
- Severity: **Low** | Confidence: **High**
- **What:** The lightbox sets `--kb-start` and `--kb-end` CSS custom properties on the image element (lines 429-430), intending them to drive the Ken Burns animation. However, the `@keyframes lightbox-ken-burns-0` and `lightbox-ken-burns-1` in globals.css use hardcoded `transform` values instead of `var(--kb-start)` / `var(--kb-end)`. The animation works correctly because the hardcoded keyframe values happen to match the output of `kenBurnsTransform()`, but the custom properties are dead code. This creates a maintenance trap: if someone changes `kenBurnsTransform()` without also editing globals.css, the animation and the intent will silently diverge.
- **Fix:** Either (a) update the @keyframes to use `var(--kb-start)` and `var(--kb-end)` so the animation is driven by the JS-side parameters, or (b) remove the `--kb-start` / `--kb-end` assignments from the inline style since they serve no purpose.

#### C6-RPF-05 — PhotoViewer loading skeleton uses fixed 4:3 aspect ratio regardless of actual photo dimensions

- File: `apps/web/src/components/photo-viewer-loading.tsx:16`
- Severity: **Low** | Confidence: **Medium**
- **What:** The loading skeleton uses `aspect-[4/3]` which may not match the actual photo's aspect ratio. When the real image loads, the skeleton-to-content transition can cause a subtle layout shift. For a landscape panorama (3:1) or a portrait (2:3), the mismatch is noticeable.
- **Fix:** This is a minor CLS issue during the loading-to-loaded transition. The skeleton is shown during SSR streaming, so the mismatch is brief. Could be improved by accepting an optional `aspectRatio` prop from the parent, but the effort may not be justified.

#### C6-RPF-06 — Shared group grid images use single-size srcSet (not responsive multi-size)

- File: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:186-202`
- Reference: `apps/web/src/components/home-client.tsx:224-233` (home grid uses 2-size responsive srcSet)
- Severity: **Low** | Confidence: **High**
- **What:** The shared group grid uses a single `gridImageSize` for the AVIF/WebP srcSet attributes (lines 189, 195), meaning the browser always downloads the same size regardless of viewport. The home grid uses a 2-size responsive srcSet (small + medium) so mobile devices download smaller files. On a shared wedding gallery viewed on a phone, each thumbnail downloads the desktop-size derivative, wasting bandwidth.
- **Fix:** Use a 2-size srcSet matching the home grid pattern, with appropriate `sizes` attribute for the shared group layout.

## Summary

5 actionable findings (3 MEDIUM, 3 LOW). The medium findings address photographer-visible UX gaps: missing position indicator in fullscreen mode, CLS in shared galleries sent to clients, and missing capture dates in search results. All three directly affect the professional photographer's daily workflow of reviewing, organizing, and sharing photos.

## Cross-agent agreement

Single-pass review (no formal agent roster). Findings validated by cross-referencing component code, backend data layer, CSS, and i18n files. Prior cycle findings (C5-RPF-01 through C5-RPF-06) verified in code.