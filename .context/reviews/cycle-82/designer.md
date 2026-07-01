# Cycle 82 Designer / UX / Accessibility Review

Reviewed HEAD: `1982efcc7911f3a8af3afa4cb1be2cae28b76ace`.
Date: 2026-07-01.

## Inventory

- Required context read first: `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions.
- UI inventory built from `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/app/[locale]/admin/**`, `apps/web/src/components/**`, `apps/web/messages/{en,ko}.json`, `apps/web/src/__tests__/*a11y*`, focus/touch/search/photo-title/map tests, and `apps/web/e2e/**`.
- Static DOM/component sweep covered public IA/navigation, home masonry cards, search overlay, map, photo viewer, lightbox, mobile info sheet, color/HDR audit surfaces, upload/dropzone, admin dashboard/image manager, categories/tags/users/settings/SEO/tokens/DB pages, loading/empty/error states, focus rings, and touch-target contracts.
- Recent baseline checked: Cycle 78-81 designer/accessibility reviews plus current Cycle 82 architect/code-reviewer/test-engineer artifacts. I did not re-raise `C75-08`, `C76-04`, `C76-05`, `C80-06`, or Cycle 81's now-fixed map title issue.

## Findings

### D82-UX-01 - Search and similar-photo result labels bypass the meaningful photo-title fallback

- Severity: Medium.
- Confidence: High.
- Citations: `apps/web/src/components/search.tsx:101`, `apps/web/src/components/search.tsx:103`, `apps/web/src/components/similar-photos.tsx:179`, `apps/web/src/components/similar-photos.tsx:182`, `apps/web/src/lib/data.ts:1519`, `apps/web/src/lib/data.ts:1522`, `apps/web/src/lib/data.ts:1565`, `apps/web/src/lib/data.ts:1571`, `apps/web/src/lib/photo-title.ts:42`, `apps/web/src/lib/photo-title.ts:55`, `apps/web/src/app/[locale]/(public)/map/page.tsx:60`.
- Problem: The public search result row and the production-only similar-photo thumbnails render raw `image.title || image.description || Photo {id}`. That path accepts whitespace-only and filename-like titles such as `IMG_0001.JPG`, while the gallery's shared helper rejects those before falling back to tags or a localized photo id. The search result data shape also does not carry `tag_names` or `alt_text_suggested`, so search cannot currently match the masonry/viewer/map fallback quality.
- Failure scenario: A photographer imports camera-default titles, then a visitor searches by camera, lens, topic, or semantic query. The result list shows and announces `IMG_0001.JPG` or an effectively blank title, even though the same photo is labeled with meaningful tags/fallbacks in the masonry grid, viewer, shared pages, and the fixed map. This weakens public search as a trusted discovery surface.
- Suggested fix: Route search and similar result labels through a shared display-label helper. Prefer adding safe public `tag_names` and/or `alt_text_suggested` to search/enrichment selects, then use `getPhotoDisplayTitleFromTagNames()` / `getConcisePhotoAltText()`. At minimum, trim titles, reject `isFilenameLikeTitle()`, and fall back to localized `Photo {id}`. Add source-contract tests covering `IMG_0001.JPG` and whitespace titles in `SearchResultItem` and `SimilarPhotos`.

### D82-UX-02 - Failed-image retry buttons have repeated accessible names

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:80`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:100`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:103`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:107`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:115`, `apps/web/messages/en.json:71`, `apps/web/messages/ko.json:71`.
- Problem: Each failed-image row exposes the same button name, `Retry` / `재시도`, with no `aria-label`, `aria-labelledby`, or `aria-describedby` tying it to the row's title, filename/id, or processing error.
- Failure scenario: An admin using a screen reader's button list hears several identical "Retry" controls and cannot choose the intended failed photo without leaving button navigation and reconstructing row context. For a recovery panel that may contain multiple failed imports, this is avoidable friction.
- Suggested fix: Add localized `retryImageAria` / `retryingImageAria` copy that includes the row label (`title ?? user_filename ?? ID {id}`), and apply it to the retry button. Consider adding stable ids for the row label/error and `aria-describedby` so the failure reason is available from the control. Add a source-contract test for per-row retry button names.

## Non-Findings

- The Cycle 81 map title issue is fixed in current source: marker `displayTitle` now routes through `getPhotoDisplayTitle()` and the popup/list consume `marker.displayTitle`.
- Touch-target and focus-visible source checks passed for the sampled public/admin surfaces; no new sub-44 interactive target was confirmed.
- The reviewed lightbox, mobile bottom sheet, upload dropzone, GPS map disclosure, color/HDR audit, loading, empty, and route error surfaces already have explicit labels/status regions or existing source-contract coverage. I found no new confirmed issue there.
- I did not start a local browser session; the findings above are source-confirmed and do not require data-backed rendering to reproduce.

## Validation Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/photo-title.test.ts src/__tests__/map-thumb-wiring.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/failed-image-retry.test.ts` passed: 6 files, 71 tests.
- No source files were modified by this lane.
