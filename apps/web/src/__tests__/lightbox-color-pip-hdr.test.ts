/**
 * C5-A2 / C5-COL-LOW-1 / C5-COL-MED-1: lock the lightbox color pip HDR
 * gating + single-render contract in `lightbox.tsx`. Source-inspection
 * fixture (project convention — same pattern as
 * `color-details-section-delivered.test.ts`) over the `LightboxColorPip`
 * function inside `lightbox.tsx`.
 *
 * Locks two cross-cycle invariants:
 * 1. HDR badge is gated on `transfer_function === 'pq' || 'hlg'` rather
 *    than `image.is_hdr` — harmonized with the sidebar accordion gate
 *    (`color-details-section.tsx:88`) in cycle-4 commit `d093cd23`
 *    (C4-A3).
 * 2. The HDR badge renders exactly ONCE inside `LightboxColorPip` —
 *    inside the closed-pip chip button. The expanded panel must NOT
 *    contain a duplicate "label / value" row that re-renders the same
 *    HDR pill (cycle-5 commit C5-A1).
 *
 * Without these locks, a future refactor could regress to either the
 * pre-cycle-4 `is_hdr` gate (which would still work today thanks to the
 * schema invariant `is_hdr === transfer_function in ('pq', 'hlg')`, but
 * would silently misbehave when HDR10+ / Dolby Vision transfer values
 * are added to the schema), or the pre-cycle-5 doubled HDR row.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_PATH = resolve(__dirname, '../components/lightbox.tsx');
const SOURCE = readFileSync(SRC_PATH, 'utf8');

/**
 * Extract the body of `function LightboxColorPip(...) { ... }` so the
 * assertions only inspect the pip and not unrelated parts of `lightbox.tsx`
 * (e.g. an unrelated future re-introduction of `image.is_hdr` in the
 * outer Lightbox component would not falsely fail this test).
 */
function getLightboxColorPipBody(source: string): string {
    const startMarker = 'function LightboxColorPip';
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) {
        throw new Error('LightboxColorPip declaration not found in lightbox.tsx');
    }
    // Skip past the `(...)` parameter list (which itself contains a
    // destructure pattern with `{...}` braces) before searching for the
    // body's `{`. Balance parens to locate the parameter-list close.
    const openParenIdx = source.indexOf('(', startIdx);
    if (openParenIdx === -1) {
        throw new Error('LightboxColorPip parameter-list open-paren not found');
    }
    let parenDepth = 0;
    let bodyOpenIdx = -1;
    for (let i = openParenIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        else if (ch === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                // After the close-paren we may have a `: ReturnType` annotation
                // before the body's `{`. Search forward for the next `{`.
                bodyOpenIdx = source.indexOf('{', i);
                break;
            }
        }
    }
    if (bodyOpenIdx === -1) {
        throw new Error('LightboxColorPip body open-brace not found after parameter list');
    }
    // Now balance braces from the body open to find its close.
    let depth = 0;
    for (let i = bodyOpenIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(bodyOpenIdx, i + 1);
            }
        }
    }
    throw new Error('LightboxColorPip body close-brace not found');
}

const PIP_BODY = getLightboxColorPipBody(SOURCE);

describe('LightboxColorPip — HDR gating + single-render (C5-A2)', () => {
    describe('HDR gate is transfer_function-driven (C4-A3 harmonization lock)', () => {
        it('uses image.transfer_function pq/hlg comparison', () => {
            // The cycle-4 C4-A3 commit harmonized the gate. Locking
            // against drift back to `image.is_hdr`.
            expect(PIP_BODY).toMatch(
                /image\.transfer_function\s*===\s*'pq'\s*\|\|\s*image\.transfer_function\s*===\s*'hlg'/,
            );
        });

        it('does NOT gate the HDR badge on image.is_hdr inside the pip', () => {
            // Search for `image.is_hdr` inside the pip body. Allowed if
            // future code uses it for non-HDR-badge purposes (none today),
            // so we only fail if it appears as a gate condition.
            // The pre-C4-A3 code shape was `if (image.is_hdr)`.
            const hasIsHdrGate =
                /\bimage\.is_hdr\b/.test(PIP_BODY) &&
                !/\/\/[^\n]*is_hdr/.test(PIP_BODY);
            expect(hasIsHdrGate).toBe(false);
        });
    });

    describe('HDR badge renders exactly once (C5-A1 single-render lock)', () => {
        it('contains exactly one `hdr-badge` className occurrence', () => {
            // Cycle-4 had two: one in the chip, one in the expanded panel.
            // Cycle-5 dropped the panel one. Lock the count at exactly 1.
            const matches = PIP_BODY.match(/hdr-badge/g) ?? [];
            expect(matches.length).toBe(1);
        });

        it('contains exactly one `viewer.hdrBadgeAriaLabel` occurrence', () => {
            // The aria-label was duplicated alongside the badge. Both
            // copies should be gone except the chip-side one.
            const matches = PIP_BODY.match(/viewer\.hdrBadgeAriaLabel/g) ?? [];
            expect(matches.length).toBe(1);
        });

        it('does NOT contain a panel-internal HDR label/value row', () => {
            // The cycle-4 pre-C5-A1 panel rendered a label/value row:
            //   <span className="opacity-70">{t('viewer.hdrBadge')}</span>
            //   <span className="hdr-badge ...">HDR</span>
            // Search for `viewer.hdrBadge` (without the AriaLabel suffix)
            // followed shortly by a `hdr-badge` className. If present, the
            // panel-internal row has crept back in.
            const panelRowPattern = /t\('viewer\.hdrBadge'\)[\s\S]{0,400}hdr-badge/;
            // The chip-side instance does NOT contain `t('viewer.hdrBadge')`
            // followed by another `hdr-badge` className inside 400 chars,
            // because the chip uses `aria-label={t('viewer.hdrBadgeAriaLabel')}`
            // (different key). Therefore this regex matching means the
            // panel row has returned.
            expect(panelRowPattern.test(PIP_BODY)).toBe(false);
        });
    });

    describe('hasData short-circuit (existing pip contract)', () => {
        it('returns null when no color signals are present', () => {
            // Lock the early return so a refactor cannot silently render
            // an empty pip on photos with no color metadata.
            expect(PIP_BODY).toMatch(
                /const\s+hasData\s*=\s*Boolean\s*\(\s*image\.color_primaries\s*\|\|\s*image\.transfer_function\s*\|\|\s*image\.color_pipeline_decision\s*\)/,
            );
            expect(PIP_BODY).toMatch(/if\s*\(\s*!hasData\s*\)\s*return\s+null/);
        });
    });
});
