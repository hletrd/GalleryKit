# Cycle 40 UI / Accessibility / Photographer Review

Date: 2026-07-01
Reviewer lane: UI/UX, accessibility, photographer-facing product risks, i18n, responsive layouts, keyboard/focus, 44px targets, color/HDR honesty, loading/empty/error states.
HEAD reviewed: `490b93c5`

## Inventory Reviewed

- Public viewer surfaces: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/photo-navigation.tsx`.
- Public browsing/search/map/archive surfaces: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/map/map-client.tsx`, `apps/web/src/app/[locale]/(public)/{p,g,s,map,timeline,year}/...`.
- Admin/UI controls and current known area: `apps/web/src/components/admin-user-manager.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`.
- i18n and guardrails: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/__tests__/touch-target-audit.test.ts`, `i18n-key-parity.test.ts`, `photo-viewer-no-hdr-download.test.ts`, `free-download-contract.test.ts`.
- Prior baseline checked: `.context/reviews/cycle-39-2026-06-30/ui-accessibility.md` and aggregate. The Cycle 39 search-status finding is fixed in current source and is not re-raised.

## Findings

### UI-C40-01 - Wide-gamut JPEG download is mislabeled as sRGB on public desktop and mobile viewers

Severity: medium
Confidence: high

Evidence:
- `apps/web/src/lib/gallery-config-shared.ts:107-108` defaults `force_srgb_derivatives` to `false`, with the comment that P3 sources get P3-tagged WebP/JPEG by default.
- `apps/web/src/lib/process-image.ts:1078-1081` sets `targetIcc` to `p3` for wide-gamut sources unless `forceSrgbDerivatives` is true, and `apps/web/src/lib/process-image.ts:1359-1373` writes JPEG derivatives with that `targetIcc`.
- Public photo/share routes pass the resolved setting into the viewer: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:277-292`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:159-173`, and `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:133-148`.
- Despite that, the desktop download menu always labels the JPEG anchor as `viewer.downloadSrgbJpeg` at `apps/web/src/components/photo-viewer.tsx:951-959`, while the href is the base JPEG derivative from `apps/web/src/components/photo-viewer.tsx:196`.
- The mobile bottom sheet repeats the same mismatch at `apps/web/src/components/info-bottom-sheet.tsx:510-518`, with the href from `apps/web/src/components/info-bottom-sheet.tsx:151-153`.

Failure scenario:
A visitor opens a wide-gamut photo while the default `force_srgb_derivatives=false` is active. The dropdown appears because `isWideGamutSource && avifDownloadHref` is true. The JPEG option is labeled "Download (sRGB JPEG)" / "Compatible with all devices and browsers", but the actual file is the P3-tagged JPEG derivative. A client, print lab, CMS, or older viewer that expects the promised sRGB file may render clipped or over/under-saturated color. For photographers, this is a color-honesty issue: the product tells recipients they are downloading the compatibility copy when it is actually the wide-gamut JPEG.

Concrete fix:
Derive the JPEG option label from the public-safe source gamut plus `forceSrgbDerivatives`, not from admin-only `color_pipeline_decision`. For wide-gamut photos, show `downloadP3Jpeg` when `!forceSrgbDerivatives` and `downloadSrgbJpeg` only when `forceSrgbDerivatives` is true. Apply the same helper in both `photo-viewer.tsx` and `info-bottom-sheet.tsx`, and add a source/behavior test that asserts both components do not render `downloadSrgbJpeg` for a wide-gamut/default-force-sRGB-off branch.

## Non-Findings / Checks

- Current `search.tsx` no longer hides the persistent no-results/error text with `aria-hidden`, so Cycle 39 `UI-C39-01` appears addressed.
- `admin-user-manager.tsx` now uses `aria.deleteUser` with the username for each delete action, so the older generic delete-label issue is not present in current source.
- The map route has a skip link to a keyboard-accessible photo list, and popup buttons meet the 44px policy.
- Lightbox/photo navigation/image zoom controls have keyboard handlers, focus return/trapping, and 44px visible controls in the inspected regions.

## Verification

Ran:

```bash
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/photo-viewer-no-hdr-download.test.ts src/__tests__/free-download-contract.test.ts
```

Result: 4 test files passed, 33 tests passed.
