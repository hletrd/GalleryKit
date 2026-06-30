# Cycle 41 Critic + Designer Review

Date: 2026-07-01
Current HEAD reviewed: `39247fd5`
Lane: UI/UX, accessibility, i18n, information architecture, and photographer-facing product-policy risk.
Mode: deep review only; no implementation beyond this artifact.

## Inventory

Reviewed public route surfaces: home/topic/smart collection grids, photo viewer, single-share `/s/[key]`, shared group `/g/[key]`, timeline, year review, GPS map, privacy, global loading/error/not-found, nav/search, lightbox, bottom sheet, color details, histogram, similar photos, load-more, and empty states.

Reviewed admin UI surfaces: dashboard/image manager, upload dropzone, bulk edit dialog, settings, SEO, categories, tags, users, tokens, password, DB backup/restore, analytics, admin nav/header/login.

Reviewed policy-sensitive surfaces: color/HDR labels and download copy, wide-gamut hint, public/admin HDR badges, semantic search, similar-photo recommendations, auto alt-text hints, public map/GPS exposure, shared-link presentation, metadata edit/bulk edit wording, and scoring/culling/editing drift signals.

Local evidence used:

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/focus-visible-rings-cycle19.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/semantic-search-params.test.ts` -> 5 files, 41 tests passed.
- Source inspection of route/component inventories under `apps/web/src/app/[locale]`, `apps/web/src/components`, `apps/web/messages`, `apps/web/src/__tests__`, and recent Cycle 41 lane artifacts.
- Browser session not started; local DOM/a11y/source evidence was enough for this read-only pass.

## Findings

### UX-C41-01 - Shared-link photo viewers can surface whole-library similar photos outside the shared set

Severity: Medium
Confidence: High

Evidence:

- Shared single-photo pages pass `isSharedView` and still forward the global `semanticSearchMode` into `PhotoViewer`: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:133-149`.
- Shared group selected-photo pages do the same: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:159-174`.
- `PhotoViewer` hides some normal gallery navigation for shared views, but renders `SimilarPhotos` unconditionally whenever production semantic search is enabled: `apps/web/src/components/photo-viewer.tsx:558` and `apps/web/src/components/photo-viewer.tsx:770`.
- `SimilarPhotos` is gated only on `semanticSearchMode === 'production'`; it has no `isSharedView` or allowed-id scope: `apps/web/src/components/similar-photos.tsx:114-124`.
- The similar-photo API scans the most recent production embeddings across all processed images, excluding only the current image: `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`.
- Result enrichment also filters only by result IDs and `images.processed = true`, not by share key or shared group membership: `apps/web/src/app/api/search/similar/[id]/route.ts:224-240`.
- The similar thumbnails link to canonical public photo URLs (`/p/{id}`), not back into the share context: `apps/web/src/components/similar-photos.tsx:203-208`.

Failure scenario:

A photographer sends a curated shared group or single-photo link to a client. If production semantic search is enabled, opening the info panel can show "Similar photos" drawn from the full processed gallery, including images that were not part of that share package. Even when those photos are otherwise public, the shared-link UX stops being a curated delivery surface and becomes a discovery path into the broader library. For client proofing/delivery, that can expose unrelated jobs, confuse the intended narrative, and undermine the share boundary the UI otherwise implies.

Suggested fix:

Hide `SimilarPhotos` whenever `isSharedView` is true, or pass an explicit scope into the component/API and constrain results to the current shared group's image IDs. Add a source-contract or component test proving shared views do not render a whole-library similar-photo control.

### UX-C41-02 - Public semantic/similar APIs expose numeric similarity scores despite the no-scoring product policy

Severity: Low
Confidence: Medium

Evidence:

- The semantic route computes per-photo `score` values, includes them in `enrichedResults`, sorts by them, and returns them in the public JSON response: `apps/web/src/app/api/search/semantic/route.ts:301-364`.
- The similar-photo route has the same public response shape: `apps/web/src/app/api/search/similar/[id]/route.ts:191-201` and `apps/web/src/app/api/search/similar/[id]/route.ts:209-269`.
- The visible search UI discards `score` when mapping semantic results into `SearchResult`: `apps/web/src/components/search.tsx:217-235`.
- The similar-photo UI carries `score` in the TypeScript interface but does not render it: `apps/web/src/components/similar-photos.tsx:14-30` and `apps/web/src/components/similar-photos.tsx:151-170`.
- Tests assert the public response exposes and orders by score: `apps/web/src/__tests__/semantic-search-route.test.ts:469-475`.

Failure scenario:

GalleryKit's stated photographer policy is no editing/culling/scoring features. The UI does not display quality scores, but a public visitor or integrator inspecting network responses sees numeric scores attached to image results. Those are similarity/ranking scores rather than aesthetic ratings, but exposing them as a public field still creates a "photo score" surface and invites downstream reuse as ranking, quality, or culling metadata.

Suggested fix:

Keep scores internal to server-side ordering and strip them from public API responses before returning JSON. If a debug score is needed, gate it behind an admin-only/debug-only path and name it explicitly as `similarityScore` with copy that it is not a quality rating.

## Clean / Rechecked Surfaces

- WCAG/touch target scan stayed green on the targeted audit. The shared Button/Switch primitives still floor interactive controls at 44 px, and no new public route-level sub-44 control surfaced in this pass.
- Focus/keyboard patterns remain intentionally covered: search uses a focus trap plus combobox/listbox semantics, lightbox/image zoom guard editable targets, dialogs use Radix/focus-trap primitives, and loading/result changes have polite live regions.
- i18n key parity passed. The reviewed visible UI strings for semantic search, color/HDR, downloads, map, timeline, and shared pages are keyed in both `en.json` and `ko.json`.
- Color/HDR honesty looks aligned after the Cycle 40 download-label fix: JPEG download labels derive from public-safe gamut plus `forceSrgbDerivatives`, HDR public badges remain guarded, and wide-gamut copy explains sRGB/P3 delivery instead of implying unavailable HDR output.
- Product-policy scan did not find active edit/crop/retouch/culling/rating UI. Admin metadata edit and bulk edit remain title/description/tag/topic management, not image editing or culling.

## Deferred / Not Re-raised

I did not re-raise known carried items such as legacy scanner/test hardening, analytics table scope polish, old touch-target advisory items, or Cycle 40/41 scanner/documentation findings from other lanes. No new UI evidence changed their severity or made them scheduled from this lane.

## Disposition

New findings: 2.

- `UX-C41-01` is the schedule-worthy item for the designer/product lane because it affects client-facing share boundaries.
- `UX-C41-02` is lower severity but worth deciding explicitly because the current public wire shape conflicts with the "no scoring features" policy more than the visible UI does.
