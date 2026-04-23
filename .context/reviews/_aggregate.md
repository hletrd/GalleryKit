# Aggregate Review — Cycle 1 (2026-04-23)

## Scope
Merged the current-cycle review outputs under `.context/reviews/`, revalidated the claims against current HEAD, deduped overlaps, and excluded stale findings that no longer reproduce.

## Reviewer inventory used this cycle
Registered reviewer roles included or attempted this cycle:
- `code-reviewer`
- `security-reviewer`
- `critic`
- `verifier`
- `test-engineer`
- `architect`
- `debugger`
- `designer`
- leader-authored `performance-reviewer` supplement (exact `perf-reviewer` agent unavailable)

Requested but not registered in this environment:
- `document-specialist`
- `perf-reviewer` (closest available coverage provided via leader-authored `performance-reviewer.md`)
- `tracer`
- `api-reviewer`
- `quality-reviewer`
- `style-reviewer`

## Validation notes
- Several per-agent files repeated an older exact-multiple pagination finding. That finding was **rejected** during aggregation because current code already returns `hasMore` from `loadMoreImages()` and locks it with unit coverage in `apps/web/src/app/actions/public.ts:10-25`, `apps/web/src/components/load-more.tsx:28-40`, and `apps/web/src/__tests__/public-actions.test.ts:88-99`.
- Multiple agents independently converged on a broader “route-level async choreography” concern. Manual validation narrowed that theme to the photo/share entrypoints listed below; the home/topic/load-more files cited in stale outputs no longer reproduce the reported bug shape.

## Deduped validated findings

### AGG-01 — Photo/share route entrypoints still serialize independent cached reads on the request hot path
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Cross-agent signal:** High — the route-level async-latency theme appeared in `code-reviewer.md`, `critic.md`, `verifier.md`, `architect.md`, and `debugger.md`; manual validation narrowed it to the currently reproducing files below.
- **Files:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:25-29,41,68`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:33-46,84-95`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:28-40,95-97`
- **Why it is a problem:** These entrypoints still defer `getGalleryConfig()` / `getSeoSettings()` / locale and translation reads until after other awaited calls finish, even though those reads are independent and cacheable.
- **Concrete failure scenario:** Direct photo/share visits and OG crawler requests accumulate avoidable latency before rendering or metadata generation starts returning bytes.
- **Suggested fix:** Restructure the affected entrypoints into `Promise.all` groups so only truly dependent work remains sequential.

### AGG-02 — Untitled photo pages use inconsistent fallback titles across metadata, JSON-LD, and viewer UI
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Cross-agent signal:** Medium — uncovered during aggregate validation while checking the photo-route findings.
- **Files:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:53-63,140-145`, `apps/web/src/components/photo-viewer.tsx:366-371`, `apps/web/src/components/info-bottom-sheet.tsx:119-123`
- **Why it is a problem:** `generateMetadata()` falls back to `photo.titleWithId` (for example, “Photo 42”), while the page JSON-LD/breadcrumb data and the viewer/sidebar sheet fall back to a generic untitled label.
- **Concrete failure scenario:** Untitled photos expose different names across the browser title, structured data, and on-page UI, which creates inconsistent SEO metadata and user-facing labeling for the same asset.
- **Suggested fix:** Centralize photo display-title generation in one shared helper and reuse it everywhere the public photo/share surfaces derive titles.

### AGG-03 — Photo viewer JPEG fallback bypasses configured derivatives and can download the largest asset unnecessarily
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Cross-agent signal:** Medium — confirmed directly in the leader-authored performance pass.
- **Files:** `apps/web/src/components/photo-viewer.tsx:179-223`
- **Why it is a problem:** The fallback `<Image>` / `<img>` path points at `image.filename_jpeg` without derivative selection or `srcSet`, so non-AVIF/WebP rendering paths can over-download.
- **Concrete failure scenario:** Browsers or intermediaries that do not use the AVIF/WebP `<source>` tags fetch a full-size JPEG even when the viewport only needs a much smaller derivative, increasing transfer time and LCP.
- **Suggested fix:** Build the JPEG fallback from configured derivative sizes as well — ideally with `srcSet` + `sizes`, or at minimum with a nearest-sized derivative.

## AGENT FAILURES
- `perf-reviewer`: exact agent type not registered in this environment. Covered by leader-authored `performance-reviewer.md`.
- `document-specialist`: not registered in this environment.
- `tracer`: not registered in this environment.
- Initial `architect` / `debugger` / `designer` spawns hit the platform thread limit (`max 6`) on the first batch; they were retried once as required.

## Final sweep
No additional confirmed security issue surfaced in the current checkout. The highest-signal remaining work for this cycle is performance/correctness cleanup around photo/share entrypoints plus title/fallback consistency on the photo surface.
