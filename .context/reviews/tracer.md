# Tracer — Cycle 5/100 RPF loop (HEAD `be53b44`, 2026-04-26)

## Trace

`blur_data_url` end-to-end:

1. `lib/process-image.ts:281-305` — Sharp resize(16) + blur(2) + jpeg(q40) -> buffer -> base64 -> `data:image/jpeg;base64,...` -> `assertBlurDataUrl()` -> returns string|null.
2. `app/actions/images.ts:307` — `assertBlurDataUrl(data.blurDataUrl)` -> INSERT into `images.blur_data_url`.
3. `lib/data.ts:498, :668` — included in `getImage()`-class queries (NOT in `getImagesLite` listings — performance carve-out documented at `:206-215`).
4. `components/photo-viewer.tsx:104-112` — `isSafeBlurDataUrl(value)` -> memoized `backgroundImage: url(...)` style.

Validator trips at every boundary. No unguarded path discovered.

## Findings

**No new findings.**

## Confidence

High.
