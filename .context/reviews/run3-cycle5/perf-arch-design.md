# Run-3 Cycle 5 — Perf + Architecture + Design angle (perf-reviewer, architect, designer, tracer)

## Performance
- serve-upload HEAD short-circuit (R20-L1) avoids stream allocation; 304 path avoids body.
- download route parallelizes the two realpath calls (C4-RPF-06).
- image-queue: single Sharp clone, parallel AVIF/WebP/JPEG, bounded retry/failed maps,
  cursor-based bootstrap batching (500), gc interval unref'd. No N+1 or unbounded growth.
- public actions: DB rate-limit round-trip is ~1ms and gated behind cheap in-memory pre-check.
- feed: single getImagesForFeed(50) query, no per-entry DB hits.
No perf regression or hotspot found.

## Architecture
- Single-writer topology assumptions documented and respected (process-local queue/rate-limit
  state with DB backup for login + view counts). Advisory locks server-scoped (documented).
- Privacy enforcement is layered: separate select objects + compile-time guards + runtime
  query-level map_visible filter for the only lat/long-exposing path.
- Storage abstraction (@/lib/storage) correctly NOT exposed as supported feature (per CLAUDE.md).
No architectural drift.

## Design / UI-UX (static analysis — no live browser this cycle; codebase is server-render
## heavy and the interactive surfaces were covered in photographer-r3..r29 rounds)
- Share group grid: above-fold eager/high-priority for first 4 images, aspect-ratio +
  containIntrinsicSize to prevent CLS, base-JPEG `<picture>` fallback (R20-M1) so legacy/
  mid-backfill rows don't render broken tiles, focus-visible ring on links, mobile + desktop
  caption overlays. Sound responsive/LCP posture.
- Color chips / WideGamutHint gating on useDisplayCapability (not raw matchMedia) — Firefox
  conservative-srgb behavior documented (R10-H4). force_show_color_chips admin escape hatch.
- Touch-target 44px floor enforced by blocking unit test.
No net-new design finding. (Photographer-perspective UI surface is the most-reviewed area
of the repo — 29 rounds — and is not the under-reviewed target of this cycle.)

## Findings
NONE.

## HARD-SCOPE check
No PROMPT-1 finding proposed edit/culling/scoring/preset/curve features. Nothing to drop.
