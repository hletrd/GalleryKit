# R27 — HDR Workflow + Display Delivery Review
**Date:** 2026-05-19
**Lens:** Working pro photographer; cross-device delivery.

## Result
NEW_FINDINGS: 2

## Findings

### R27-HD-MED-1 — Histogram source label reports "AVIF" when AVIF 404s and the histogram falls back to JPEG
**Severity:** MED
**Files:** `apps/web/src/components/histogram.tsx:463`, `apps/web/src/components/histogram.tsx:485`

**Photographer-visible symptom:** The histogram header shows "AVIF" as the source format while the bins were actually computed from a sRGB-clipped JPEG derivative. On a P3 display, this is the important case: the "(sRGB clipped)" hint is suppressed (because `isClipped = isWideGamut && colorGamut === 'srgb'` resolves to false on a P3 display), and the "AVIF" label falsely implies the histogram represents P3-space distribution — but the actual canvas was drawn from a JPEG that had already been clipped to sRGB at encode time. The photographer reads their sunset reds as "no highlight clipping in P3" when in fact the data came from the sRGB-encoded JPEG.

**Technical detail:** `preferAvif` at line 463 is computed as:
```ts
const preferAvif = isWideGamut && avifSupported === true && isP3Display && getSupportsCanvasP3() && Boolean(avifUrl);
```
The `Boolean(avifUrl)` term checks that the prop is non-null, but does not consult `failedUrls`. The `effectiveUrl` computation at line 471 correctly skips failed URLs via `!failedUrls.has(u as string)`. When the AVIF URL 404s, `markFailed(effectiveUrl)` fires at line 535 and triggers a re-render. On that render: `preferAvif` remains `true` (avifUrl is still non-null), `effectiveUrl` resolves to `imageUrl` (the JPEG), but `histogramSource` at line 485 is:
```ts
const histogramSource = preferAvif ? 'AVIF' : effectiveUrl ? 'JPEG' : null;
```
Since `preferAvif === true`, this evaluates to `'AVIF'` even though `effectiveUrl` is the JPEG URL and the subsequent effect at line 503 computes the histogram from JPEG pixels.

**Proposed fix:**
```ts
const histogramSource = effectiveUrl === avifUrl ? 'AVIF' : effectiveUrl ? 'JPEG' : null;
```
This derives the label from which URL was actually selected as `effectiveUrl`, not from the intent flag. When `avifUrl` is in `failedUrls` and `effectiveUrl` is the JPEG, the label correctly reports `'JPEG'`. As a companion improvement, `isClipped` should be updated to `isWideGamut && (colorGamut === 'srgb' || effectiveUrl !== avifUrl)` so the "(sRGB clipped)" hint also fires correctly when AVIF falls back to JPEG on a P3 display.

**Acceptance:** `histogramSource` label matches `effectiveUrl`; after an AVIF 404, the label shows `'JPEG'` and (if on P3 display + wide-gamut photo) the `(sRGB clipped)` hint also appears correctly.

---

### R27-HD-LOW-1 — HDR ingest accepted-warning toast text mischaracterizes a deterministic SDR downgrade as a probabilistic display-compatibility issue
**Severity:** LOW
**Files:** `apps/web/messages/en.json:151`, `apps/web/messages/ko.json:151`

**Photographer-visible symptom:** A photographer enables `allow_hdr_ingest`, uploads their iPhone 15 Pro ProRes HDR clip or PQ-tagged HEIC shot, and sees the toast: "1 HDR image uploaded — may not display correctly on all devices." They read "may not display correctly" as a compatibility caveat — their image might show fine on the right device. In reality, the current pipeline is SDR-only: the source HDR data (PQ tonemap, highlight roll-off, full stop of extra light information) is irreversibly mapped to SDR at encode time and there is no HDR AVIF variant on disk. The photographer's crafted highlight detail is gone, not maybe-gone.

**Technical detail:**
- `en.json` line 151: `"hdrWarning": "{count, plural, one {1 HDR image uploaded — may not display correctly on all devices.} other {# HDR images uploaded — may not display correctly on all devices.}}"`
- `ko.json` line 151: `"HDR 이미지 {count}개를 업로드했습니다. 일부 기기에서는 올바르게 표시되지 않을 수 있습니다."` (translated: "X HDR images uploaded. May not display correctly on some devices.")

Both say "may not display correctly" (Korean: "올바르게 표시되지 않을 수 있습니다" = may not display correctly). The actual outcome is deterministic: until WI-09 ships, `is_hdr=true` rows have `pipeline_version=7` SDR-only derivatives. The Color Details accordion admin row correctly says "HDR source — delivered as SDR" (`viewer.hdrDeliveredAsSdr`), but the upload toast is the first touchpoint and currently gives the wrong framing.

**Proposed fix:**
```json
"hdrWarning": "{count, plural, one {1 HDR image uploaded. Current pipeline delivers SDR only — HDR highlights will be tone-mapped to SDR range.} other {# HDR images uploaded. Current pipeline delivers SDR only — HDR highlights will be tone-mapped to SDR range.}}"
```
Korean:
```json
"hdrWarning": "HDR 이미지 {count}개를 업로드했습니다. 현재 파이프라인은 SDR 전용으로, HDR 하이라이트가 SDR 범위로 톤매핑됩니다."
```

**Acceptance:** Toast text matches the `viewer.hdrDeliveredAsSdr` framing already present in the Color Details accordion. The admin understands the consequence immediately on upload without needing to open the photo detail view.

---

## Convergence Rationale — All Other Checklist Items

**`useDisplayCapability` snapshot memoization (React #185):** Verified correct. `_cachedSnapshot` at line 47 returns the same object reference when `colorGamut` and `isHdr` are unchanged. `getServerSnapshot` returns the stable `SERVER_DEFAULT` constant. No infinite loop path exists.

**SSR default `colorGamut: 'p3'`:** The `WideGamutHint` has an independent `mounted` guard (line 37–46 of `wide-gamut-hint.tsx`) — the hint is suppressed until `setMounted(true)` fires in a `useEffect`. The SSR `p3` default therefore cannot cause a hint-flash for sRGB visitors: the hint is hidden on SSR and remains hidden until after hydration when the actual display is resolved. The `<picture>` source selection is browser-native and is not affected by the JS hook.

**`<picture>` source ordering and Firefox sRGB delivery:** The `<picture>` element in `photo-viewer.tsx` (lines 499–529) has one AVIF `<source>` with no `media` attribute. Firefox 113+ supports color-managed Display P3 AVIF rendering (the browser applies the embedded ICC/NCLX metadata). A Firefox-on-sRGB user receives the same P3-tagged AVIF that Chrome/Safari receive — the browser renders it color-managed. Firefox performs gamut-clipping to the display gamut at compositing time, which is the correct behavior. No separate sRGB `<source>` is needed; this is not a bug.

**HDR badge honesty (CLAUDE.md rule):** The `hdr-badge` CSS class is forced visible by `force_show_color_chips` at `globals.css:184`. However, the badge element is only rendered in the DOM when `isHdr === true` (computed from `image.transfer_function`), and `transfer_function` is admin-only via `_PrivacySensitiveKeys`. For public visitors `image.transfer_function` is always null, so `isHdr` is always false, and the badge element is never inserted into the DOM regardless of the CSS override. The force-show override therefore cannot display a false HDR badge to public visitors. Verified against `color-details-section.tsx:168` and the privacy guard at `data.ts`.

**HDR badge gating on `(dynamic-range: high)` vs `data-display-gamut`:** The P3 badge uses `data-display-gamut` (JS-driven, Firefox-safe). The HDR badge uses only `@media (dynamic-range: high)` (pure CSS MQ). Per the CLAUDE.md matrix, Chrome on macOS/Win does NOT implement `(dynamic-range: high)`. Since WI-09 has not shipped and `is_hdr` is admin-only, the HDR badge never renders in the public DOM. When WI-09 ships and `hdr_variant_exists` becomes the public gate, the HDR badge display mechanism will need to be revisited for the Chrome gap — this is already tracked in `wi09-readiness.md` item #8.

**`force_show_color_chips` and admin demo honesty:** Confirmed that `force_show_color_chips` does not violate the honesty rule for public visitors (see HDR badge honesty analysis above). For the P3 gamut badge, `gamut-p3-badge` renders in the DOM for any photo with a wide-gamut `color_primaries` (a public field), and the force-show CSS makes it visible on sRGB displays. This is the intended admin demo behavior: show gamut chips even on an sRGB demo laptop. The badge says "P3" which accurately describes the source/delivery gamut, not an HDR capability the SDR pipeline doesn't fulfill.

**Histogram P3 luminance coefficients:** Confirmed correct at `histogram-worker.js` (Y = 0.22897 R + 0.69174 G + 0.07929 B). Verified in R5-standards review. No new gap.

**WideGamutHint Firefox handling:** Confirmed correct per R10-H4 documented trade-off. The hint is suppressed on Firefox because `colorGamut === 'srgb'` is always true for Firefox, meaning `isSrgbDisplay === true` — but the hint is also suppressed because `useDisplayCapability` conservatively returns `'srgb'` for Firefox regardless of actual display, which means a Firefox-on-P3-display visitor would be falsely shown the hint. The current decision (suppress hint on Firefox entirely) is the correct trade-off. Documented in `CLAUDE.md` and in the admin settings UI per R5-UI.

**HDR ingest gating sequence (NCLX before gate):** The gate at `images.ts:295` checks `data.colorSignals?.isHdr`. `colorSignals` comes from `saveOriginalAndGetMetadata` which calls `detectColorSignals` — this runs the full NCLX parsing pipeline before `isHdr` is derived. The gate therefore checks the post-NCLX-parse transfer function, not a raw camera EXIF tag. Correct.

**Apple HDR gain map + `allow_hdr_ingest` messaging:** When `is_hdr=true && has_gain_map=true && allow_hdr_ingest=true`, the admin sees `viewer.gainMapPresent` + `viewer.gainMapDeliveredAsSdr` in the Color Details accordion. This is honest. The R27-HD-LOW-1 finding is about the upload toast, not the post-processing audit row.

**Lightbox color pip touch target `min-h-11`:** Confirmed at `lightbox-color-pip.tsx:121`. The closed-state button has `min-h-11` in its className. Meets 44 px floor.

**Lightbox histogram lazy mount:** Confirmed at `lightbox-color-pip.tsx:238` — the `<Histogram>` is only rendered inside `{open && (...)}`, so the worker is not spawned until the pip is expanded. The `Histogram` component spawns its worker in a `useEffect` at mount time, so this is correctly lazy.

**Masonry P3 badge accessible name:** Confirmed fixed — `home-client.tsx:353` has `role="img"` and `aria-label={t('viewer.colorDetailsWithGamut', { gamut: 'P3' })}`. The R5-UI finding (R5-UI-5.1) was closed in a prior cycle.

**Lightbox color pip aria-label:** Confirmed fixed — `lightbox-color-pip.tsx:123–127` constructs the aria-label as `"${t('aria.toggleColorPip')}: ${[primaries, transfer, isHdr ? hdrBadge : null].filter(Boolean).join(' · ')}"`. The R5-UI finding (R5-UI-3.1) was closed in a prior cycle.

**Download menu HDR scaffolding:** `deriveHdrAvifFilename` in `hdr-filenames.ts` is the only WI-09 client-side scaffold. It is not yet wired into the download menu. Per `wi09-readiness.md`, the download menu HDR row is item #7 (red). No forklift needed — `deriveHdrAvifFilename` gives the filename derivation; the menu item is a new `DropdownMenuItem` row gated on `hdr_variant_exists` (the new column from WI-09 item #5). The scaffold is appropriately minimal.

**Browser matrix — Safari 17 / iOS 17 (golden path):** Safari 17 supports `(color-gamut: p3)` MQ (confirmed in matrix). `screen.colorGamut` is Safari 18+ TP only, so `useDisplayCapability` on Safari 17 takes the MQ path (lines 59–63). The `(color-gamut: p3)` MQ fires correctly on iPhone Pro displays. Safari 17 is correctly handled.

**Chrome Android P3 detection:** Chrome 122+ Android with a P3 display: `screen.colorGamut` is available on Chrome 121+ (`'chrome' in window` is true), so `useDisplayCapability` takes the `screen.colorGamut` path at lines 54–57. On a Pixel 8 Pro or S24 Ultra, `screen.colorGamut` returns `'p3'`. The `data-display-gamut="p3"` attribute is set and the P3 badge appears. Correct.

**Edge Auto HDR + `(dynamic-range: high)` counter-intuitivity:** Per CLAUDE.md, Edge with Auto HDR ON fires `(dynamic-range: high)`. The HDR badge CSS would show — but only if `is_hdr` is true and the badge element is in the DOM, which requires admin access (transfer_function is admin-only). No false HDR badge for public visitors.
