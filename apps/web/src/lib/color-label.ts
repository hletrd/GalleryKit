/**
 * color-label.ts — pure, framework-agnostic color-primaries label helpers.
 *
 * R19C19 CQ19-04: these two helpers previously lived in the
 * `color-details-section.tsx` CLIENT COMPONENT and were imported cross-sibling
 * by `wide-gamut-hint.tsx` (which needs ONLY the label string, not the
 * accordion component). That peer-component import force-bundled the whole
 * `ColorDetailsSection` into any chunk including `WideGamutHint` and would
 * break silently if the component were split. They are pure functions (no
 * React/DOM), so they belong in `lib/`. `color-details-section.tsx` re-exports
 * them for backward compatibility with its other consumers.
 *
 * Convention (cycle-3 RPF C3-D2): primaries names stay un-translated — the
 * Latinate technical names (BT.709, Display P3, DCI-P3, Rec. 2020, Adobe RGB,
 * ProPhoto RGB) are universally recognizable across locales and match camera
 * vendor docs + the browser CSS spec.
 */

export function humanizeColorPrimaries(value: string | null | undefined): string | null {
    switch (value) {
        case 'bt709': return 'BT.709';
        case 'p3-d65': return 'Display P3';
        case 'dci-p3': return 'DCI-P3';
        case 'bt2020': return 'Rec. 2020';
        case 'adobergb': return 'Adobe RGB';
        case 'prophoto': return 'ProPhoto RGB';
        default: return null;
    }
}

/**
 * R15-L1 / R12-L4: never-null variant for UI surfaces that always need a string
 * to render. Returns the localized `viewer.colorUnknown` literal on any
 * unrecognized value. Callers that want the discriminated branch (e.g. gate the
 * wide-gamut hint on null) keep using `humanizeColorPrimaries`.
 */
export function humanizeColorPrimariesOrLabel(
    value: string | null | undefined,
    t: (key: string) => string,
): string {
    return humanizeColorPrimaries(value) || t('viewer.colorUnknown');
}
