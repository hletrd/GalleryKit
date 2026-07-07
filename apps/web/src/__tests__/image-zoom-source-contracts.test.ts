import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '..', 'components', 'image-zoom.tsx'), 'utf8');

describe('image-zoom source contracts (R2C10-MED-01)', () => {
    it('does not cast KeyboardEvent to MouseEvent in onKeyDown', () => {
        // The old buggy pattern: handleClick(e as unknown as React.MouseEvent)
        expect(source).not.toContain('handleClick(e as unknown as React.MouseEvent)');
    });

    it('uses a dedicated keyboard toggle handler instead of delegating to handleClick', () => {
        expect(source).toContain('handleKeyboardToggle');
        // The onKeyDown prop should invoke handleKeyboardToggle, not handleClick
        expect(source).toMatch(/onKeyDown=\{[^}]*handleKeyboardToggle/);
    });

    it('does not let the container role block pointer click-to-zoom', () => {
        expect(source).toContain('interactiveAncestor !== containerRef.current');
        expect(source).not.toContain("if (target.closest('a, button, [role=\"button\"], input, textarea, select')) return");
    });
});

describe('image-zoom drag pan unit consistency (CMP-01 / AGG8b-07)', () => {
    it('converts drag deltas from px to percent via the container rect on both drag paths', () => {
        // Both the mouse and single-finger-touch pan paths must route through
        // the shared px→percent converter instead of feeding raw client pixels
        // into the percent-point pan space.
        const conversions = source.match(/dragDeltaToPanPct\(/g) ?? [];
        expect(conversions.length).toBeGreaterThanOrEqual(2);
    });

    it('never feeds raw client pixels into clampPan', () => {
        expect(source).not.toMatch(/clampPan\(\s*e\.clientX/);
        expect(source).not.toMatch(/clampPan\(\s*e\.touches/);
    });

    it('clamps drag pan at the level-aware bound (clampPan receives the zoom level)', () => {
        const levelAwareClamps = source.match(/clampPan\([^;]*zoomLevelRef\.current\s*\)/g) ?? [];
        expect(levelAwareClamps.length).toBeGreaterThanOrEqual(2);
    });
});
