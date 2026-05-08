/**
 * C5-A3 / C5-COL-MED-2: canonical source-of-truth for `color_pipeline_decision`
 * enum values. Stored in `images.color_pipeline_decision` and surfaced in the
 * Color Details accordion via `humanizeColorPipelineDecision`.
 *
 * Imported from:
 *   - `lib/process-image.ts` — server-side resolver (`resolveColorPipelineDecision`).
 *   - `__tests__/color-pipeline-decision-i18n.test.ts` — i18n smoke test
 *     that walks every enum value and asserts en + ko translations exist.
 *
 * The cycle-4 i18n test (C4-A7) inlined the enum literals locally, so a
 * future contributor adding a new decision value to `process-image.ts`
 * without updating both `messages/en.json` + `messages/ko.json` would NOT
 * be caught by the test (the inline list would not include the new value).
 *
 * Co-locating the canonical list here, with `process-image.ts` and the test
 * both importing it, makes the test exhaustively track the source of truth.
 *
 * This module deliberately has no Sharp / fs / process-image dependencies
 * so it is safe to import from client modules as well as server modules.
 */
export const COLOR_PIPELINE_DECISIONS = [
    'srgb',
    'srgb-from-unknown',
    'p3-from-displayp3',
    'p3-from-dcip3',
    'p3-from-adobergb',
    'p3-from-prophoto',
    'p3-from-rec2020',
] as const;

export type ColorPipelineDecision = typeof COLOR_PIPELINE_DECISIONS[number];
