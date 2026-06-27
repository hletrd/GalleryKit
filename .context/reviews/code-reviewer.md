# Code Review — Cycle 19 (GalleryKit)

**Files reviewed:** nav-client.tsx, wide-gamut-hint.tsx, lightbox-color-pip.tsx, settings-hash.ts, image-queue.ts, bounded-map.ts, og-photo-fetch.ts, actions/images.ts, actions/topics.ts, admin-backfill-runner.ts, photo-viewer.tsx (sweep), data.ts + process-image.ts (targeted).

CRITICAL: 0 · HIGH: 0 · MEDIUM: 2 · LOW: 2 · Recommendation: COMMENT.

## MEDIUM

### CQ19-01 — Sequential await with 10s timeout per size in OG fetch → 60s worst-case (HIGH conf)
`apps/web/src/lib/og-photo-fetch.ts:87-91`. `pickFirstAvailablePhotoBuffer` iterates up to 6 sizes sequentially, each `tryFetchPhotoBuffer` gated by `AbortSignal.timeout(10000)` (line 53). Worst case 6×10=60s before falling back to default OG image. On a fresh install (backfill not run) or broken `IMAGE_BASE_URL`, every size 404s/times out; social crawlers (Twitter ~5-10s, LinkedIn ~3s) drop the photo card silently. Warm path (640px present) is instant — issue is cold/broken path only. Fix: limit retry to the two smallest sizes, or add an aggregate outer `AbortSignal.timeout`, or treat a 404 on the smallest size as definitive (derivatives share one encoder run).

### CQ19-02 — BoundedMap.entries() yields live internal refs while get() shallow-copies (MED conf)
`apps/web/src/lib/bounded-map.ts:~138`. `get()` returns `{ ...value }`; `entries()`/`[Symbol.iterator]` delegate to the internal Map returning live refs. A caller mutating a value from `entries()` corrupts internal eviction state (`resetAt`/`windowStart`/`count`). No current mutating caller in rate-limit.ts/auth-rate-limit.ts — latent. A WARNING comment exists but is not in the public TS interface. Fix: yield `[key, { ...value }]`, or rename `_entriesUnsafe()`.

## LOW

### CQ19-03 — copyColorMetadata not useCallback (HIGH conf)
`apps/web/src/components/lightbox-color-pip.tsx:88`. Bare async fn in render body passed as DOM `onClick` (line 299). No re-render cost (DOM element), but inconsistent with memoized siblings. Fix: wrap in `useCallback`.

### CQ19-04 — Cross-sibling import of humanizeColorPrimariesOrLabel (MED conf)
`apps/web/src/components/wide-gamut-hint.tsx:7` imports `humanizeColorPrimariesOrLabel` from `@/components/color-details-section` (peer-component, not lib). Pure presentation logic; refactor of color-details-section would silently break it and force-bundle the full component. Fix: extract to `apps/web/src/lib/color-label.ts`, import in both.

## Positive
admin-backfill-runner connection lifecycle exemplary; images.ts quota claim settled on every error path; image-queue bootstrap pagination branches correct; settings-hash inflight singleton correct; photo-viewer memoizes derived values + imageLoaded reset defense; no hardcoded secrets / empty catches / `as any` / `@ts-ignore`.

## Findings
- CQ19-01 | MEDIUM | HIGH | og-photo-fetch.ts:87-91 — sequential 6×10s = 60s worst-case OG latency
- CQ19-02 | MEDIUM | MED | bounded-map.ts:~138 — entries() live refs vs get() copy asymmetry
- CQ19-03 | LOW | HIGH | lightbox-color-pip.tsx:88 — copyColorMetadata not useCallback
- CQ19-04 | LOW | MED | wide-gamut-hint.tsx:7 — cross-sibling import should live in lib/
