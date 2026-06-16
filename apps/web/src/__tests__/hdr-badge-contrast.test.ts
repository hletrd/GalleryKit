/**
 * AGG-C6-01 (DES-C6-M1): lock the HDR-badge text color against the
 * `from-amber-300 to-orange-400` gradient so it cannot silently regress to a
 * WCAG-failing combination again.
 *
 * The badge previously rendered `text-white` on this amber→orange gradient.
 * WCAG-luminance contrast (sRGB, Tailwind v3 sRGB gradient interpolation):
 *   - white / amber-300 (light stop): 1.44:1  (FAIL — AA needs 4.5:1 for the
 *     10–12 px bold glyph, which is not "large text")
 *   - white / orange-400 (right stop): 2.26:1 (FAIL)
 *   - amber-900 / orange-400 (worst stop): 4.01:1 (STILL FAIL — do not use)
 *   - amber-950 / orange-400 (worst stop): 6.62:1 (PASS)
 *   - amber-950 / amber-300: 10.39:1 (PASS)
 * The fix is `text-amber-950`, which passes at the worst gradient stop.
 *
 * This blind spot survived 5+ review cycles because no prior pass ran the
 * contrast calculator on a *gradient* background. The fixture asserts, for
 * every component that renders the gradient badge, that the badge span does
 * NOT pair the amber→orange gradient with `text-white` (negative pin) and DOES
 * use `text-amber-950` (positive pin).
 *
 * Project convention: source-inspection fixtures over React Testing Library —
 * same pattern as `color-details-section-delivered.test.ts`,
 * `images-action-blur-wiring.test.ts`, and `process-image-blur-wiring.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GRADIENT = 'from-amber-300 to-orange-400';

const SITES: ReadonlyArray<{ file: string; label: string }> = [
    { file: '../components/color-details-section.tsx', label: 'ColorDetailsSection' },
    { file: '../components/lightbox-color-pip.tsx', label: 'LightboxColorPip' },
    { file: '../components/info-bottom-sheet.tsx', label: 'InfoBottomSheet' },
    { file: '../components/image-manager.tsx', label: 'ImageManager' },
];

/**
 * Returns every `class`/`className` string literal in the source that contains
 * the amber→orange HDR-badge gradient. There is at most one HDR badge per file,
 * but the matcher is written to catch all occurrences so an added badge is also
 * covered.
 */
function gradientBadgeClassStrings(source: string): string[] {
    const out: string[] = [];
    // Match the className="..." (or class="...") attribute value as a whole so
    // we can inspect the full utility list that styles the badge.
    const attrRe = /className\s*=\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(source)) !== null) {
        const classes = m[1];
        if (classes.includes(GRADIENT)) out.push(classes);
    }
    return out;
}

describe('HDR badge contrast (AGG-C6-01)', () => {
    for (const { file, label } of SITES) {
        describe(label, () => {
            const source = readFileSync(resolve(__dirname, file), 'utf8');

            it('renders an HDR badge on the amber→orange gradient', () => {
                // Non-vacuity: if a refactor removes/renames the gradient badge,
                // this fixture must be revisited rather than silently passing.
                expect(source).toContain(GRADIENT);
                expect(gradientBadgeClassStrings(source).length).toBeGreaterThan(0);
            });

            it('does NOT pair the gradient with text-white (WCAG 1.4.3 AA failure)', () => {
                for (const classes of gradientBadgeClassStrings(source)) {
                    expect(classes).not.toMatch(/\btext-white\b/);
                }
            });

            it('uses text-amber-950 on the gradient badge (passes worst-stop 6.62:1)', () => {
                for (const classes of gradientBadgeClassStrings(source)) {
                    expect(classes).toMatch(/\btext-amber-950\b/);
                    // amber-900 fails the orange-400 stop (4.01:1) — explicitly forbid it.
                    expect(classes).not.toMatch(/\btext-amber-900\b/);
                }
            });
        });
    }
});
