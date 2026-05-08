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

/**
 * C6-A1 / C6-COL-MED-1 / C6-UX-MED-1 (cross-angle 2-way agreement,
 * color-fidelity + ui-ux): predicate for the gamut-aware download-button
 * label. Returns true when the resolved color pipeline decision indicates
 * a P3-mapped delivery (Display P3 JPEG + AVIF), as opposed to an sRGB
 * delivery.
 *
 * The label "Download (Display P3 JPEG)" / "Download JPEG" appears on
 * three surfaces:
 *   - desktop sidebar — `components/photo-viewer.tsx`
 *   - mobile bottom sheet primary path — `components/info-bottom-sheet.tsx`
 *   - mobile bottom sheet alternative path — `components/info-bottom-sheet.tsx`
 *
 * Pre-cycle-6 each surface inlined `decision?.startsWith('p3-from-')`. A
 * future enum addition (e.g. `'p3-from-bt2100hlg'` once WI-09 ships) would
 * have required updating all three sites; missing one would silently
 * downgrade the photographer-facing label on either desktop or mobile,
 * causing per-surface inconsistency for the same photo. Consolidating the
 * predicate here makes a future enum addition automatically pick up all
 * three sites (any value matching `p3-from-*` is treated as P3 delivery).
 *
 * Locked by `__tests__/is-p3-pipeline.test.ts` walking
 * `COLOR_PIPELINE_DECISIONS` and asserting the boolean for every enum
 * value, plus a source-inspection lock that the consumer files import
 * the helper rather than re-inlining the literal.
 */
export function isP3Pipeline(
    decision: ColorPipelineDecision | string | null | undefined,
): boolean {
    if (!decision) return false;
    return decision.startsWith('p3-from-');
}
