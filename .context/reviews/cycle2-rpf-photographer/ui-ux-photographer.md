# Cycle 2 RPF — UI/UX review (photographer audit-surface)

**Date:** 2026-05-08
**Cycle:** 2/100
**Reviewer angle:** EXIF panel, Color Details accordion, histogram, HDR badge, lightbox color pip, mobile bottom sheet, download dropdown — i.e. every surface where the photographer audits whether GalleryKit is honoring their intent.
**Predecessor reviews:** `.context/reviews/photographer-r3/ui-ux-photographer.md`, `.context/reviews/cycle1-rpf-photographer/_aggregate.md`.

The hot path is now well-instrumented. Findings here are residual.

---

## C2-UX-MED-1 — Wide-gamut hint copy reads as victim-blame

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** audit honesty; first-time visitor education.

**Files:**
- `apps/web/messages/en.json:338` — *"This photo uses a wide color gamut. Your display may not show all colors accurately."*
- `apps/web/messages/ko.json:338` — Korean equivalent with the same shape.

**Why it's a problem:** see also `color-fidelity.md` C2-COL-MED-3 — the current copy implies the visitor's display is at fault. The framing planned in plan-38 P3-8 was *"Your display shows the sRGB version of this photo. Additional saturation is available on supported displays."* — the latter attributes the limitation correctly to the delivery decision (we showed the sRGB version because we detected your display can't show full P3) and tells the visitor what they'd need.

**Failure scenario:** photographer demos GalleryKit on a sRGB external monitor at a portfolio review; the prospect reads the hint and concludes the *display* is broken; either the prospect closes the laptop ("must be old"), or the photographer has to explain the framing — friction that didn't need to exist.

**Fix:** see C2-COL-MED-3 in `color-fidelity.md` for the corrected copy.

---

## C2-UX-MED-2 — `c` and `h` keyboard shortcuts in `info-bottom-sheet` not wired (mobile)

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** keyboard parity between desktop and mobile.

**File:** `apps/web/src/components/photo-viewer.tsx:343-350`, `apps/web/src/components/info-bottom-sheet.tsx`.

**Why it's a problem:** the keyboard handler at `photo-viewer.tsx:343-350` toggles `colorDetailsToggleRef` (desktop accordion) and `histogramCycleRef` (desktop histogram). The mobile bottom sheet has its own embedded `ColorDetailsSection` (`info-bottom-sheet.tsx:485-...`) but the refs are wired only to the desktop sidebar instance. On a tablet (e.g. iPad with Magic Keyboard), pressing `c` does nothing for the mobile-bottom-sheet flow. The mobile UI has no equivalent toggle path for the histogram either.

This is **not gate-blocking** because most mobile use is touch-only. But the cycle-1 review (`bd2b9e23`) added the `C` and `H` hints to viewer hints (en + ko), implying the shortcuts are documented; on tablets that doc-promise is not honored.

**Failure scenario:** photographer on iPad Pro with Magic Keyboard at a coffee shop reviews their portfolio; presses `c` to toggle Color Details on the bottom-sheet view; nothing happens; reads the keyboard-hints doc; concludes "shortcut broken."

**Fix:** wire `colorDetailsToggleRef` and `histogramCycleRef` through to whichever instance is currently visible. One approach: have the photo-viewer track which surface (sidebar or bottom-sheet) is active, and forward the ref binding accordingly.

```tsx
// in photo-viewer.tsx
const isLg = window.matchMedia('(min-width: 1024px)').matches;
// Sidebar instance gets the ref when isLg && isPinned; bottom-sheet instance gets it when !isLg && showBottomSheet.
```

**Recommendation:** address in plan-39. Self-contained.

---

## C2-UX-LOW-1 — Histogram canvas size is fixed `240x120`; not responsive on small viewports

**Severity:** LOW.
**Confidence:** HIGH.
**Photographer-axis:** mobile audit ergonomics.

**File:** `apps/web/src/components/histogram.tsx:408, 416-418`.

**Code:**
```tsx
<div className="relative w-[240px] h-[120px] bg-black/20 rounded overflow-hidden">
    …
    <canvas ref={canvasRef} width={240} height={120} className="w-full h-full" … />
```

**Why it's a problem:** on a 320 px viewport (iPhone SE, the smallest documented breakpoint per `home-320.png` artifact), the histogram occupies 240 of 320 px (75% of viewport width). The canvas backing pixels are also fixed at 240x120; on a 2x DPR device the canvas is upscaled by the layout but not by the backing buffer, leading to slight blur of the histogram strokes.

This is the cycle-1 R3 LOW carry-forward (R3-L7).

**Failure scenario:** photographer on iPhone SE, histogram strokes are very slightly blurry under DPR upscale; not blocking but visible to a critical eye.

**Fix:** make the canvas responsive: `w-full max-w-[240px]` for the wrapper, and use `getBoundingClientRect()` or a `ResizeObserver` to set the canvas backing-buffer width to `actualWidth * window.devicePixelRatio`. Then use `ctx.scale(devicePixelRatio, devicePixelRatio)` so the existing `drawHistogram` math doesn't change.

**Recommendation:** **defer**. Already in the deferred queue.

---

## C2-UX-LOW-2 — `colorDetailsId` uses `image.id` directly; multiple instances on the page (sidebar + bottom-sheet) collide

**Severity:** LOW.
**Confidence:** HIGH.
**Photographer-axis:** assistive-tech audit (ARIA `aria-controls` requires unique IDs).

**File:** `apps/web/src/components/color-details-section.tsx:88`.

**Code:**
```tsx
const colorDetailsId = `color-details-${image.id}`;
```

**Why it's a problem:** when both the desktop sidebar and the mobile bottom-sheet contain the same `<ColorDetailsSection>` for the same `image.id` (e.g. on a tablet that's wider than 1024px AND has the bottom-sheet visible due to a transitional state), two DOM elements with `id="color-details-123"` exist. ARIA `aria-controls` on the trigger then ambiguously resolves; assistive tech may toggle the wrong panel.

**Failure scenario:** rare. Bottom-sheet should be hidden when desktop sidebar is shown (sync logic at `photo-viewer.tsx:303-323`). But during the transition between breakpoints (300 ms or so) both can be in the DOM, and screen-reader navigation during that window can misroute.

**Fix:** allow the parent to pass a per-instance suffix:

```tsx
interface ColorDetailsSectionProps {
    image: ImageDetail;
    isAdmin?: boolean;
    t: (key: string) => string;
    toggleRef?: React.RefObject<(() => void) | null>;
    instanceId?: string;  // 'sidebar' | 'sheet' | etc.
}
const colorDetailsId = `color-details-${image.id}${instanceId ? '-' + instanceId : ''}`;
```

**Recommendation:** **defer.** Low impact.

---

## Carry-forward

| ID | From | Status |
|---|---|---|
| P3-33 polish bundle | plan-38 | Open |
| Mobile bottom sheet keyboard parity | new this cycle | Open (`C2-UX-MED-2`) |

---

## Summary

| Severity | Count |
|---|---|
| MED | 2 |
| LOW | 2 |

UI/UX is in shape. Most polish remaining is mobile-audit / responsive details.
