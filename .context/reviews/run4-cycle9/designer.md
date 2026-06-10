# Designer angle — Run-4 Cycle 9

Scope note: this cycle's rotation is dominated by binary/SW/server
surfaces; the designer pass focused on the user-visible consequences
of those surfaces (home-page weight, offline behavior, OnThisDay
freshness) plus a check of the new fallback render paths from R4C8.
A live-browser pass was run in earlier cycles against the same
unchanged surfaces (run2 ui-ux-artifacts, c6 interaction cycle); no
interactive regression surface changed this cycle beyond what the
contract tests pin, and PROMPT 3 runs the full Playwright e2e gate
(including nav-visual-check) against the built app.

## DES-R4C9-A (= PERF-R4C9-03) — home page ships multi-MB thumbnails

Up to 6 full-resolution JPEGs lazy-load for 48×48 OnThisDay tiles.
On a mid-range phone over LTE, scrolling to the footer can queue
~15-30 MB — perceptible jank, battery, and data cost on the product's
landing page; LCP unaffected (below-fold, lazy) but INP can suffer
from decode bursts of 4096-px JPEGs into 48-px boxes. Severity
MED-LOW / High. Fix via OptimisticImage island (smallest size +
base-JPEG fallbackSrc) — keeps the loading spinner & error states the
component already provides, no new UX surface.

## DES-R4C9-B — OnThisDay "today" is the SERVER's calendar day

`on-this-day-widget.tsx:14-16` uses `new Date()` in a server
component: the widget's MM-DD flips at midnight in the server/container
TZ (UTC in the shipped compose), not the visitor's. A KST visitor sees
yesterday's anniversaries until 09:00 local. Severity LOW / Medium —
inherent to SSR without a TZ signal; correct fixes are a deliberate
product decision (admin "gallery time zone" setting, or a client
island date). Recommend: record as deferred with a concrete exit
criterion (galleries owner reports a wrong-day anniversary, or a
gallery-timezone admin setting lands for any other reason). Not
silently dropped.

## Fallback-render UX (R4C8 regression check) — OK

- The `sizedSourcesFailed` fallback `<img>` keeps `object-contain`
  sizing, alt text, and the blur-placeholder dismissal (`onLoad` →
  setImageLoaded) so the crossfade still resolves — no flash of
  unstyled/broken state during the swap.
- Lightbox fallback keeps width/height attributes (no CLS on swap).
- Histogram redraw-on-breakpoint fix removes the blank-canvas state
  when rotating a tablet across 768 px — verified the dep change
  covers both grow and shrink directions (canvasDims state is the
  attribute source in both).

## Standing LOW observations (carried, unchanged)

The four cycle-8 deferred designer items (paid-download error bodies,
interstitial double-submit 410, ImageZoom passive-listener noise,
Tailwind columns-N comment safelist) were re-checked: no exit
criterion triggered this cycle; they remain in the plan-288 ledger.
