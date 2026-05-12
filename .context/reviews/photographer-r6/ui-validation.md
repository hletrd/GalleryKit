# R6 UI Validation Review

**Angle:** Runtime type safety and cache consistency in photographer-facing UI
**Files reviewed:** `apps/web/src/components/lightbox-color-pip.tsx`, `apps/web/src/components/histogram.tsx`

---

## R6-M3 [MED] — Unsafe type cast in lightbox-color-pip

### Evidence

In `lightbox-color-pip.tsx` (line ~40):

```ts
const pipelineLabel = humanizeColorPipelineDecision(
    image.color_pipeline_decision as ColorPipelineDecision | null | undefined,
    t,
);
```

`image.color_pipeline_decision` is a raw `varchar` from the database. The `as` cast tells TypeScript to trust the value without runtime validation. The `ColorPipelineDecision` type is defined in `color-pipeline-decisions.ts`:

```ts
export const COLOR_PIPELINE_DECISIONS = [
    'srgb',
    'p3-from-displayp3',
    'p3-from-dcip3',
    'p3-from-adobergb',
    'p3-from-prophoto',
    'p3-from-rec2020',
    'srgb-from-unknown',
] as const;
export type ColorPipelineDecision = typeof COLOR_PIPELINE_DECISIONS[number];
```

If the DB contains an unexpected value (malformed migration, manual edit, future schema drift), `humanizeColorPipelineDecision` will hit the `default` case and return `'Unknown'`. But the `as` cast is a lie — downstream code that trusts the type could break. More critically, if a future refactor adds exhaustive handling (e.g., `satisfies` or a stricter switch), the cast becomes a runtime crash.

### Impact

Low probability (schema is well controlled), but the blast radius is a UI crash in the lightbox color panel — the most photographer-visible surface for pipeline decisions.

### Fix

Replace the `as` cast with a runtime guard using `COLOR_PIPELINE_DECISIONS.includes()`:

```ts
import { COLOR_PIPELINE_DECISIONS, type ColorPipelineDecision } from '@/lib/color-pipeline-decisions';

const decision: ColorPipelineDecision | null | undefined =
    image.color_pipeline_decision &&
    COLOR_PIPELINE_DECISIONS.includes(image.color_pipeline_decision as typeof COLOR_PIPELINE_DECISIONS[number])
        ? (image.color_pipeline_decision as ColorPipelineDecision)
        : undefined;

const pipelineLabel = humanizeColorPipelineDecision(decision, t);
```

This pattern is already used elsewhere in the codebase (e.g., `color-detection.ts` validates NCLX codes against maps before assignment).

---

## R6-L3 [LOW] — Hardcoded histogram worker cache-buster

### Evidence

In `histogram.tsx` (line ~418):

```ts
const workerRef = useRef<Worker | null>(null);
// ...
workerRef.current = new Worker('/histogram-worker.js?v=1');
```

The `?v=1` is a hardcoded query parameter. When `histogram-worker.js` is updated (e.g., new luminance coefficients, new message format, new clip-blink threshold), returning visitors whose browsers cached the old worker will continue running stale code.

This is particularly problematic because:
1. The worker is loaded lazily (first histogram open), so the cache can be very old.
2. The worker runs off-origin (same-origin, but cached separately from the main bundle).
3. There's no Service Worker or cache-busting strategy for this file.

### Impact

Returning visitors may see histogram behavior that doesn't match the current code. For example, if the worker's luminance formula is corrected from BT.709 to P3 coefficients, old cached workers still use BT.709. The photographer sees inconsistent histograms across browsers/sessions.

### Fix

Options (in order of preference):

1. **Build-time hash (best):** Inject a content hash at build time. Next.js can handle this via `public/` file hashing or by moving the worker to `src/` and using `new Worker(new URL('./histogram-worker.ts', import.meta.url))` with webpack/vite worker bundling.

2. **Pipeline version tie (simplest):** Use `IMAGE_PIPELINE_VERSION`:
   ```ts
   new Worker(`/histogram-worker.js?v=${IMAGE_PIPELINE_VERSION}`)
   ```
   This invalidates the worker whenever the pipeline version bumps (which happens on any significant encoder change).

3. **Timestamp (quick):** Append a build timestamp via `process.env.BUILD_TIME` or similar.

Option 2 is the lightest-weight fix that preserves the existing architecture. Option 1 is architecturally cleaner but requires build-system changes.

---

## Photographer Impact Summary

| Scenario | Before fix | After fix |
|----------|-----------|-----------|
| Corrupted DB pipeline decision | Lightbox may crash or show wrong label | Gracefully falls back to "Unknown" |
| Deploy updates histogram worker | Returning visitors run stale worker | Worker cache busts on pipeline version bump |
| Normal usage | Correct | Unchanged |
