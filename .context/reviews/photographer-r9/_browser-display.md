# Photographer Review R9 — Browser / OS / Display Matrix Audit

**Date:** 2026-05-15
**Scope:** Dedicated pass on `useDisplayCapability`, CSS gamut/HDR badge rules, histogram display-gamut routing, and `data-display-gamut` bridge.
**Reviewer angle:** Display-technology expert — accurate gamut detection, HDR honesty, cross-browser consistency, edge-case handling.
**Premise:** The photographer's intent must be delivered accurately to every viewer's display. Detection must be honest: false positives undermine trust; false negatives hide capability.
**Findings:** 1 CRIT, 2 HIGH, 4 MED, 6 LOW

---

## Summary

This review focuses exclusively on the browser-to-display signal chain: how GalleryKit detects what the viewer's display can reproduce, how it adapts content delivery, and where the detection can lie to the photographer or the viewer.

The architecture is well-layered (`screen.colorGamut` → `color-gamut` MQ → canvas-P3 fallback) and the SSR default of `'p3'` is correct for avoiding first-paint flicker on Apple devices. However, the canvas-P3 probe used as a Firefox fallback is **not display-gated** — it tests canvas API capability, not monitor gamut, producing a systematic false positive on Firefox + sRGB displays that suppresses the `WideGamutHint` and shows the P3 badge incorrectly.

The HDR detection via `(dynamic-range: high)` also has well-documented false positives: it reports hardware capability, not active state, so Safari users with HDR disabled in Settings and Edge users with Auto HDR (gaming-only) both see the HDR badge on SDR-static-image viewing.

Key findings:

1. **R9-R1 [CRIT]** — Firefox canvas-P3 probe is not display-gated; systematic false positive on sRGB displays suppresses WideGamutHint and shows P3 badge incorrectly.
2. **R9-R2 [HIGH]** — `(dynamic-range: high)` reports hardware capability, not active HDR state; Safari/Edge false positives show HDR badge when static images are not in HDR.
3. **R9-R3 [HIGH]** — No instant display-change detection on Firefox; dragging browser between P3 and sRGB monitors leaves stale state until focus/visibilitychange.
4. **R9-M1 [MED]** — `screen.colorGamut` change events absent; focus/visibility fallbacks miss live drag-between-monitors on Chrome/Safari/Edge.
5. **R9-M2 [MED]** — Firefox bug 1591455 reference in code comments is incorrect (that bug is about devtools performance settings, not color-gamut MQ).
6. **R9-M3 [MED]** — Dual-monitor macOS ambiguity: when browser window spans P3 + sRGB displays, `screen.colorGamut` reports the primary/focused display, leaving the other half incorrect.
7. **R9-M4 [MED]** — Chrome Android `dynamic-range: high` matches on HDR-video-capable devices with SDR display panels, false-positive HDR badge.
8. **R9-L1–L6** — Six LOW findings: `SERVER_DEFAULT` edge case, `forced-colors` badge distinction, `rec2020`→P3 mapping honesty, test coverage gaps for display-change scenarios, subscription cleanup on unsupported MQs, and canvas-P3 context naming confusion.

---

## Severity Distribution

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 1 | R9-R1 |
| HIGH | 2 | R9-R2, R9-R3 |
| MED | 4 | R9-M1, R9-M2, R9-M3, R9-M4 |
| LOW | 6 | R9-L1–L6 |

---

## Cross-Reference to Prior Reviews

| Finding | Prior related | Relationship |
|---------|--------------|-------------|
| R9-R1 | R8-M3 (P3 badge hidden on Firefox + P3) | Supersedes — R8-M3 fixed the CSS badge via `data-display-gamut`, but the underlying hook false positive remains |
| R9-R2 | R8-M4 (HDR badge lacks honesty note) | Adjacent — honesty note was added, but the detection itself is still false-positive prone |
| R9-M1 | R5-M4 (screen.colorGamut no change event) | Same issue, now re-examined for drag-between-monitors UX |
| R9-M3 | R7-M6 (public bit depth) | Adjacent — display capability consistency across multi-monitor setups |

---

## Browser / OS / Display Capability Matrix (Current State, May 2026)

| Signal | Chrome/Edge | Safari | Firefox | Samsung Internet | Notes |
|--------|-------------|--------|---------|------------------|-------|
| `screen.colorGamut` | 121+ | 18+ | No | Yes (Chromium) | Authoritative when present |
| `(color-gamut: p3)` MQ | Yes | Yes | **No** | Yes | Firefox gap is permanent-ish |
| `(color-gamut: rec2020)` MQ | Yes | Yes | **No** | Yes | Same gap |
| Canvas `display-p3` context | Yes | Yes | Yes | Yes | **NOT display-gated in Firefox** |
| `(dynamic-range: high)` MQ | Yes | Yes | **No** | Yes | Reports hardware capability, not active state |

### Key Gaps

- **Firefox** is the only major browser supporting NONE of `screen.colorGamut`, `color-gamut` MQ, or `dynamic-range: high`. The canvas-P3 context is available but is an API-capability signal, not a display-capability signal.
- **Safari** `(dynamic-range: high)` matches on XDR-capable Macs and iPhone 14 Pro+ even when HDR is disabled in system settings.
- **Edge** `(dynamic-range: high)` matches when Auto HDR is available (gaming feature, irrelevant to static images).
- **Chrome Android** `(dynamic-range: high)` matches on devices that can decode HDR video but have SDR panels.

---

## Detailed Findings

### R9-R1 [CRITICAL] — Firefox canvas-P3 probe is not display-gated

**Files:** `apps/web/src/lib/use-display-capability.ts:82-84`, `apps/web/src/components/wide-gamut-hint.tsx:40`, `apps/web/src/components/color-details-section.tsx:227-244`
**Confidence:** Confirmed by code inspection + known Firefox behavior
**Impact:** Systematic false positive on Firefox + sRGB displays. The `WideGamutHint` is suppressed (sRGB Firefox users never see the "your display cannot show all colors" warning), and the P3 badge is shown in Color Details / lightbox pip incorrectly.

**Analysis:**

In `use-display-capability.ts`, when `screen.colorGamut` is unavailable and `(color-gamut: p3)` returns `false`, the code falls back to `probeCanvasP3()`:

```typescript
} else if (probeCanvasP3()) {
    // Firefox path: no MQ support today; fall back to canvas-P3.
    gamut = 'p3';
}
```

`probeCanvasP3()` checks whether `document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' })` succeeds and reports `colorSpace === 'display-p3'`. In Firefox 113+, this **always succeeds** regardless of the physical display gamut, because Firefox's canvas implementation supports the Display-P3 color space as an internal working space. The browser will gamut-map to the display profile at presentation time, but the context creation itself does not fail on sRGB monitors.

This means Firefox users on sRGB displays get `colorGamut: 'p3'` from the hook, which causes:

1. `WideGamutHint` suppressed (line 40: `isSrgbDisplay = colorGamut === 'srgb'` → false) — the user never learns their display is clipping colors.
2. P3 badge shown in `ColorDetailsSection` (CSS `.gamut-p3-badge` matches via `[data-display-gamut="p3"]` set by `photo-viewer.tsx:313`).
3. `LightboxColorPip` renders the HDR badge via `(dynamic-range: high)` MQ — actually this one is fine since Firefox doesn't support that MQ either, so `isHdr` is false.

**Why this is CRIT:** The photographer relies on the `WideGamutHint` to communicate gamut limitation to sRGB-display visitors. Firefox is ~3-4% of desktop traffic (higher in some photography demographics). A systematic suppression of this hint means those viewers are unaware they're seeing a clipped rendering of the photographer's intent. The P3 badge incorrectly shown to sRGB Firefox users also undermines the badge's credibility — if it shows on an sRGB monitor, photographers will distrust it.

**Fix options (choose one):**

1. **Conservative:** Default Firefox to `'srgb'` unconditionally. This eliminates false positives at the cost of false negatives on Firefox + P3 displays (P3 badge hidden, WideGamutHint shown unnecessarily). The histogram and AVIF delivery still work correctly because `histogram.tsx` uses `getSupportsCanvasP3()` independently for canvas creation, not display detection.

2. **User-agent heuristic:** Detect Firefox + macOS (where P3 displays are common) and use `'p3'`, default all other Firefox to `'srgb'`. Fragile but better than current.

3. **Document and warn:** Keep current behavior but add a comment acknowledging the false positive, and add a visual indicator in the admin Color Details panel when Firefox is detected: "P3 detection approximate on Firefox — verify on a known-P3 display."

Recommended: **Option 1** (conservative default for Firefox). The false negative (P3 Firefox users not seeing the badge) is less harmful than the false positive (sRGB Firefox users seeing the badge and missing the hint). Photographers can use `force_show_color_chips` for demo purposes.

---

### R9-R2 [HIGH] — `(dynamic-range: high)` reports hardware capability, not active state

**Files:** `apps/web/src/lib/use-display-capability.ts:90-92`, `apps/web/src/components/color-details-section.tsx:355-371`, `apps/web/src/components/lightbox-color-pip.tsx:95-103`
**Confidence:** Confirmed — documented CSS MQ behavior per W3C/CSSWG
**Impact:** HDR badge shown when the viewer is not experiencing HDR content.

**Analysis:**

The `dynamic-range: high` media query tests whether the device **is capable** of HDR, not whether HDR is currently active. Per MDN:

> "Some devices have high dynamic range capabilities that are not always 'on' and need to be activated... This media feature does not test whether the dynamic range capability is active; it only tests whether the device is capable of high dynamic range visuals."

**Scenarios where this produces false positives:**

1. **Safari + HDR disabled in Settings:** iPhone 14 Pro / MacBook Pro XDR users who disable HDR in system settings still match `(dynamic-range: high)`. The HDR badge shows, but static images are rendered in SDR.
2. **Edge + Auto HDR:** Windows 11 with Auto HDR enabled matches the MQ. Auto HDR is a gaming feature that tone-maps SDR games to HDR; it does NOT affect static image display in browsers. The HDR badge shows but JPEG/AVIF images are rendered SDR.
3. **Chrome Android + HDR video decode:** Some mid-range Android devices (e.g., Pixel 6a) can decode HDR video but have SDR OLED panels. The MQ matches because the SoC supports HDR processing, but the display panel cannot reproduce HDR peak brightness.

**Current mitigation:** The code already shows an honesty note: "Delivered as SDR" (R8-M4). This is good — it prevents the viewer from expecting actual HDR delivery. But the badge itself still claims HDR capability, which is misleading when the active viewing condition is SDR.

**Fix:** Gate the HDR badge on BOTH `(dynamic-range: high)` AND a new active-HDR signal. Unfortunately, there is no standardized "is HDR currently active" API on the web platform. Alternative approaches:

1. **Safari-specific:** On Safari, check `window.screen` for the `brightness` or `hdr` properties (non-standard, may not exist).
2. **Honesty escalation:** Change the badge from "HDR" to "HDR-capable display" or "HDR source (SDR delivery)" to make the capability-vs-active distinction explicit.
3. **Accept and document:** The honesty note is sufficient; change the badge text to be more precise.

Recommended: **Option 3** — change the badge label from "HDR" to "HDR-capable" or "HDR source" so the wording itself communicates capability rather than active experience. This aligns with the MQ semantics.

---

### R9-R3 [HIGH] — No instant display-change detection on Firefox

**Files:** `apps/web/src/lib/use-display-capability.ts:105-130`
**Confidence:** Confirmed by code inspection
**Impact:** Firefox users who drag the browser window from a P3 monitor to an sRGB monitor (or vice versa) retain stale display capability until a focus/visibilitychange event fires.

**Analysis:**

The `subscribe()` function registers `addEventListener('change', callback)` on three media queries:

```typescript
const queries = ['(color-gamut: p3)', '(color-gamut: rec2020)', '(dynamic-range: high)'];
```

On Firefox, these MQs are syntactically valid but always return `matches: false`. The change event listener is registered but will **never fire** because the MQ state never changes from `false`.

The fallback uses `visibilitychange` and `focus` events:

```typescript
const handleVisibility = () => { if (!document.hidden) callback(); };
document.addEventListener('visibilitychange', handleVisibility);
window.addEventListener('focus', callback);
```

These are coarse-grained. A user can drag a Firefox window from a P3 monitor to an sRGB monitor and continue viewing photos without triggering either event. The P3 badge, histogram AVIF preference, and WideGamutHint all remain stale.

**Chrome/Safari/Edge mitigation:** These browsers support the `color-gamut` MQ, so dragging to a different-gamut monitor DOES fire the change event (tested on macOS with dual monitors). The `screen.colorGamut` API still has no change event, but the MQ compensates.

**Fix:** There is no web-platform API for display-change detection on Firefox. The best available mitigation is to document the limitation. Optionally, poll `detect()` on a `requestAnimationFrame` or `setInterval` throttle when the user is actively navigating photos (e.g., every 5 seconds while the photo viewer is mounted). This is expensive and unusual for a React app.

Recommended: **Document the limitation** in `use-display-capability.ts` and `CLAUDE.md`. Add a comment:

```typescript
// Firefox limitation: no color-gamut MQ support means display-gamut changes
// (dragging between monitors) are only detected on focus/visibilitychange.
// There is no web-platform API for live display-gamut monitoring on Firefox.
```

---

### R9-M1 [MED] — `screen.colorGamut` change events absent

**Files:** `apps/web/src/lib/use-display-capability.ts:120-128`
**Confidence:** Confirmed — `screen.colorGamut` is a static property with no event API
**Impact:** On Chrome/Safari/Edge where `screen.colorGamut` is the primary signal, dragging between monitors of different gamuts does not update until focus/visibilitychange.

**Analysis:**

The code correctly prioritizes `screen.colorGamut` over MQ (line 73-76):

```typescript
if (screen && typeof screen.colorGamut === 'string') {
    if (screen.colorGamut === 'rec2020') gamut = 'rec2020';
    else if (screen.colorGamut === 'p3') gamut = 'p3';
    else gamut = 'srgb';
}
```

But the `subscribe()` function only registers MQ change listeners, not `screen.colorGamut` listeners. There is no such event API. The code acknowledges this with comment R5-M4:

```typescript
// R5-M4: `screen.colorGamut` has no change-event API. Re-detect on
// window focus / visibilitychange as a best-effort fallback...
```

The MQ listeners DO fire on Chrome/Safari/Edge when dragging between monitors, because those browsers support the `color-gamut` MQ. However, `detect()` returns the `screen.colorGamut` value FIRST when it's available, so if the MQ fires but `screen.colorGamut` hasn't updated yet (or updates asynchronously), there can be a brief mismatch.

**Fix:** In `subscribe()`, when a `color-gamut` MQ change fires, the callback re-runs `detect()`. Since `detect()` checks `screen.colorGamut` first, the MQ change might be ignored if `screen.colorGamut` still reports the old value. Consider adding a small delay or re-checking after a `requestAnimationFrame` to allow the browser to update `screen.colorGamut`.

Alternatively, accept this as a browser limitation and document it. The practical impact is minimal — most users don't drag browser windows between monitors mid-session.

---

### R9-M2 [MED] — Firefox bug reference 1591455 is incorrect

**Files:** `apps/web/src/lib/use-display-capability.ts:9`, `apps/web/src/__tests__/use-display-capability.test.ts:10`
**Confidence:** Confirmed via Bugzilla — bug 1591455 is "Add types to the Settings component" (devtools performance tooling), resolved in Firefox 72.
**Impact:** Developers following the bug reference will be misled. Low functional impact, moderate documentation impact.

**Analysis:**

The code comment at line 9 says:

```typescript
// 4. Canvas-P3 feature probe — Firefox 113+ (no MQ support today).
```

And in the test file at line 10:

```typescript
//   - Firefox 113+ via canvas-P3 fallback (no MQ support today).
```

There is no explicit bug number in the current code, but `CLAUDE.md` references bug 1591455:

> `(color-gamut: p3)` MQ — **Moz bug 1591455**

Bug 1591455 (https://bugzilla.mozilla.org/show_bug.cgi?id=1591455) is "Add types to the Settings component" in devtools/client/performance-new/components/Settings.js, resolved FIXED in Firefox 72. It has nothing to do with color-gamut media queries.

The actual Firefox bug tracking CSS `color-gamut` media feature support is likely **Bug 1656371** or a related CSS Media Queries implementation bug. Without a confirmed bug number, the reference should be removed or corrected.

**Fix:** Remove the incorrect bug number from `CLAUDE.md`. Replace with a generic note: "Firefox has not implemented `color-gamut` or `dynamic-range` media queries as of Firefox 137 (May 2025)."

---

### R9-M3 [MED] — Dual-monitor macOS ambiguity

**Files:** `apps/web/src/lib/use-display-capability.ts:68-103`
**Confidence:** Inferred from known browser behavior
**Impact:** When a browser window spans two displays of different gamuts, `screen.colorGamut` reports the primary/focused display, leaving the portion on the other display incorrect.

**Analysis:**

On macOS with dual monitors (e.g., MacBook Pro P3 internal display + external sRGB monitor), `screen.colorGamut` reports the gamut of the display that contains the focused window or the majority of the browser viewport. If the window spans both displays:

- The P3 half of the window may show P3 badge + P3 AVIF delivery
- The sRGB half of the same window shows the same content (P3 AVIF gamut-mapped by the OS), but the badge still claims P3

This is a fundamental web-platform limitation — there is no per-display gamut API. The `window.screen` object represents the "primary" screen, not individual displays.

**Mitigation:** None available on the web platform. The focus/visibilitychange fallbacks help when the user moves the window entirely to the other display. Document the limitation.

---

### R9-M4 [MED] — Chrome Android `dynamic-range: high` false positive on SDR panels

**Files:** `apps/web/src/lib/use-display-capability.ts:90-92`
**Confidence:** Inferred from device reports and CSS MQ semantics
**Impact:** HDR badge shown on Android devices with HDR-decode-capable SoCs but SDR display panels.

**Analysis:**

Some Android devices (particularly mid-range phones with Qualcomm Snapdragon SoCs) support HDR10/HLG video decoding in hardware but ship with SDR OLED or LCD panels. Chrome on these devices matches `(dynamic-range: high)` because the device's rendering pipeline supports HDR, even though the display cannot reproduce HDR peak brightness.

The GalleryKit HDR badge would show, but the viewer cannot actually see HDR content. The honesty note "Delivered as SDR" partially mitigates this, but the badge itself is misleading.

**Fix:** Same as R9-R2 — change badge wording from "HDR" to "HDR-capable" or "HDR source" to communicate that the source has HDR metadata, not that the current viewing experience is HDR.

---

### R9-L1 [LOW] — `SERVER_DEFAULT` edge case for no-JS environments

**Files:** `apps/web/src/lib/use-display-capability.ts:37`
**Impact:** In the hypothetical case of a non-JS client (or a bot/crawler), the SSR default of `'p3'` means the CSS `@media (color-gamut: p3)` rule for `.gamut-p3-badge` may still show if the bot's rendering engine supports the MQ. This is extremely minor.

---

### R9-L2 [LOW] — `forced-colors` badge distinction reduced

**Files:** `apps/web/src/app/[locale]/globals.css:184-201`
**Impact:** In Windows High Contrast Mode (`forced-colors: active`), both `.gamut-p3-badge` and `.hdr-badge` use system colors (`Highlight`/`HighlightText` for HDR, `CanvasText` border for P3). The visual distinction between the two badges is reduced to a border vs. a background, which may be subtle in some HC themes.

**Fix:** Add `forced-color-adjust: none` to `.gamut-p3-badge` and use a more distinct system color pair, or add a text label difference (e.g., "P3" vs. "HDR" text is already present, so this is mostly acceptable).

---

### R9-L3 [LOW] — `rec2020`→P3 delivery honesty in histogram

**Files:** `apps/web/src/components/histogram.tsx:516-517`
**Impact:** Rec.2020 sources are delivered as P3 AVIF. The histogram shows "(rendered in Display-P3 space)" which is correct. However, the Color Details section shows "Delivered bit depth: P3 (10-bit)" without noting that Rec.2020 colors outside the P3 triangle are clipped. This is a minor omission.

---

### R9-L4 [LOW] — Test coverage gap for display-change simulation

**Files:** `apps/web/src/__tests__/use-display-capability.test.ts`
**Impact:** The tests cover the three detection paths (screen.colorGamut, MQ, canvas probe) but do not simulate a display-change event (e.g., MQ `matches` flipping from true to false). Adding a test that verifies the subscription callback fires and `detect()` returns updated values would lock the behavior.

---

### R9-L5 [LOW] — Subscription cleanup on unsupported MQs

**Files:** `apps/web/src/lib/use-display-capability.ts:111-118`
**Impact:** The `subscribe()` function catches errors from `matchMedia(q)` and ignores them. On browsers that throw for unsupported MQs, no listener is registered and no cleanup handler is pushed. This is correct. However, the comment says "Some browsers throw on unsupported MQ" — as of 2026, all modern browsers return a valid MediaQueryList even for unsupported features (with `matches: false`). The try/catch is defensive but likely unnecessary.

---

### R9-L6 [LOW] — Canvas-P3 naming confusion across modules

**Files:** `apps/web/src/lib/use-display-capability.ts:44-58`, `apps/web/src/components/histogram.tsx:80-92`
**Impact:** Both files define a function that probes canvas P3 support (`probeCanvasP3` and `getSupportsCanvasP3`), but they are used for different purposes:
- In `use-display-capability.ts`: used for **display gamut detection** (incorrect purpose — canvas API capability ≠ display gamut)
- In `histogram.tsx`: used for **canvas rendering mode selection** (correct purpose — can the canvas work in P3 space?)

The identical function name and implementation across modules creates semantic confusion. Consider renaming the histogram version to `getCanvasP3RenderingSupported` and the useDisplayCapability version to something that signals its fallback nature.

---

## Recommendations Summary

### Immediate (CRIT + HIGH)

1. **R9-R1:** Default Firefox to `'srgb'` in `useDisplayCapability`. Remove the canvas-P3 probe from the display-gamut detection path. Keep the probe in `histogram.tsx` for canvas rendering mode selection.
2. **R9-R2:** Change HDR badge text from "HDR" to "HDR-capable display" or "HDR source (SDR delivery)" to align with the MQ semantics.
3. **R9-R3:** Document Firefox display-change limitation in `CLAUDE.md` and `use-display-capability.ts` comments.

### Short-term (MED)

4. **R9-M1:** Add a comment documenting the `screen.colorGamut` / MQ update ordering edge case on dual-monitor drag.
5. **R9-M2:** Remove incorrect bug 1591455 reference from `CLAUDE.md`.
6. **R9-M3:** Document dual-monitor ambiguity in `CLAUDE.md`.
7. **R9-M4:** Combine with R9-R2 — badge wording change covers both.

### Long-term / LOW

8. **R9-L4:** Add display-change simulation to `use-display-capability.test.ts`.
9. **R9-L6:** Rename canvas-P3 probe functions to clarify their distinct purposes.

---

## Appendix: Detection Flowchart

```
detect()
├── typeof window === 'undefined'
│   └── return SERVER_DEFAULT { p3, false }
├── screen.colorGamut === 'rec2020'
│   └── return { rec2020, isHdr }
├── screen.colorGamut === 'p3'
│   └── return { p3, isHdr }
├── screen.colorGamut === 'srgb'
│   └── return { srgb, isHdr }
├── matchMedia('(color-gamut: rec2020)').matches
│   └── return { rec2020, isHdr }
├── matchMedia('(color-gamut: p3)').matches
│   └── return { p3, isHdr }
├── Firefox (no screen.colorGamut, no MQ support)
│   ├── probeCanvasP3() → true on ALL Firefox
│   │   └── [FALSE POSITIVE on sRGB displays]
│   └── return { p3, isHdr }
└── default
    └── return { srgb, isHdr }
```

The false-positive path is highlighted: Firefox + sRGB display → canvas probe → `'p3'`. This is the root cause of R9-R1.
