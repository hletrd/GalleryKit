# Cross-Platform Color Matrix Review (R4)

**Date:** 2026-05-08
**Premise:** photos arrive AFTER editing. Verify the photographer's intent transmits accurately across the (browser × OS × display) matrix.
**Scope:** browser/OS/display compatibility for color delivery, P3 / HDR detection signals, Firefox / Edge / mobile-Chrome quirks, the `screen.colorGamut` JS API gap, audit-surface cross-browser parity.

---

## 0. Today's compatibility map

For a Display P3 AVIF + WebP + JPEG photo (the modal wide-gamut output):

| Browser | OS | Display | AVIF P3 | WebP P3 | JPEG P3 | Histogram canvas-P3 | `(color-gamut:p3)` MQ | `(dynamic-range:high)` MQ | `screen.colorGamut` API |
|---|---|---|---|---|---|---|---|---|---|
| Safari 17+ | macOS 14+ | Internal P3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Safari 18+ TP only |
| Safari 17+ | iOS 17+ | iPhone 13-15 (P3+HDR) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ on Pro | iOS 18+ TP |
| Chrome 122+ | macOS 14+ | Internal P3 | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** | ✓ |
| Chrome 122+ | Windows 11 | Dell U2723QE w/ HDR | ✓ | ✓ | ✓ | ✓ | ✓ (with system SDR mode) | partial | ✓ |
| Edge 122+ | Windows 11 | Dell w/ Auto HDR | ✓ | ✓ | ✓ | ✓ | ✓ (system SDR) | ✓ (system HDR) | ✓ |
| Firefox 124+ | macOS 14+ | Internal P3 | ✓ (FF 113+) | ✓ | ✓ | ✓ via probe (post-cycle-3 fix) | **✗** Moz bug 1591455 | **✗** | ✗ |
| Firefox 124+ | Windows 11 | Dell U2723QE | ✓ | ✓ | ✓ | ✓ via probe | **✗** | ✗ | ✗ |
| Chrome | Android 14 | Pixel 8 (P3 panel) | ✓ | ✓ | ✓ | ✓ | partial (varies by ROM) | **✗** | ✓ Chrome 121+ |
| Chrome | Android 13 | Mid-range Android (sRGB) | sRGB-clip | sRGB-clip | sRGB-clip | sRGB | ✗ | ✗ | ✓ |
| Safari 16 | iOS 16 | iPhone X (P3, no HDR) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Legacy IE | — | — | ✗ | ✗ | ✓ | sRGB | ✗ | ✗ | ✗ |

Codebase signal layering:
- `color-pipeline-decisions.ts` / `color-primaries.ts` — server-side resolution.
- `histogram.tsx` — Promise-singleton canvas-P3 probe + AVIF probe.
- `wide-gamut-hint.tsx` — `useSyncExternalStore` MQ subscription.
- `globals.css` — `@media (color-gamut: p3)` for P3 chip · `@media (dynamic-range: high)` for HDR badge · `:root[data-force-show-color-chips="true"]` for admin override.

---

## CP-H1 — Apple gain map: Safari 18+ renders HDR; GalleryKit delivers SDR

(Cross-reference: forward-architecture FA-H1 / aggregate R4-H1.)

iPhone 14+ HDR HEIC → Safari 18+ on iPhone Pro / MacBook Pro M3 → renders HDR with extended luminance via gain map + base composite. iOS Photos.app, Apple Mail, iMessage all preserve.

GalleryKit delivers the SDR base only; the photographer's HDR work is silently dropped.

For the photographer whose audience is largely on Apple devices (the dominant audience for personal photo galleries), this is an audible quality regression vs. iCloud Shared Photo Library / Apple Photos sharing.

**Detect-only short-term** (FA-H1) — at least flag the gain map presence in admin audit.

---

## CP-H2 — Firefox `(color-gamut: p3)` MQ false-negative; `WideGamutHint` lies on Firefox + P3

(Cross-reference: aggregate R4-M1.)

`wide-gamut-hint.tsx:14-22` uses `window.matchMedia('(color-gamut: p3)')`. Firefox: false on every display.

Result on Firefox 124+ macOS internal P3:
- Wide-gamut photo loads with P3 AVIF → Firefox color-manages correctly via its non-MQ path → photo renders P3.
- `WideGamutHint` MQ probe: false → hint renders: "Your display shows the sRGB version of this photo. Additional saturation is available on supported displays."
- **The hint is a lie.** The visitor's display IS P3, the photo IS rendering with P3 saturation.

Same effect on Firefox + Windows + P3 monitor.

**Fix shape:** layered detection (FA-FORWARD-4):

```ts
function isP3Display(): boolean {
  // 1. screen.colorGamut API (Chromium 121+, Safari 18+ TP) — most reliable
  if ('screen' in window && 'colorGamut' in window.screen) {
    return window.screen.colorGamut === 'p3' || window.screen.colorGamut === 'rec2020';
  }
  // 2. matchMedia (Chrome/Safari/Edge — NOT Firefox)
  if (window.matchMedia?.('(color-gamut: p3)').matches) return true;
  // 3. canvas-P3 feature probe (Firefox 113+)
  return probeCanvasP3();
}
```

`WideGamutHint` consumes this. Firefox + P3 display: `isP3Display() === true` (via canvas-P3 fallback). Hint hidden.

---

## CP-M1 — Edge + Windows 11 Auto HDR mode interaction

When Auto HDR is enabled (Settings → System → Display → Use HDR):
- `(dynamic-range: high)` MQ returns `true`.
- `screen.colorGamut` returns `'p3'` or `'rec2020'`.
- HDR badge renders correctly.

When Auto HDR is OFF (default for laptops):
- `(dynamic-range: high)` returns `false`.
- HDR badge hidden.

This is correct behavior — the visitor's display is in SDR mode regardless of panel capability. The badge would mislead about the actual rendering.

**Edge case:** if WI-09 ships and emits `_hdr.avif`, the `<picture> <source media="(dynamic-range: high)">` will only fire when Auto HDR is on. Visitors with HDR-capable monitors but Auto HDR off will get the SDR fallback. That's correct.

**Documentation:** the README / admin panel should note that Edge users need Auto HDR ON to see the HDR variant. Not a code change.

---

## CP-M2 — Android Chrome P3 detection lag

Pixel 8 has a P3 panel. Chrome on Pixel 8 reports:
- `screen.colorGamut`: `'p3'` (Chrome 121+ Android).
- `(color-gamut: p3)` MQ: `true` on Android 14+; varied on Android 13- depending on ROM.
- `(dynamic-range: high)` MQ: `false` (Android Chrome doesn't support HDR rendering as of 2026-Q1).

Mid-range Android (Samsung A-series, Xiaomi Redmi):
- Panel: sRGB or DCI-P3 with sRGB color management.
- `screen.colorGamut`: `'srgb'` or `'p3'`.
- The browser color-manages but the panel saturation may clip.

**Photographer-intent impact:** Android users are a real audience for personal galleries. The current MQ-only `WideGamutHint` would fire on the modal Android Chrome user (panel: P3, MQ: varies). After FA-FORWARD-4, the layered detection handles this correctly.

---

## CP-M3 — Histogram canvas-P3 path on Safari mobile vs. desktop

`histogram.tsx` requests `canvas.getContext('2d', { colorSpace: 'display-p3' })`.

Safari mobile iOS 16+: ✓ supported.
Safari desktop macOS 14+: ✓ supported.
Chrome / Edge (all): ✓ supported (Chromium 90+).
Firefox 113+: ✓ supported.

The Promise-singleton probe (cycle 3 fix) caches the result correctly. Verified.

---

## CP-L1 — Touch-target audit doesn't explicitly exercise lightbox-color-pip

Touch-target audit `__tests__/touch-target-audit.test.ts` walks `SCAN_ROOTS = ['components/', 'app/[locale]/admin/']`. The `LightboxColorPip` is INLINE in `lightbox.tsx:78-150` — covered by the audit's component scan.

But: the audit looks for shadcn `<Button size="sm">` without h-11/h-12 override and raw `<button>` with h-8/h-9 literals. The LightboxColorPip uses raw `<button>` with `px-3 py-1.5 text-xs` — let me verify it clears 44 px touch target.

Spec check:
- `px-3` = 12 px horizontal padding.
- `py-1.5` = 6 px vertical padding.
- `text-xs` = 12 px line-height ≈ 16-18 px.
- Total height: ~30 px. **Below the 44 px floor.**

But the audit may not flag it because:
- It's a `<button>` (not a shadcn `<Button>` size="sm"/icon").
- No `h-8`/`h-9` literal.
- The audit catches `<button>` only via specific `h-N` patterns, not arbitrary px sizing.

This is a gap. **R4 latent finding** — promote to medium-priority. The lightbox color pip is a primary affordance (tap to expand the panel) and needs to clear 44 px.

(Cross-reference: latent-and-ux-residuals UX-L2.)

---

## Severity-rated summary (cross-platform-color track)

| ID | Severity | Effort |
|---|---|---|
| CP-H1 (Apple gain map silent strip) | HIGH | (= FA-H1) |
| CP-H2 (Firefox MQ + WideGamutHint lie) | MED | (= R4-M1 / FA-FORWARD-4) |
| CP-M1 (Edge Auto HDR documentation) | LOW | XS docs |
| CP-M2 (Android Chrome P3 detection lag) | MED | (resolved by FA-FORWARD-4) |
| CP-M3 (histogram canvas-P3 — verified correct) | DOC | none |
| CP-L1 (touch-target audit + LightboxColorPip) | MED | XS — extend audit fixture or bump to h-11 |

---

## Recommended fixes

1. CP-H1 → R4-H1 / FA-H1 (gain map detection).
2. CP-H2 + CP-M2 → R4-M1 / FA-FORWARD-4 (`useDisplayCapability` hook).
3. CP-L1 → bump LightboxColorPip pip height to `min-h-11` and verify expanded panel buttons clear 44 px floor.
4. CP-M1 → add an admin/docs note about Edge Auto HDR.

---

## Out of scope

- HDR10+ / Dolby Vision dynamic metadata.
- Tizen / WebOS TV browsers.
- Wii U / 3DS browsers.
- Pre-Safari-15 / pre-Chrome-90 / pre-Firefox-100 legacy browsers.
- Native app / WebView subsets (use the OS's color management).
