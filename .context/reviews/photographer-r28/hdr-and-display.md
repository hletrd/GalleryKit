# R28 — HDR + Delivery Surface Review

**Date:** 2026-05-20
**Pass:** R28 (thirteenth deep pass)
**Lens:** Working professional photographer delivering shoots to clients across mixed devices.
**Predecessor:** R27 found 12 findings (2 HIGH, 7 MED, 3 LOW). All 12 remain open (no code has landed since R27).

---

## Scope boundary

All 14 R28 lens items checked explicitly. Only genuine new findings (not raised in any prior pass) are reported below. Items that were clean or whose gaps are already captured in R27 are documented in the convergence section.

---

## Result

**NEW_FINDINGS: 2**

| Severity | Count |
|----------|-------|
| CRIT     | 0     |
| HIGH     | 0     |
| MED      | 1     |
| LOW      | 1     |

---

## Findings

### R28-HD-MED-1 — `forceSrgbDerivatives` not propagated to `PhotoViewer` on share routes `/s/[key]` and `/g/[key]`

**Severity:** MED
**Confidence:** 97

**Files:**
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:113–128`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:148–164`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:328` — correctly wired

**Photographer-visible symptom:** When an admin enables `force_srgb_derivatives` (making WebP/JPEG deliver sRGB even for P3 sources) and then shares a photo via a share-link (`/s/[key]`) or a group album link (`/g/[key]`), the Color Details panel in the PhotoViewer on those share pages shows incorrect delivery information. It shows "P3" gamut labels for the JPEG/WebP format chips and the "delivered bit depth" row, while the actual bytes on disk are sRGB-tagged. The download menu primary button also labels its JPEG as "Download (8-bit Display P3 JPEG)" when it is actually an sRGB JPEG.

This is a delivery-honesty violation: the photographer's client sees incorrect color labeling on the main share delivery path.

**Technical detail:**

`/p/[id]/page.tsx` at line 328 correctly passes `forceSrgbDerivatives={config.forceSrgbDerivatives}` to `PhotoViewer`. The `getGalleryConfig()` call is present in both share pages (line 103 in `g/[key]/page.tsx`, line 93 in `s/[key]/page.tsx`), so the config value is available — it just is not forwarded.

`/s/[key]/page.tsx` line 113–128:
```tsx
<PhotoViewer
    images={[image]}
    initialImageId={image.id}
    ...
    forceShowColorChips={config.forceShowColorChips}
    // forceSrgbDerivatives is missing here
/>
```

`/g/[key]/page.tsx` line 148–164 (the selectedImage / photo-viewer branch):
```tsx
<PhotoViewer
    images={group.images}
    initialImageId={selectedImage.id}
    ...
    forceShowColorChips={config.forceShowColorChips}
    // forceSrgbDerivatives is missing here
/>
```

`forceSrgbDerivatives` is consumed by `ColorDetailsSection` (to show correct per-format gamut chips and "delivered bit depth" label), `LightboxColorPip` (same), and the download button label via `isP3Pipeline(image.color_pipeline_decision)` gated on `isWideGamutSource && avifDownloadHref` — when `forceSrgbDerivatives=true`, the download menu shows "Download (8-bit Display P3 JPEG)" but actually serves sRGB bytes.

**Proposed fix:**

Add `forceSrgbDerivatives={config.forceSrgbDerivatives}` to the `<PhotoViewer>` call in both share pages:

In `s/[key]/page.tsx`:
```tsx
<PhotoViewer
    ...
    forceShowColorChips={config.forceShowColorChips}
    forceSrgbDerivatives={config.forceSrgbDerivatives}
/>
```

In `g/[key]/page.tsx` (the `selectedImage` branch):
```tsx
<PhotoViewer
    ...
    forceShowColorChips={config.forceShowColorChips}
    forceSrgbDerivatives={config.forceSrgbDerivatives}
/>
```

**Acceptance:** When `force_srgb_derivatives=true`, the Color Details panel on `/s/[key]` and `/g/[key]?photoId=N` shows sRGB gamut annotation on WebP/JPEG format chips, the delivered bit depth row shows "sRGB 8-bit", and the download button label does not say "Display P3 JPEG" for a JPEG that is actually sRGB-tagged.

---

### R28-HD-LOW-1 — `WideGamutHint` dismissal is session-scoped; wedding-shoot delivery scenario degrades UX across 200+ photos

**Severity:** LOW
**Confidence:** 82

**Files:**
- `apps/web/src/components/wide-gamut-hint.tsx:14` — `DISMISS_STORAGE_KEY = 'wgh-dismissed'`
- `apps/web/src/components/wide-gamut-hint.tsx:57–72` — dismiss is keyed on gamut family, stored in `sessionStorage`

**Photographer-visible symptom:** A wedding photographer delivers a 200-photo P3 album via a share group link. The wedding client opens the album and sees the WideGamutHint: "This photo is delivered in Display P3 — your display shows the sRGB version." They click Dismiss. On the NEXT photo in the same gallery session, the hint is gone (same gamut family, same session). So far correct.

However, when the client closes and reopens the browser (new session), the hint reappears on every P3 photo. For a client browsing 200 P3 photos across multiple sessions (returning to choose favorites), the hint reappears every session. At a 200-photo wedding gallery, this is not an edge case.

The current `sessionStorage` scope is described in the code comment as intentional: "The per-session scope (not localStorage) means visitors revisiting next week — possibly on a different display — see the hint again rather than having it permanently suppressed." This is a valid concern for general public visitors who might change displays. However for share-link recipients, the repeated re-appearance is noise that undermines the photographer's polished delivery experience.

**Technical detail:**

`wide-gamut-hint.tsx:14`: `const DISMISS_STORAGE_KEY = 'wgh-dismissed'`

`wide-gamut-hint.tsx:74-82`:
```ts
const handleDismiss = useCallback(() => {
    try {
        sessionStorage.setItem(DISMISS_STORAGE_KEY, gamutFamily);
    } catch { ... }
    setDismissed(true);
}, [gamutFamily]);
```

The dismiss is always `sessionStorage` — it disappears on browser close. There is no per-visitor (not per-admin) long-lived dismissal option.

**Proposed fix (conservative):** Add an optional `localStorage` fallback on dismiss with a 30-day TTL. On hint mount, check `localStorage` first; if a non-expired entry exists for the gamut family, suppress immediately. The `sessionStorage` path remains for the case where `localStorage` is unavailable. This is a per-photo-recipient UX improvement with no privacy implication (it's a dismissal preference stored locally on the recipient's own device).

An even simpler variant: use `localStorage` for the share-route context (pass `persistDismissal={isSharedView}` from the PhotoViewer) and `sessionStorage` for the non-shared route, preserving the existing behavior for authenticated gallery browsing.

**Acceptance:** A recipient who dismisses the WideGamutHint on a P3 photo in a share album does not see the hint again for that gamut family on their next session visit to any share link from the same site, for at least 30 days.

---

## Convergence rationale — all other R28 lens items

**1. `<picture>` source negotiation under CDN/proxy caching — Vary header**

`serve-upload.ts` emits zero `Vary` headers (confirmed at lines 149–162). The `Cache-Control: public, max-age=3600, must-revalidate` response is content-negotiation-free: every URL serves exactly one representation (one specific AVIF/WebP/JPEG file). The `<picture>` source selection is purely browser-side by MIME type and `srcset`/`sizes`; the server never varies the response content based on `Accept`. A CDN stripping `Vary: Accept` would have no effect because there is no such header and no server-side content negotiation in play. No issue.

**2. Service worker and `force_show_color_chips` toggle**

The SW's `staleWhileRevalidateImage` handler (sw.js lines 172–196) sends a HEAD request with `If-None-Match` on every cache hit. When an admin changes a color-impacting setting, `getColorSettingsHash` produces a new ETag (P4-E2 / settings-hash.ts), so the server returns a fresh ETag on the HEAD probe. The SW compares ETags at line 185 (`networkEtag !== cachedEtag`), detects the mismatch, awaits the full background revalidate, and serves the fresh response. The SW version (`SW_VERSION = git-SHA + pipeline-version`) does not need to change for settings-driven cache invalidation; the ETag mechanism handles it. No gap.

**3. OG image color correctness for P3 photos**

`/api/og/photo/[id]/route.tsx` lines 40–46 (`postProcessOgImage`) runs the Satori PNG output through Sharp with `.toColorspace('srgb').withIccProfile('srgb').jpeg(...)`. The OG image is always sRGB JPEG regardless of source gamut. This is the correct call — Discord/Slack/X/WhatsApp unfurl pipelines do not apply ICC profiles and would naively gamut-clip P3 values. The comment at line 37–38 documents the rationale explicitly. No issue.

**4. JSON-LD `contentUrl` / `thumbnailUrl` color signaling**

`p/[id]/page.tsx` lines 216–224: both `contentUrl` and `thumbnailUrl` point to the base JPEG (sRGB derivative). The JSON-LD `encodingFormat` is `image/jpeg`. The schema.org `ImageObject` type does have an `additionalProperty` mechanism that could carry a `colorSpace: "Display P3"` note, but this is not a standard property, crawlers do not index it, and Googlebot Image uses the JPEG URL. The absence of color signaling in JSON-LD is not a bug — it is appropriate given that the public-facing SEO image is intentionally sRGB. No actionable finding.

**5. Share-link color delivery honesty for WebP/JPEG (separate from R28-HD-MED-1)**

When `force_srgb_derivatives=false` (the default), the `<picture>` element on share pages correctly serves the P3-tagged AVIF to capable browsers and P3-tagged WebP/JPEG to others, via the same `PhotoViewer` component used on `/p/[id]`. The `<picture>` source ordering (AVIF → WebP → JPEG) is identical. A Chrome Android client on a P3 screen opening `/g/[key]?photoId=N` gets the P3 AVIF via the same browser-native source negotiation as `/p/[id]`. No gap with default settings. The gap is only in the audit panel labels when `force_srgb_derivatives=true` (R28-HD-MED-1 above).

**6. Lightbox keyboard + screen reader semantics for color metadata**

The lightbox `<dialog role="dialog" aria-modal="true">` is wrapped in `FocusTrap`. Tab order includes the close button (focused on mount), fullscreen toggle, play/pause, prev/next, and the `LightboxColorPip` toggle button. The color-pip toggle button has an explicit `aria-expanded` attribute and its `aria-label` is constructed as `"${t('aria.toggleColorPip')}: ${[primaries, transfer, isHdr ? hdrBadge : null].filter(Boolean).join(' · ')}"` (lightbox-color-pip.tsx lines 122–128). When the pip is open, Tab order includes the copy button and the histogram's collapse button (both have `min-h-11 min-w-11` touch targets with `focus-visible` ring). No gap.

The histogram canvas at `histogram.tsx:599–606` has `role="img"` and `aria-label={t('aria.histogramLabel', { mode: modeLabels[mode] })}`. It is not keyboard-focusable directly, but the "cycle mode" button immediately below it is focusable and keyboard-operable. Clip percentage labels are in the DOM as text spans. The canvas contents are not keyboard-inspectable at the bin level, but that is expected canvas behavior and the textual percentile labels cover the same information channel. No actionable gap.

**7. Reduced-motion preference for blur crossfade**

`photo-viewer.tsx:733`: The `motion.div` blur placeholder uses `transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}`. When `useReducedMotion()` returns true, the duration is 0 — the blur snaps off immediately rather than fading. This respects the user's preference. The `AnimatePresence` slide transition at lines 739–741 also checks `prefersReducedMotion`. No issue.

**8. Histogram forced-colors / high-contrast mode**

The histogram canvas draws directly to a 2D context. Under `forced-colors: active` (Windows High Contrast), canvas pixel output is unaffected — forced-colors applies only to CSS colors, not canvas drawImage/fillRect calls. The histogram will remain visible and correctly colored. The surrounding text labels (`histogramSource`, `isClipped` hint, clip percentage text) are rendered as DOM text and will inherit system high-contrast colors normally. No gap.

**9. `isP3Pipeline` exhaustiveness**

`color-pipeline-decisions.ts:60–65`: `isP3Pipeline` uses `decision.startsWith('p3-from-')`. The `COLOR_PIPELINE_DECISIONS` array contains exactly `['srgb', 'srgb-from-unknown', 'p3-from-displayp3', 'p3-from-dcip3', 'p3-from-adobergb', 'p3-from-prophoto', 'p3-from-rec2020']`. All five P3 variants share the `p3-from-` prefix. The predicate correctly returns `true` for all five and `false` for the two sRGB variants. No gap.

**10. HEIF gain map propagation into AVIF/WebP/JPEG outputs**

The pipeline in `process-image.ts` reads the source file via Sharp and encodes to AVIF/WebP/JPEG using `sharp(inputPath)` fresh instances. Sharp does not propagate Apple HDR gain map auxiliary items (which live in the HEIF `iinf`/`iref` box structure) into AVIF/WebP/JPEG output — those formats have no equivalent gain-map container. The `has_gain_map` field is admin-only, and the audit row correctly says "delivered as SDR base only." The gain map bytes never leave the source HEIF. No issue.

**11. `color_pipeline_decision` in Atom feed / sitemap**

The Atom feed uses `getImagesForFeed()` which selects from `publicSelectFields`. `color_pipeline_decision` is in the `_PrivacySensitiveKeys` union and is destructured out of `publicSelectFields` at `data.ts:301`. It does not appear in feed XML or sitemap entries. No issue.

**12. Public photo page `og:image:alt`**

`p/[id]/page.tsx` line 98: `alt: displayTitle` — the OG image alt text is set to the photo's display title (human-readable title or `Photo #N` fallback). Not empty. No issue.

**13. CSP `img-src` and AVIF**

`content-security-policy.ts:29–33`: `getCspImageSources` returns `["'self'", 'data:', 'blob:']` plus an optional CDN origin. The `img-src` directive does not restrict by MIME type — it restricts by URL origin only. AVIF, WebP, and JPEG are all served from `'self'`. The browser's MIME-type gating on `<picture>` sources is browser-native and independent of CSP. No issue.

**14. `useDisplayCapability` Safari 18+ TP re-poll behavior**

`use-display-capability.ts:47–82`: `detect()` checks `screen.colorGamut` on every invocation, but `_cachedSnapshot` memoizes the result by value. Re-polls only happen when the `subscribe` callback fires (MQ change, focus, visibilitychange). The `screen.colorGamut` read itself is a synchronous property access — equivalent cost to a CSS property access. No re-render loop risk. No issue.

---

## Open R27 items (not re-raised, status noted)

The following R27 findings remain unimplemented and are confirmed still open:

| Finding | Status |
|---|---|
| R27-CP-HIGH-1 — `color_space` / `icc_profile_name` publicly exposed | Still open — confirmed at `data.ts:215–216`, absent from public omit block and from `SENSITIVE_KEYS` |
| R27-UX-HIGH-1 — No in-app backfill trigger | Still open |
| R27-CP-MED-1 — DCI-P3 chromaticity missing from `PRESETS` | Still open |
| R27-CP-MED-2 — `pipeline_version` absent from `adminSelectFields` | Still open |
| R27-HD-MED-1 — `histogramSource` label wrong after AVIF 404 | Still open — `histogram.tsx:485` still reads `preferAvif ? 'AVIF' : ...` |
| R27-UX-MED-1 — ColorDetailsSection accordion stale after navigation | Still open — `color-details-section.tsx:174` still has `useState(isNonTrivialColor)` with no reset `useEffect` |
| R27-UX-MED-2/3/4 — analytics disclosure, histogram reorder, shared-group analytics | Still open |
| R27-HD-LOW-1 — HDR toast copy | Still open |
| R27-CP-LOW-1 — `verifyAvifNclxInBuffer` `size > 64` gate | Still open |
| R27-UX-LOW-1 — Touch-target audit `SCAN_ROOTS` | Still open |
