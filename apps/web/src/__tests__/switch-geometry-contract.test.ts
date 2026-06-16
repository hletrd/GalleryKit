/**
 * AGG-C4-02 (run-6 cycle-4, TE-C4-02 / TRC-C4-03) — Switch thumb-travel geometry
 * regression pin.
 *
 * The cycle-3 fix for the "half-on switch" defect (AGG-C3-01, commit a3b8c557)
 * rests on a SILENT Tailwind arithmetic coincidence in
 * `components/ui/switch.tsx`:
 *
 *   visible track  w-11 (44px) + px-0.5 (→ 40px inner content box)
 *   thumb          size-5 (20px)
 *   travel         translate-x-full  ( = 100% of the thumb's OWN 20px width )
 *   remaining gap  40 − 20 = 20px  ===  translate-x-full   → flush edge-to-edge
 *
 * Because `translate-x-full` is relative to the THUMB's width (not the track),
 * the three numbers must co-vary. A future edit that bumps the thumb to size-6,
 * changes the track padding, or swaps the travel class silently re-introduces the
 * half-on defect: the touch-target audit only checks the ≥44px hit-zone (stays
 * green) and the unit suite otherwise has nothing pinning the VISIBLE geometry.
 *
 * This static source-scan (same idiom as touch-target-audit.test.ts and
 * sw-template-contract.test.ts) pins the load-bearing triple so a geometry
 * regression is a RED test rather than a visual surprise. If you legitimately
 * change the switch geometry, update ALL THREE of: the visible-track inner width
 * (w-11 + px-0.5), the thumb size (size-5), and the travel class
 * (translate-x-full / translate-x-0) together so the arithmetic still lands the
 * thumb flush at both ends — then update this test to match.
 *
 * Proven NON-VACUOUS: flipping the thumb to `size-6`, the travel to
 * `translate-x-5`, or dropping `px-0.5` from the track each flips an assertion RED.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const switchSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'components', 'ui', 'switch.tsx'),
    'utf8',
);

// Normalize whitespace so multi-line className composites (cn(...)) match
// regardless of Prettier line wrapping.
const normalized = switchSrc.replace(/\s+/g, ' ');

describe('Switch geometry contract (AGG-C4-02)', () => {
    it('keeps the 44px tappable hit-zone on Root (belt-and-braces with the touch-target audit)', () => {
        // Root MUST retain min-h-11 / min-w-11 — the touch-target audit also
        // enforces this, but pinning it here ties the hit-zone to the visible
        // geometry contract so both move together in review.
        expect(normalized).toMatch(/min-h-11/);
        expect(normalized).toMatch(/min-w-11/);
    });

    it('renders the visible track as a w-11 pill with px-0.5 (→ 40px inner box)', () => {
        // The visible track width + horizontal padding define the 40px inner box
        // the thumb travels across. w-11 = 44px, px-0.5 = 2px each side → 40px.
        const trackMatch = normalized.match(
            /data-slot="switch-track"[\s\S]*?className=\{cn\(([\s\S]*?)\)\}/,
        );
        expect(trackMatch, 'switch-track className block must exist').not.toBeNull();
        const trackClasses = trackMatch![1];
        expect(trackClasses).toMatch(/\bw-11\b/);
        expect(trackClasses).toMatch(/\bpx-0\.5\b/);
        // The visible pill must be a normally-proportioned height (h-6), not the
        // 44px Root box — a regression to h-11 here would make the pill itself
        // 44px tall and undo the "normally-proportioned pill" fix.
        expect(trackClasses).toMatch(/\bh-6\b/);
    });

    it('keeps the thumb at size-5 (20px) so translate-x-full = the exact remaining travel', () => {
        const thumbMatch = normalized.match(
            /data-slot="switch-thumb"[\s\S]*?className=\{cn\(([\s\S]*?)\)\}/,
        );
        expect(thumbMatch, 'switch-thumb className block must exist').not.toBeNull();
        const thumbClasses = thumbMatch![1];
        // size-5 = 20px. 40px inner − 20px thumb = 20px remaining = 100% of the
        // thumb's own width = translate-x-full. If the thumb grows to size-6 the
        // remaining travel shrinks to 16px but translate-x-full would push 24px,
        // overshooting — OR under-traveling the other way for a smaller thumb.
        expect(thumbClasses).toMatch(/\bsize-5\b/);
    });

    it('pins the thumb travel to translate-x-0 (unchecked) and translate-x-full (checked)', () => {
        const thumbMatch = normalized.match(
            /data-slot="switch-thumb"[\s\S]*?className=\{cn\(([\s\S]*?)\)\}/,
        );
        expect(thumbMatch).not.toBeNull();
        const thumbClasses = thumbMatch![1];
        expect(thumbClasses).toMatch(/\btranslate-x-0\b/);
        // The checked-state travel — this is THE class the cycle-3 fix corrected
        // from the half-on translate-x-5. Width-relative translate-x-full is the
        // only value that lands flush given the size-5/40px-inner arithmetic.
        expect(thumbClasses).toMatch(/data-\[state=checked\]:translate-x-full/);
        // Guard against the regression that caused AGG-C3-01: a fixed translate-x-5
        // (20px absolute) only works by accident at one specific track width and is
        // the exact pattern that read as "half-on" after the 44px retrofit.
        expect(thumbClasses).not.toMatch(/data-\[state=checked\]:translate-x-5\b/);
    });
});
