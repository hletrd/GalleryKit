# Perf Reviewer — Cycle 10 (review-plan-fix loop, 2026-04-25)

## Lens

Hot-path latency, memory, allocation, DB round-trips, queue throughput.

**HEAD:** `24c0df1`
**Cycle:** 10/100

## Scope

One commit since cycle 9 baseline. Pure perf positive: suppress JSON-LD
bytes (`websiteLd` ~140 bytes + `galleryLd` up to ~3 KB gzip) on
filtered tag views which are noindex anyway.

## Findings

**Zero new MEDIUM or HIGH perf findings.**

### LOW informational

- **P10-POSITIVE-01** — On filtered tag-list views, two `<script
  type="application/ld+json">` tags (and their `safeJsonLd` escape
  passes) are now skipped. Modest savings per request, meaningful at
  crawler-traffic scale.
- **P10-INFO-01** — `galleryLd` is still computed on the filtered
  branch before being gated by `shouldEmitJsonLd && galleryLd`. A
  micro-opt would short-circuit the `images.slice(0, 10).map(...)`
  allocation, but the array is small (≤10) and JIT inlines the
  closure cheaply. Not worth the readability hit.

## Confidence

High.

## Recommendation

No perf action this cycle.
