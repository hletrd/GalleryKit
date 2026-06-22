# Run-9 Cycle-7 Designer Review (HEAD feb63faa)

Agent: DESIGNER (UI/UX + a11y)
Scope: React/Tailwind frontend a11y + UX defects; SPECIAL FOCUS on 6-settings forwarding

---

## Summary verdict

**NEW FINDINGS: 1 DEFECT (HIGH), 0 POLISH items requiring action.**

The a11y posture of the component surface is strong across all reviewed files. Touch-target enforcement is consistent (44px floor held everywhere inspected). Dialog focus traps, live regions, ARIA labelling, skip-link, `lang` attribute, and role patterns are all correctly implemented. The one genuine defect is in the SPECIAL FOCUS: the Lightroom PAT upload route (`lr/upload/route.ts:420`) enqueues a job that supplies `quality` and `imageSizes` but omits all 6 new settings added by CR-R9C6-01, causing them to be silently discarded by the gate at `image-queue.ts:336`. This confirms the lead's preliminary finding.

---

## A11Y Surface Review

### Root layout — `apps/web/src/app/[locale]/layout.tsx`

- **`lang` attribute (line 95):** `<html lang={locale}>` — correct. Dynamic locale value from the route segment.
- **`dir` attribute (line 99):** `dir="ltr"` present with comment noting RTL future-proofing.
- **Skip link (lines 123-128):** `<a href="#main-content" className="sr-only focus:not-sr-only focus:absolute ...">` — correct pattern; first focusable element in document; becomes visible on focus with `focus:bg-primary focus:text-primary-foreground`.
- **Skip link target:** Public layout (`app/[locale]/(public)/layout.tsx`) provides `<main id="main-content" tabIndex={-1}>`. Admin layout (`app/[locale]/admin/layout.tsx:26`) also provides `<main id="main-content" tabIndex={-1}>` with comment explicitly calling out the prior missing-id fix (AGG-R5C3-03).

**CLEAN.**

---

### Nav — `apps/web/src/components/nav-client.tsx`

- **`<nav aria-label>` (line 78):** `aria-label={t('aria.mainNav')}` — correct landmark.
- **Home link (line 85):** `min-h-[44px]` — 44px.
- **Mobile expand toggle (line 93-108):** `min-w-[44px] min-h-[44px]`, `aria-label` (dynamic: expand/collapse), `aria-expanded`, `aria-controls="primary-nav-topics primary-nav-controls"` — correct compound control pattern.
- **Topic links (line 122-145):** `min-h-[44px]`, `aria-current={isActive ? "page" : undefined}` — correct page-current indicator.
- **Topic avatar images (line 134-140):** `alt=""` + `aria-hidden="true"` — correct decorative treatment.
- **Theme toggle (line 155-159):** `min-w-[44px] min-h-[44px]`, `aria-label` — 44px.

**CLEAN.**

---

### Photo viewer — `apps/web/src/components/photo-viewer.tsx`

(Reviewed in prior session; findings reproduced for completeness.)

- `<main>` container: `aria-describedby="photo-viewer-shortcuts"` on wrapping div.
- SR-only `<h1>` for page navigation landmark.
- Keyboard shortcut hint: `<p id="photo-viewer-shortcuts">` is `hidden md:block` — correctly excluded from SR on mobile where the hint is not shown.
- Back button `h-11`, lightbox trigger `h-11 w-11`, info button `h-11`, pin button `h-11`, share button `h-11`.
- Position counter: `role="status" aria-live="polite"`.
- Download buttons: `min-h-11`.

**CLEAN.**

---

### Lightbox — `apps/web/src/components/lightbox.tsx`

(Reviewed in prior session.)

- `<FocusTrap>` with `allowOutsideClick: true` and `fallbackFocus`.
- `role="dialog" aria-modal="true" aria-label`.
- Focus save/restore on mount/unmount.
- Slideshow state: `<div aria-live="polite" aria-atomic="true" className="sr-only">`.
- `controlVisibilityProps = { tabIndex: -1, 'aria-hidden': true }` when controls hidden.
- Close `h-11 w-11`, fullscreen `h-11 w-11`, slideshow `h-11 w-11` with `aria-pressed`.
- Prev/next: `h-full w-16` full-height clickable area.
- Position counter: `role="status" aria-live="polite"`.
- Image alt: `getConcisePhotoAltText(image, t('common.photo'))`.
- `aria-keyshortcuts` on close ("Escape"), prev ("ArrowLeft"), next ("ArrowRight").

**CLEAN.**

---

### Lightbox color pip — `apps/web/src/components/lightbox-color-pip.tsx`

- Main toggle button (line 128): `min-h-11`, `aria-expanded={open}`, `aria-label` with computed color metadata.
- DCI-P3 tooltip info button (line 184): `min-h-11 min-w-11 items-center justify-center`, `aria-label`.
- Copy button (line 267): `min-h-11 min-w-11`, `aria-label`.
- Non-interactive color detail rows are plain `<div>` elements — correct, no spurious button/role.

**CLEAN.**

---

### Color details section — `apps/web/src/components/color-details-section.tsx`

- Accordion toggle (line 288): `min-h-[44px]`, `aria-expanded`, `aria-controls={colorDetailsId}`. The controlled region carries `id={colorDetailsId}` — correct labelling pair.
- Tooltip info button (line 305): `min-h-[44px] min-w-[44px]`, `aria-label`.
- Copy button (line 321): `min-h-[44px] min-w-[44px]`, `aria-label`.
- DCI-P3 info button (line 395): `min-h-11 min-w-11`, `aria-label`.
- HDR badge (line 525): `role="img" aria-label title` — correct non-interactive static element treatment.
- `useImperativeHandle` exposes toggle — correct React 19 pattern.

**CLEAN.**

---

### Search — `apps/web/src/components/search.tsx`

- Trigger button (line 299): `h-11 w-11`, `aria-haspopup="dialog"`, `aria-expanded`, `aria-label`.
- `<FocusTrap active={isOpen}>` with `initialFocus: '#search-input'`, `fallbackFocus: '#search-dialog'`.
- Dialog (line 331): `role="dialog" aria-modal="true" aria-label`.
- SR-only `<label htmlFor="search-input">` (line 341).
- Input (line 344): `id="search-input"`, `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, `aria-activedescendant`.
- Input height `h-8` (32px) — this is the pre-deferred **DEF-C11-01**; no new evidence to reopen.
- Close button (line 377): `h-11 w-11` — 44px.
- Status region (line 389): `aria-live="polite" aria-atomic="true"` sr-only.
- Listbox (line 402): `role="listbox" aria-label`.
- Result items: `role="option" aria-selected`.
- Semantic toggle: `<Switch id>` + `<Label htmlFor>` pair.
- Focus restoration: `triggerRef.current?.focus()` via `requestAnimationFrame` on close.
- IME composition guard: `isImeComposingNativeEvent` / `isImeComposingReactEvent`.

**CLEAN.** DEF-C11-01 exit criterion not met; not re-filed.

---

### Wide-gamut hint — `apps/web/src/components/wide-gamut-hint.tsx`

- Container (line 176): `role="status" aria-live="polite" aria-atomic="true"`.
- Dismiss button (line 199): `min-h-11 min-w-11 inline-flex items-center justify-center`, `aria-label`.
- X icon: `aria-hidden="true"`.
- `setMounted(true)` prevents SSR hydration mismatch.

**CLEAN.**

---

### Histogram — `apps/web/src/components/histogram.tsx`

- Collapse/expand button (line 615): `min-h-11 min-w-11`, dynamic `aria-label`.
- Canvas (line 636): `role="img" aria-label={t('aria.histogramLabel', { mode: modeLabels[mode] })}`.
- Mode cycle button (line 702): `min-h-11 min-w-11`, `aria-label`.
- Key-type `<span tabIndex={0}>` (line 688): Inside `<TooltipTrigger asChild>` — keyboard-hoverable informational text; no interactive role needed. At-most POLISH, not a WCAG defect.

**CLEAN.**

---

## SPECIAL FOCUS: 6-settings forwarding across all enqueue paths

### Background

CR-R9C6-01 (cycle-6) extended `ImageProcessingJob` with 6 fields (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`) and wired them from `uploadConfig` in the browser upload path (`actions/images.ts:440`).

The handler gate at `image-queue.ts:336`:
```
if (!quality && !imageSizes) {
    // load all settings from current config
}
```
This gate only fires when a job carries **neither** quality **nor** imageSizes. A job that supplies quality but omits the 6 settings will **not** enter the gate and the 6 are read from unset job fields, falling back to `?? false` / `undefined` — effectively discarding the current admin config values for those settings.

---

### Path-by-path analysis

#### 1. Browser upload — `apps/web/src/app/actions/images.ts:440`

Confirmed COMPLETE in cycle-6. Supplies all 6 settings from `uploadConfig`. Not re-examined in detail.

#### 2. LR PAT upload route — `apps/web/src/app/api/admin/lr/upload/route.ts:420-444`

```typescript
// line 420-444
enqueueImageProcessing({
    id: imageId,
    filenameOriginal: data.filenameOriginal,
    filenameWebp: data.filenameWebp,
    filenameAvif: data.filenameAvif,
    filenameJpeg: data.filenameJpeg,
    width: data.width,
    topic: topicSlug,
    quality: {
        webp: config.imageQualityWebp,        // ← supplied
        avif: config.imageQualityAvif,
        jpeg: config.imageQualityJpeg,
    },
    imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,  // ← supplied
    camera_model: exifDb.camera_model,
    capture_date: exifDb.capture_date,
    iccProfileName: data.iccProfileName,
    colorSignals: data.colorSignals,
    // forceSrgbDerivatives     ← MISSING
    // wideGamutJpegChroma      ← MISSING
    // avifEffort               ← MISSING
    // sdrJpegChroma            ← MISSING
    // wideGamutMaxSourcePixels ← MISSING
    // autoAltTextEnabled       ← MISSING
});
```

**CONFIRMED DEFECT.** The route reads `config` (from `getGalleryConfig()`, called earlier in the handler) which has all 6 values, but only forwards `quality` and `imageSizes`. Because `quality` is supplied, the handler gate at `image-queue.ts:336` does NOT fire, and the 6 settings fall back to `?? false` / `undefined` instead of the current admin config. Every LR publish ignores `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, and `autoAltTextEnabled` regardless of what the admin has configured.

#### 3. Bootstrap — `apps/web/src/lib/image-queue.ts:674-692`

```typescript
// line 674-692
enqueueImageProcessing({
    id: image.id,
    filenameOriginal: image.filename_original,
    // ... filenames, width, topic, dates, icc, colorSignals
    // quality:      ← NOT supplied
    // imageSizes:   ← NOT supplied
    // 6 settings:   ← NOT supplied
});
```

**CORRECT BY DESIGN.** Neither `quality` nor `imageSizes` is supplied, so the handler gate (`if (!quality && !imageSizes)`) fires and all settings — including the 6 — are loaded from current config at processing time. This is the documented bootstrap / legacy-re-enqueue path.

#### 4. Retry path A — `apps/web/src/lib/image-queue.ts:510`

```typescript
// line 509-511
state.enqueued.delete(job.id);
enqueueImageProcessing(job);   // re-enqueues the SAME job object
```

**CORRECT.** Re-enqueues the same `job` reference, which already carries whatever fields the original enqueue provided (including the 6 for browser-upload jobs, or the absence of the 6 for bootstrap/LR jobs). No new information is lost here — the retry inherits the upstream defect for LR jobs but introduces no new defect.

#### 5. Claim retry path — `apps/web/src/lib/image-queue.ts:290`

```typescript
// line 289-291
const retryTimer = setTimeout(() => {
    enqueueImageProcessing(job);  // re-enqueues the same job
}, delay);
```

**CORRECT.** Same analysis as retry path A — re-enqueues the same `job` object.

#### 6. `retryFailedImage` — `apps/web/src/app/actions/images.ts:1139-1157`

```typescript
// line 1139-1157
enqueueImageProcessing({
    id: image.id,
    filenameOriginal: image.filename_original,
    // ... filenames, width, topic, icc, colorSignals, camera_model, capture_date
    // quality:      ← NOT supplied
    // imageSizes:   ← NOT supplied
    // 6 settings:   ← NOT supplied
});
```

**CORRECT BY DESIGN.** Neither quality nor imageSizes supplied → gate fires → all settings loaded from current config at processing time. This is intentional: a retry should use current admin settings, not the potentially stale upload-time snapshot.

#### 7. Admin backfill runner — `apps/web/src/lib/admin-backfill-runner.ts:499-513`

```typescript
// line 499-513
const result = await processImageFormats(
    originalPath,
    row.filename_webp, row.filename_avif, row.filename_jpeg,
    row.width,
    settings.quality,
    settings.sizes,
    row.icc_profile_name,
    settings.forceSrgbDerivatives,       // ← present
    row.color_primaries ? { colorPrimaries: row.color_primaries } : null,
    settings.wideGamutJpegChroma,        // ← present
    settings.avifEffort,                 // ← present
    settings.sdrJpegChroma,              // ← present
    settings.wideGamutMaxSourcePixels,   // ← present
);
```

**CORRECT.** The backfill runner calls `processImageFormats` directly (not via `enqueueImageProcessing`) and passes all 6 settings from its `settings` object, which is loaded from `getGalleryConfig()` at backfill start.

#### 8. Sidecar backfill script — `apps/web/scripts/backfill-color-pipeline.ts:203-218`

```typescript
// line 203-218
const result = await processImageFormats(
    originalPath,
    row.filename_webp, row.filename_avif, row.filename_jpeg,
    row.width,
    settings?.quality,
    settings?.sizes,
    row.icc_profile_name,
    settings?.forceSrgbDerivatives,       // ← present
    row.color_primaries ? { colorPrimaries: row.color_primaries } : null,
    settings?.wideGamutJpegChroma,        // ← present
    settings?.avifEffort,                 // ← present
    settings?.sdrJpegChroma,             // ← present
    settings?.wideGamutMaxSourcePixels,  // ← present
);
```

**CORRECT.** Same pattern as admin backfill runner — direct `processImageFormats` call with all 6 settings forwarded.

---

### Special focus conclusion table

| Path | quality | imageSizes | 6 settings | Gate fires? | Verdict |
|---|---|---|---|---|---|
| Browser upload (`actions/images.ts:440`) | ✓ | ✓ | ✓ | No (not needed) | CORRECT |
| **LR PAT upload (`lr/upload/route.ts:420`)** | **✓** | **✓** | **✗** | **No** | **DEFECT** |
| Bootstrap (`image-queue.ts:674`) | ✗ | ✗ | ✗ | Yes → loaded | CORRECT |
| Retry same-job (`image-queue.ts:290/:510`) | inherited | inherited | inherited | Depends on job | CORRECT |
| `retryFailedImage` (`images.ts:1139`) | ✗ | ✗ | ✗ | Yes → loaded | CORRECT |
| Admin backfill runner (`admin-backfill-runner.ts:499`) | direct call | direct call | ✓ | N/A | CORRECT |
| Sidecar backfill (`backfill-color-pipeline.ts:203`) | direct call | direct call | ✓ | N/A | CORRECT |

---

## Findings

### DEFECT-R9C7-01 — LR PAT upload route omits 6 processing settings from enqueue call

- **File:line:** `apps/web/src/app/api/admin/lr/upload/route.ts:420-444`
- **Classification:** DEFECT
- **Severity:** HIGH
- **Confidence:** High (code read; `config` is in scope with all 6 values; none are forwarded)
- **WCAG criterion:** N/A (functional/correctness defect)
- **Failure scenario:** An admin configures `forceSrgbDerivatives=true`, `avifEffort=8`, non-default chroma subsampling, or a restricted `wideGamutMaxSourcePixels`. A photographer then publishes photos from Lightroom Classic via the PAT plugin. The enqueued job carries only `quality` and `imageSizes`; because `quality` is present the handler gate at `image-queue.ts:336` does not fire, so all 6 settings fall through to `job.forceSrgbDerivatives ?? false` etc., discarding the admin's configuration. LR-published photos are processed with different settings than browser-uploaded photos. If `autoAltTextEnabled` is `true` in admin config but false on the job, auto alt-text generation is also skipped.
- **Fix:** At `lr/upload/route.ts:420`, add the 6 fields to the `enqueueImageProcessing` call, reading from the in-scope `config` object:
  ```typescript
  enqueueImageProcessing({
      // ... existing fields ...
      quality: { ... },
      imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,
      // add:
      forceSrgbDerivatives: config.forceSrgbDerivatives,
      wideGamutJpegChroma: config.wideGamutJpegChroma,
      avifEffort: config.avifEffort,
      sdrJpegChroma: config.sdrJpegChroma,
      wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
      autoAltTextEnabled: config.autoAltTextEnabled,
  });
  ```
  `config` is already fetched earlier in the same request handler (it is referenced for `imageQualityWebp`, `imageQualityAvif`, `imageQualityJpeg`, and `imageSizes` at the existing call site), so no additional DB round-trip is needed.

---

## Items NOT re-filed

- **POL-R9C5-01** (decorative SVG aria-hidden): exit criterion not met — no new evidence.
- **DES-R9C3-02** (analytics `th scope`): exit criterion not met.
- **DEF-C11-01** (search input 32px `h-8`): exit criterion not met — input height unchanged.
- Histogram key-type `<span tabIndex={0}>`: informational text with tooltip, no interactive affordance required. At-most POLISH; not filed.

---

## Touch-target audit summary

Every interactive element inspected in this review presents ≥ 44px in the touch axis:

| Component | Element | Class / size |
|---|---|---|
| nav-client | Home link | `min-h-[44px]` |
| nav-client | Mobile expand toggle | `min-w-[44px] min-h-[44px]` |
| nav-client | Topic links | `min-h-[44px]` |
| nav-client | Theme toggle | `min-w-[44px] min-h-[44px]` |
| photo-viewer | Back, lightbox, info, pin, share | `h-11` |
| photo-viewer | Download, dropdown items | `min-h-11` |
| lightbox | Close, fullscreen, slideshow | `h-11 w-11` |
| lightbox | Prev/next nav | `h-full w-16` |
| lightbox-color-pip | Toggle, info, copy | `min-h-11 (min-w-11)` |
| color-details-section | Accordion toggle, info, copy, dci-p3 info | `min-h-[44px]` / `min-h-11` |
| search | Trigger, close | `h-11 w-11` |
| wide-gamut-hint | Dismiss | `min-h-11 min-w-11` |
| histogram | Collapse/expand, mode cycle | `min-h-11 min-w-11` |

No touch-target violations found in this review pass.
