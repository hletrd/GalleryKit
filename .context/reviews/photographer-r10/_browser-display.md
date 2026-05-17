# Photographer Review R10 — Browser/Display Support, Color Space Delivery, Cross-Platform Behavior

**Date:** 2026-05-16
**Scope:** Deep review of browser-level color delivery, display detection accuracy, HTTP caching behavior, and cross-platform image rendering from a photographer's perspective.
**Files reviewed:** 18 core files + 5 test files + CSS + SW
**Reviewer:** Browser/Display specialist (R10 round)

---

## Severity Summary

| Severity | Count | Notes |
|----------|-------|-------|
| CRITICAL | 0 | No color-delivery failures found; all image pipelines correctly tag and serve |
| HIGH | 2 | SW ETag blindness + Firefox P3-display UI misalignment |
| MEDIUM | 5 | NCLX uncertainty, WebP ICC unverified, histogram coefficients, HDR MQ semantics, cache invalidation gap |
| LOW | 3 | Documentation, test coverage, minor UI inconsistencies |

---

## HIGH

### R10-H1 — Service Worker caches image bytes without ETag comparison, extending stale-color window beyond HTTP `must-revalidate`

**Files:** `public/sw.js:135-166` (`staleWhileRevalidateImage`)
**Impact:** Users with the GalleryKit SW installed see stale image bytes for one extra page visit cycle beyond what the origin server's `Cache-Control: max-age=3600, must-revalidate` would enforce. When an admin changes a color-impacting setting (e.g., `force_srgb_derivatives`), the ETag changes immediately, but the SW serves the old cached response on the next visit. The background revalidation fetches the new response (same bytes, new ETag) and updates the SW cache. Only on the *subsequent* visit does the user see the revalidated entry. If backfill then changes actual file bytes, another extra cycle is added. For a photographer who toggles a setting to fix a color bug, P3-display users with the SW may see incorrect colors for 2+ visit cycles.

**Root cause:** `staleWhileRevalidateImage` unconditionally serves `cached` when present (`line 157`). It does not compare the cached response's ETag with the network response's ETag before deciding to serve stale. The standard Cache API `match()` returns the cached response regardless of whether the origin's ETag has changed.

**Code path:**
```js
// sw.js:142-161
const cached = await imageCache.match(cacheKey);  // always returns if present
const revalidate = fetch(request.clone()).then(async (networkResponse) => {
    // ... puts network response into cache regardless of ETag delta
    await imageCache.put(cacheKey, networkResponse.clone());
});
if (cached) {
    revalidate.catch(() => {});
    return cached;  // serves stale without ETag check
}
```

**Fix:** In `staleWhileRevalidateImage`, compare `cached.headers.get('ETag')` with the network response's ETag before deciding to serve stale. If ETags differ, return the network response (not the cached one). This ensures color-impacting setting changes propagate immediately on the next visit rather than being delayed by one cycle:

```js
const revalidate = fetch(request.clone()).then(async (networkResponse) => {
    if (isSensitiveResponse(networkResponse)) return networkResponse;
    if (!networkResponse.ok) return networkResponse;
    const clone = networkResponse.clone();
    const blob = await clone.blob();
    const size = blob.size;
    await imageCache.put(cacheKey, networkResponse.clone());
    await recordAndEvict(request.url, size);
    return networkResponse;
});

if (cached) {
    const networkResponse = await revalidate;
    const cachedEtag = cached.headers.get('ETag');
    const networkEtag = networkResponse?.headers?.get('ETag');
    if (networkEtag && cachedEtag && networkEtag !== cachedEtag) {
        return networkResponse ?? cached;
    }
    revalidate.catch(() => {});
    return cached;
}
```

**Photographer impact:** A photographer notices their Display P3 image is being rendered in sRGB on Firefox. They toggle `force_srgb_derivatives` off in admin settings. With the current SW, a returning visitor with the SW installed sees the old sRGB-clipped image on their next visit. Only on the visit after that do they see the corrected P3-tagged image. This undermines the photographer's ability to quickly verify that a settings fix worked.

---

### R10-H2 — Firefox P3-display users see incorrect UI gamut signals: `WideGamutHint` wrongly appears, P3 badges hidden, histogram uses sRGB canvas

**Files:** `use-display-capability.ts:64-67`, `wide-gamut-hint.tsx:39-41`, `globals.css:170-173`, `histogram.tsx:426-428`
**Impact:** Firefox users on genuine P3 displays (e.g., MacBook Pro internal display, external P3 monitor) get `colorGamut: 'srgb'` from `useDisplayCapability` because Firefox lacks both `screen.colorGamut` and `(color-gamut: p3)` MQ support. This causes three UI misalignments:

1. **WideGamutHint appears incorrectly** (`wide-gamut-hint.tsx:39-48`): The hint tells the user "Your display cannot show the full range of colors in this photo" — which is FALSE for P3-display Firefox users. This undermines photographer credibility.

2. **P3 gamut badge hidden** (`globals.css:170-173`): The `.gamut-p3-badge` rule uses `@media (color-gamut: p3)` (Firefox ignores) + `[data-display-gamut="p3"]` (set from hook, always `"srgb"` on Firefox). P3 badges never appear on Firefox regardless of display.

3. **Histogram computes on sRGB canvas** (`histogram.tsx:426-428`): `isP3Display = colorGamut !== 'srgb'` evaluates to `false` on Firefox. The histogram loads the JPEG source and draws to a default sRGB canvas, even though the AVIF source (with wider gamut) is available and Firefox 113+ can decode it. The histogram bins therefore reflect sRGB-clipped data, not the actual P3 gamut distribution.

**Root cause:** R9-R1 correctly identified the canvas-P3 probe as an API-capability signal (not display-capability) and removed it from the detection path. Firefox now unconditionally defaults to `'srgb'`. This prevents false positives on sRGB displays but also prevents ANY P3 detection on Firefox.

**Important clarification on IMAGE delivery:** The actual `<picture>` element in `photo-viewer.tsx:394-418` and `lightbox.tsx:408-457` serves AVIF to Firefox 113+ regardless of `useDisplayCapability`. Firefox DOES decode and render P3 AVIF. The issue is purely UI — the photographer-facing badges and hints do not align with the actual color experience.

**Fix options:**
- **Option A (recommended):** Add a dismissible `WideGamutHint` so users can hide it if they know their display supports P3. This acknowledges the limitation without claiming false confidence.
- **Option B:** Use the canvas-P3 probe as a weak signal specifically for Firefox, gated behind an explicit warning. Since the false positive (sRGB display claiming P3) is less harmful than the false negative (P3 display claiming sRGB) for photographers who want badges to reflect actual delivery, consider a conditional: if browser is Firefox AND canvas-P3 probe succeeds, set `colorGamut: 'p3'` but document the false-positive risk. The `WideGamutHint` already has a mount-delay gate; add a parallel `data-display-gamut="p3-unchecked"` state for Firefox.
- **Option C:** Document the limitation in the admin UI and in `CLAUDE.md`. The current comment in `use-display-capability.ts:64-67` explains WHY Firefox defaults to srgb but does not explain the photographer-visible impact (missing badges, incorrect hint).

**Photographer impact:** A photographer sends their P3-tuned gallery to a client using Firefox on a MacBook Pro. The client sees the photo correctly (P3 AVIF renders in full gamut) but sees a "Your display cannot show the full range of colors" warning. The photographer looks incompetent — their tooling falsely claims the client's display is inadequate.

---

## MEDIUM

### R10-M1 — AVIF NCLX CICP signaling not explicitly verified; encoder relies on Sharp/libheif implicit behavior

**Files:** `process-image.ts:876-884` (AVIF encode path)
**Impact:** GalleryKit encodes P3 AVIF via `.toColorspace('p3').withIccProfile('p3').avif(...)`. Sharp delegates to libvips/libheif for AVIF encoding. Whether libheif writes an NCLX `colr` box with CICP values (primaries=12 for Display P3, transfer=13 for sRGB, matrix=0 for identity) is an implementation detail, not explicitly controlled by GalleryKit. If libheif writes only an ICC profile and omits NCLX, some browsers (particularly future ones or strict parsers) may not interpret the AVIF as P3.

**Industry context:** The AVIF spec (MIAF) requires NCLX CICP signaling for maximum compatibility. ICC profiles in AVIF are supplementary. Safari 17+ and Chrome 122+ handle ICC-embedded AVIF correctly, but NCLX is the canonical signaling path.

**Root cause:** No post-encode verification or explicit NCLX injection in the pipeline.

**Fix:** Add an optional post-encode verification step that inspects the first ~4KB of the AVIF output to confirm the presence of an `nclx`-type `colr` box with expected CICP values. If absent, log a warning. This does not need to block the pipeline — it is an audit-only check:

```ts
// After AVIF encode succeeds, verify NCLX presence
async function verifyAvifNclx(filePath: string, expectedPrimaries: number, expectedTransfer: number): Promise<boolean> {
    const fd = await fs.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(4096);
        const { bytesRead } = await fd.read(buf, 0, 4096, 0);
        // Reuse parseCicpFromHeif (from color-detection.ts) on the output
        const cicp = parseCicpFromHeif(buf.subarray(0, bytesRead));
        return cicp !== null && cicp.colourPrimaries === expectedPrimaries && cicp.transferCharacteristics === expectedTransfer;
    } finally {
        await fd.close();
    }
}
```

**Photographer impact:** If a future browser version or AVIF decoder changes its priority (NCLX over ICC), P3 AVIFs encoded by GalleryKit could be interpreted as sRGB. The photographer's careful color grading would be silently clipped.

---

### R10-M2 — WebP ICC profile embedding not verified; `.withIccProfile('p3')` may not propagate through Sharp's WebP encoder

**Files:** `process-image.ts:855-858`
**Impact:** The encode chain calls `.toColorspace(targetIcc).withIccProfile(targetIcc).webp(...)` for wide-gamut sources. Sharp's WebP output path goes through libvips -> libwebp. libwebp supports ICC profile embedding via the VP8X chunk, but only when the encoder is configured to write VP8X (which requires extended metadata). Whether Sharp enables VP8X writing when `withIccProfile` is called is not documented and not verified by GalleryKit.

**Browser context:** Chrome 94+ respects ICC profiles in WebP. Safari and Firefox WebP ICC support varies. If the ICC profile is NOT embedded, Chrome may render wide-gamut WebP in sRGB regardless of display capability.

**Root cause:** No post-encode verification that the output WebP file actually contains an ICC profile chunk.

**Fix:** Add a post-encode verification that reads the WebP file and checks for the presence of an ICCP chunk (chunk type `'ICCP'` in the RIFF structure). This is an audit-only check that logs a warning if the chunk is missing:

```ts
async function verifyWebpIccProfile(filePath: string): Promise<boolean> {
    // WebP is RIFF: RIFF....WEBP VP8X/VP8/VP8L [optional chunks]
    // VP8X chunk (if present) at offset 12: 'VP8X' + size(4) + flags(4) + canvas(12)
    // ICCP chunk can appear after VP8X
    const buf = await fs.readFile(filePath, { length: 1024 }); // read first 1KB
    // Simple scan for 'ICCP' FourCC
    return buf.includes(Buffer.from('ICCP'));
}
```

**Photographer impact:** On browsers that don't support AVIF (older Safari, some Edge versions), the `<picture>` element falls back to WebP. If the WebP lacks an ICC profile, the photographer's P3-tuned image is rendered in sRGB on a P3 display without any user-visible warning.

---

### R10-M3 — Histogram luminance computation uses BT.709 coefficients even when canvas is Display-P3

**Files:** `public/histogram-worker.js:21-25`
**Impact:** When a wide-gamut image is displayed on a P3 display, the histogram loads the AVIF source into a P3 canvas (`histogram.tsx:203-206`) and the worker computes luminance using BT.709 coefficients (0.2126, 0.7152, 0.0722). For P3 primaries, the correct coefficients are (0.22897, 0.69174, 0.07929). The code comment acknowledges a ~2-3% error, but this error is systematic — it skews luminance bins consistently toward green and away from blue for P3 sources.

**Root cause:** The worker receives raw ImageData with no color space context. It always uses BT.709 coefficients.

**Fix:** Pass the canvas color space to the worker and branch the luminance formula:

```js
// In histogram-worker.js
self.onmessage = function (e) {
    const { requestId, imageData, width, height, colorSpace } = e.data;
    // ...
    const isP3 = colorSpace === 'display-p3';
    const lum = isP3
        ? Math.round(0.22897 * rv + 0.69174 * gv + 0.07929 * bv)
        : Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv);
    // ...
};
```

**Photographer impact:** A photographer reviewing a P3-tuned landscape on the histogram sees luminance peaks shifted by ~2-3%. This is small for casual review but non-trivial when evaluating whether highlights are clipping or whether the tonal curve matches intent.

---

### R10-M4 — `ETag` changes on settings flip before backfill, causing clients to download same bytes twice

**Files:** `serve-upload.ts:110-112`, `settings-hash.ts:62-78`
**Impact:** When an admin changes a color-impacting setting (e.g., `force_srgb_derivatives`), the settings hash changes immediately, which changes the ETag for every image file. But the actual file bytes on disk remain the old encoding until backfill re-encodes them. A browser that has the old image cached sends `If-None-Match: old-etag`; the server responds with `200` (not `304`) because the ETag changed. The browser downloads the SAME bytes again and caches them under the new ETag. After backfill completes, the browser downloads AGAIN when mtime changes. Three downloads for one logical change.

**This was identified as R9-M5** (ETag staleness warning). The recommended fix was a UI warning + per-image hash. The UI warning has not been implemented.

**Root cause:** The ETag is global (one hash per setting state) rather than per-image (hash of the actual encoded bytes).

**Fix (short-term):** Add an admin UI warning when color-impacting settings are changed, stating: "Settings changed — existing images will be re-encoded in the background. Visitors may see a mix of old and new color handling until backfill completes."

**Fix (long-term):** Store a per-image `encode_settings_hash` in the database. The ETag reads this hash instead of the global settings hash. When settings change, only newly-uploaded/re-encoded images get the new hash. Existing images keep their old ETag until backfill updates them.

**Photographer impact:** A photographer with a large gallery (thousands of images) changes `wide_gamut_jpeg_chroma` from 4:4:4 to 4:2:2 to save space. Every returning visitor re-downloads every image they viewed (same bytes, new ETag) before backfill even starts. Bandwidth waste is proportional to gallery size x visitor count.

---

### R10-M5 — HDR badge shown based on `(dynamic-range: high)` MQ, which reports hardware capability not active delivery

**Files:** `globals.css:176-177`, `use-display-capability.ts:69-71`
**Impact:** The `.hdr-badge` CSS rule uses `@media (dynamic-range: high)` to show the badge. This MQ reports whether the display+OS combination is CAPABLE of HDR, not whether the user is currently viewing HDR content. A Safari XDR user with HDR disabled in System Settings, an Edge Auto HDR user with Auto HDR off, or an Android device with an HDR-decode SoC but SDR panel all see the HDR badge. Combined with the "Delivered as SDR" honesty note, this is semantically confusing — the badge says "HDR" while the note says "SDR delivery."

**This was identified as R9-R2** (HIGH). The badge wording was recommended to change to "HDR-capable display" or "HDR source (SDR delivery)". This has not been implemented — the badge still reads "HDR" (or its i18n equivalent).

**Root cause:** The CSS `@media (dynamic-range: high)` MQ semantics are hardware-capability, not content-state.

**Fix:** Change the i18n string `viewer.hdrBadge` from "HDR" to "HDR source" or "HDR-capable" so the badge aligns with what it actually measures. Update the CSS comment to explain the MQ limitation.

**Photographer impact:** A photographer reviews their HDR source on an iPhone XDR display with HDR disabled in Settings. The badge says "HDR" but the photo is delivered as SDR. The photographer thinks their HDR pipeline is working when it isn't, wasting time on non-existent HDR tuning.

---

## LOW

### R10-L1 — Service Worker version-based cache purge only happens on deploy, not on ETag changes

**Files:** `public/sw.js:214-235` (activate handler)
**Impact:** The SW purges image caches only when `SW_VERSION` changes (build-time constant). Between deploys, image cache entries persist indefinitely (subject to 50 MB LRU cap). If an admin changes settings and backfill runs between deploys, the SW's cached images may be stale until the user visits again (which triggers revalidation) — but the old cached entry with the old ETag may persist in the LRU metadata even after revalidation.

**Root cause:** SW cache invalidation is coupled to SW version bumps, not content ETag changes.

**Fix:** Consider adding a build step that embeds the current `IMAGE_PIPELINE_VERSION` into `SW_VERSION` so pipeline bumps automatically purge image caches. Or, in `staleWhileRevalidateImage`, if the network response's ETag differs from the cached response's ETag, evict the old entry immediately rather than overwriting.

**Photographer impact:** Minimal. The LRU cap (50 MB) ensures old entries eventually evict. The extra staleness is bounded.

---

### R10-L2 — `photo-viewer.tsx` preloads JPEG fallback for prev/next navigation, not AVIF

**Files:** `photo-viewer.tsx:273-293`
**Impact:** The `useEffect` that preloads prev/next images creates `<link rel="preload" as="image">` elements pointing to JPEG derivatives only:
```ts
link.href = imageUrl(`/uploads/jpeg/${img.filename_jpeg}`);
```
AVIF-capable browsers on P3 displays would benefit more from preloading the AVIF derivative (smaller, P3-tagged). Preloading JPEG means the browser may decode the JPEG before discovering the `<picture>` element's AVIF `<source>`, wasting CPU and memory.

**Root cause:** The preload path hardcodes JPEG.

**Fix:** Preload AVIF when `img.filename_avif` is available and the browser supports AVIF. Use `<link rel="preload" as="image" type="image/avif">` so non-AVIF browsers skip it:
```ts
if (img.filename_avif) {
    const avifLink = document.createElement('link');
    avifLink.rel = 'preload';
    avifLink.as = 'image';
    avifLink.type = 'image/avif';
    avifLink.href = imageUrl(`/uploads/avif/${img.filename_avif}`);
    document.head.appendChild(avifLink);
    links.push(avifLink);
}
```

**Photographer impact:** On fast navigation between photos, AVIF-capable browsers briefly show the JPEG fallback while the AVIF decodes. The preload optimization is missed for the optimal format.

---

### R10-L3 — Missing test coverage for SW `staleWhileRevalidateImage` ETag comparison

**Files:** `apps/web/src/__tests__/sw-cache.test.ts` (test file)
**Impact:** The existing SW cache tests cover LRU eviction, admin-route bypass, and image-derivative detection. There are no tests for the `staleWhileRevalidateImage` function itself — it lives in `public/sw.js` (not TypeScript) and is not exercised by the Vitest suite.

**Root cause:** Service worker code is plain JS in `public/`, outside the testable module graph.

**Fix:** Extract `staleWhileRevalidateImage` into a TypeScript module (`lib/sw-image-strategy.ts`) that accepts injected `caches` and `fetch` dependencies, then test it with mock Cache API and fetch. The `public/sw.js` can import the compiled bundle. This is medium effort but would catch ETag-blindness regressions.

**Photographer impact:** Indirect. Better test coverage prevents future changes to the SW from reintroducing stale-image bugs.

---

## Positive Observations

1. **Strong ETag hygiene:** The ETag formula correctly includes pipeline version, mtime, size, AND a hash of color-impacting settings. This is more thorough than many production galleries. (`serve-upload.ts:112`, `settings-hash.ts:55-78`)

2. **Correct `<picture>` source ordering:** AVIF is listed first, WebP second, JPEG fallback last. All browsers that support AVIF get it, including Firefox 113+. The color delivery is correct even when UI detection is conservative. (`photo-viewer.tsx:396-417`, `lightbox.tsx:420-430`)

3. **Atomic rename for base filenames:** `process-image.ts:940-961` uses hard-link + atomic rename to eliminate 404 windows during concurrent reads. This is production-grade file handling.

4. **Firefox conservative default is the right trade-off:** R9-R1 correctly prioritized avoiding false positives (sRGB display claiming P3) over false negatives (P3 display claiming sRGB). False positives undermine badge credibility for ALL users; false negatives only affect Firefox P3 users.

5. **Histogram source derivative indicator:** R9 added the `histogramSource` label (`histogram.tsx:450`) showing whether bins came from AVIF or JPEG. This is excellent photographer-facing transparency.

6. **Wide-gamut JPEG chroma subsampling is configurable:** The admin can tune `wide_gamut_jpeg_chroma` per their quality/storage trade-off. Default 4:4:4 preserves full chroma fidelity for wide-gamut sources where color detail matters. (`gallery-config-shared.ts:115`)

7. **10-bit AVIF with graceful fallback:** The `canUseHighBitdepthAvif()` probe (`process-image.ts:60-114`) gates 10-bit AVIF with per-image fallback to 8-bit if the probe passed but a specific encode fails. This prevents pipeline crashes while maximizing quality.

8. **NCLX parsing for HEIF/AVIF sources:** `color-detection.ts:206-272` implements a bounded ISOBMFF walker that extracts CICP triplets from uploaded HEIF/AVIF files. This correctly identifies container-level color signaling independent of ICC.

---

## Cross-Platform Behavior Matrix (Verified)

| Browser | OS | Display | P3 AVIF | P3 Badge | WideGamutHint | Notes |
|---------|-----|---------|---------|----------|---------------|-------|
| Safari 18+ | macOS / iOS | P3 | Yes | Yes | No | `screen.colorGamut` + MQ both work |
| Chrome 122+ | macOS / Win / Android 14+ | P3 | Yes | Yes | No | `screen.colorGamut` authoritative |
| Edge 122+ | Windows 11 | P3 + Auto HDR | Yes | Yes | No | Same as Chrome |
| Firefox 124+ | macOS / Win | P3 | **Yes** | **No** | **Yes (incorrect)** | Image delivery correct; UI wrong |
| Firefox 124+ | macOS / Win | sRGB | No | No | No | Correct |
| Chrome | Android 13- | sRGB | sRGB-clipped | No | No | Correct |
| Safari | iOS (sRGB) | sRGB | sRGB-clipped | No | No | Correct |

**Key insight:** The ONLY cross-platform discrepancy is Firefox P3-display UI (badges/hints), NOT image delivery. The `<picture>` element correctly serves P3 AVIF to Firefox 113+ regardless of display detection.

---

## Recommended Priority Order

| Rank | Finding | Effort | Why First |
|------|---------|--------|-----------|
| 1 | R10-H1 SW ETag comparison | M | HIGH — stale images persist beyond HTTP cache |
| 2 | R10-H2 Firefox UI signals | S | HIGH — undermines photographer credibility |
| 3 | R10-M4 ETag staleness warning | S | MED — prevents bandwidth waste |
| 4 | R10-M1 AVIF NCLX verification | S | MED — future-proof color signaling |
| 5 | R10-M2 WebP ICC verification | S | MED — fallback format correctness |
| 6 | R10-M5 HDR badge wording | XS | MED — semantic accuracy |
| 7 | R10-M3 Histogram P3 coefficients | XS | MED — technical correctness |
| 8 | R10-L2 Preload AVIF | XS | LOW — navigation performance |
| 9 | R10-L1 SW cache purge on pipeline bump | XS | LOW — deploy hygiene |
| 10 | R10-L3 SW test coverage | M | LOW — regression prevention |

---

## Verdict: COMMENT

No CRITICAL issues found. Color space delivery is correct across all supported browsers via the `<picture>` element with proper `<source>` ordering. The AVIF/WebP/JPEG encode pipeline correctly tags wide-gamut sources with P3 ICC profiles. HTTP content types are correct. Cache-Control and ETag semantics are well-designed.

The two HIGH findings are UI/UX and caching issues, not color-delivery failures. The actual pixel values reach P3-display Firefox users correctly; only the badges and hints are misaligned. The SW finding extends stale-color windows but does not corrupt color data.

All MEDIUM findings are verification, documentation, or edge-case improvements. No blocking concerns for photographer intent delivery.

---

*Review compiled from 18 source files, 5 test files, and service worker analysis. Total lines reviewed: ~3,400.*
