# Cycle 81 Designer / Accessibility Review

Reviewed HEAD: `4733d475be8f19fbddf4b82b589e28d6ca083992`

Scope: public map marker accessible labels and display-title fallback behavior, plus a targeted sweep of public/admin interactive surfaces that affect touch targets, GPS disclosure, and meaningful photo labels.

## Inventory

- Public map: `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/map-client.tsx`, `apps/web/src/lib/data.ts`.
- Public photo labels: `apps/web/src/lib/photo-title.ts`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`.
- Public/admin touch and GPS surfaces: `apps/web/src/components/load-more.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/components/image-manager.tsx`.
- Regression guards sampled: `apps/web/src/__tests__/map-thumb-wiring.test.ts`, `apps/web/src/__tests__/gps-map-link-touch-targets.test.ts`, `apps/web/src/__tests__/photo-title.test.ts`, `apps/web/src/__tests__/alt-text-fallback.test.ts`, `apps/web/src/__tests__/touch-target-audit.test.ts`.

## Findings

### MEDIUM: map `displayTitle` bypasses the gallery's meaningful-title fallback rules

`apps/web/src/app/[locale]/(public)/map/page.tsx:54-60` builds map marker `displayTitle` as `img.title ?? tPhoto('titleWithId', { id: img.id })`. That is an improvement over raw numeric labels, but it still accepts whitespace-only and filename-like titles such as `IMG_0001.JPG`.

Other public photo surfaces route through the shared title helpers. `getPhotoDisplayTitle()` rejects empty/whitespace and filename-like titles before falling back (`apps/web/src/lib/photo-title.ts:33-56`), and listing/viewer/lightbox alt text uses `getConcisePhotoAltText()` (`apps/web/src/components/home-client.tsx:293-294`, `apps/web/src/components/photo-viewer.tsx:424-508`, `apps/web/src/components/lightbox.tsx:499-502`). The existing tests lock that expectation for filename-like titles and tag/alt fallbacks (`apps/web/src/__tests__/photo-title.test.ts:49-59`, `apps/web/src/__tests__/alt-text-fallback.test.ts:35-40`).

Impact: public map popup images and open-photo buttons can still expose low-meaning accessible names like `Open photo: IMG_0001.JPG` or effectively blank whitespace, while the same photo is labeled better elsewhere. This is a photographer-facing trust issue because the map is an explicit location-browsing surface where users need distinguishable, human labels.

Recommendation: derive map `displayTitle` through the same helper contract. Minimum fix: use `getPhotoDisplayTitle(img, tPhoto('titleWithId', { id: img.id }))` so filename-like/blank titles fall back consistently. Better fix, if map rows can afford it, add the same public tag/alt inputs used by listing/viewer labels and call `getPhotoDisplayTitleFromTagNames()` / `getConcisePhotoAltText()` as appropriate.

## Non-Findings

- Map marker accessible wiring is otherwise correct: `MapMarker` carries `displayTitle`, popup thumbnails use `alt={marker.displayTitle}`, and the popup button label is `Open photo: {displayTitle}` (`apps/web/src/components/map/map-client.tsx:15-23`, `apps/web/src/components/map/map-client.tsx:53-73`, `apps/web/src/components/map/map-client.tsx:126-136`).
- The map page has a keyboard/screen-reader escape hatch: a focusable skip link, `aria-labelledby` / `aria-describedby` around the map region, and an accessible photo list using the same marker titles (`apps/web/src/app/[locale]/(public)/map/page.tsx:71-101`).
- Public GPS disclosure remains opt-in and guarded: `getMapImages()` is the only public lat/lng select path, joins `topics.map_visible = true`, requires non-null coordinates, and runtime-asserts every row's map-visible flag (`apps/web/src/lib/data.ts:410-445`, `apps/web/src/lib/data.ts:1709-1745`). Admin publication also requires an explicit confirmation before enabling map visibility (`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:82-88`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:290-319`).
- Public touch targets sampled are at or above 44 px: map popup button `min-h-[44px] min-w-[44px]`, map list links `min-h-11`, load-more `min-h-11`, back-to-top `min-h-11 min-w-11`, lightbox controls `h-11 w-11` or larger edge hit zones, and mobile bottom-sheet drag/close controls `min-h-11` / `min-w-11` (`apps/web/src/components/map/map-client.tsx:126-136`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-98`, `apps/web/src/components/load-more.tsx:157-163`, `apps/web/src/components/home-client.tsx:448-459`, `apps/web/src/components/lightbox.tsx:554-659`, `apps/web/src/components/info-bottom-sheet.tsx:223-254`).
- Admin GPS Google Maps links have explicit 44 px target guards in both desktop viewer and mobile sheet tests; the reviewed source includes `inline-flex min-h-11 min-w-11` on those anchors (`apps/web/src/__tests__/gps-map-link-touch-targets.test.ts:20-29`, `apps/web/src/components/photo-viewer.tsx:887-890`, `apps/web/src/components/info-bottom-sheet.tsx:464-467`).
- Admin image edit/delete row controls sampled carry explicit `h-11 w-11` and meaningful per-image labels (`apps/web/src/components/image-manager.tsx:553-560`). Remaining documented admin touch-target exemptions are already tracked by `touch-target-audit.test.ts`, not newly re-raised here.

## Validation Evidence

- `git rev-parse HEAD` returned `4733d475be8f19fbddf4b82b589e28d6ca083992`.
- `npm test --workspace=apps/web -- map-thumb-wiring gps-map-link-touch-targets photo-title alt-text-fallback` passed: 5 files, 51 tests.
- `npm test --workspace=apps/web -- touch-target-audit` passed: 1 file, 16 tests.
- Initial validation attempt with `--runInBand` failed because Vitest 4.1.9 does not accept that Jest flag; reran without it successfully.
