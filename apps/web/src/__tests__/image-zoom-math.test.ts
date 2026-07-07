import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, SNAP_THRESHOLD, anchorPctFromClientPoint, anchoredZoomPosition, clampPan, clampZoom, dragDeltaToPanPct, touchDistance, touchMidpoint, wheelStep } from '@/lib/image-zoom-math';

describe('touchDistance', () => {
    it('returns 0 for coincident points', () => {
        expect(touchDistance({ clientX: 10, clientY: 10 }, { clientX: 10, clientY: 10 })).toBe(0);
    });
    it('returns correct Euclidean distance', () => {
        expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBeCloseTo(5);
    });
    it('is symmetric', () => {
        const a = { clientX: 100, clientY: 200 };
        const b = { clientX: 150, clientY: 250 };
        expect(touchDistance(a, b)).toBeCloseTo(touchDistance(b, a));
    });
});

describe('touchMidpoint', () => {
    it('returns the midpoint', () => {
        const mid = touchMidpoint({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 200 });
        expect(mid.x).toBe(50);
        expect(mid.y).toBe(100);
    });
    it('is symmetric', () => {
        const a = { clientX: 30, clientY: 40 };
        const b = { clientX: 70, clientY: 80 };
        const m1 = touchMidpoint(a, b);
        const m2 = touchMidpoint(b, a);
        expect(m1.x).toBeCloseTo(m2.x);
        expect(m1.y).toBeCloseTo(m2.y);
    });
});

describe('pinch zoom level computation', () => {
    it('doubles zoom when distance doubles', () => {
        const startDist = 100;
        const startZoom = 1.0;
        const newDist = 200;
        const rawLevel = startZoom * (newDist / startDist);
        expect(clampZoom(rawLevel)).toBeCloseTo(2.0);
    });
    it('halves zoom when distance halves', () => {
        const startDist = 200;
        const startZoom = 2.0;
        const newDist = 100;
        const rawLevel = startZoom * (newDist / startDist);
        expect(clampZoom(rawLevel)).toBeCloseTo(1.0);
    });
    it('clamps to MIN_ZOOM', () => {
        expect(clampZoom(0.5)).toBe(MIN_ZOOM);
    });
    it('clamps to MAX_ZOOM', () => {
        expect(clampZoom(10)).toBe(MAX_ZOOM);
    });
});

describe('snap threshold', () => {
    it('level below snap threshold should reset', () => {
        expect(1.05 < SNAP_THRESHOLD).toBe(true);
    });
    it('level at snap threshold should keep', () => {
        expect(1.1 >= SNAP_THRESHOLD).toBe(true);
    });
    it('level above snap threshold should keep', () => {
        expect(2.0 >= SNAP_THRESHOLD).toBe(true);
    });
});

describe('wheelStep', () => {
    it('zoom out (deltaY > 0) reduces level by ~2.5%', () => {
        const result = wheelStep(2.0, 100);
        expect(result).toBeCloseTo(1.95);
    });
    it('zoom in (deltaY < 0) increases level by ~2.5%', () => {
        const result = wheelStep(2.0, -100);
        expect(result).toBeCloseTo(2.05);
    });
    it('does not go below MIN_ZOOM', () => {
        expect(wheelStep(MIN_ZOOM, 100)).toBe(MIN_ZOOM);
    });
    it('does not exceed MAX_ZOOM', () => {
        expect(wheelStep(MAX_ZOOM, -100)).toBe(MAX_ZOOM);
    });
    it('repeated zoom out from 1.0 stays at MIN_ZOOM', () => {
        let level = MIN_ZOOM;
        for (let i = 0; i < 10; i++) level = wheelStep(level, 100);
        expect(level).toBe(MIN_ZOOM);
    });
    it('repeated zoom in from MAX_ZOOM stays at MAX_ZOOM', () => {
        let level = MAX_ZOOM;
        for (let i = 0; i < 10; i++) level = wheelStep(level, -100);
        expect(level).toBe(MAX_ZOOM);
    });
});

/**
 * CMP-01 / AGG8b-07 (run-10 c8b): clampPan is level-aware. A centered image
 * scaled to `level` overflows by (level - 1) * 50 percent-points per side —
 * the exact pan that brings an image edge to the container edge. The old
 * fixed ±100 bound over-panned at low zoom and made corners unreachable at 5×.
 */
describe('clampPan', () => {
    it('passes through values within the level bound', () => {
        expect(clampPan(50, -50, 3)).toEqual({ x: 50, y: -50 });
    });
    it('pins to (0, 0) at level 1 (nothing to pan)', () => {
        const out = clampPan(40, -40, 1);
        expect(out.x).toBeCloseTo(0);
        expect(out.y).toBeCloseTo(0);
    });
    it('clamps at ±(level-1)*50 — level 3 → ±100', () => {
        expect(clampPan(-200, 0, 3).x).toBe(-100);
        expect(clampPan(200, 0, 3).x).toBe(100);
        expect(clampPan(0, -200, 3).y).toBe(-100);
        expect(clampPan(0, 200, 3).y).toBe(100);
    });
    it('allows the full ±200 needed to reach corners at MAX_ZOOM (5×)', () => {
        expect(clampPan(-250, 250, MAX_ZOOM)).toEqual({ x: -200, y: 200 });
        expect(clampPan(-180, 180, MAX_ZOOM)).toEqual({ x: -180, y: 180 });
    });
    it('tightens the bound at low zoom — level 1.5 → ±25', () => {
        expect(clampPan(40, -40, 1.5)).toEqual({ x: 25, y: -25 });
    });
});

/**
 * CMP-01 / AGG8b-07: drag deltas arrive in CSS pixels; the pan space is
 * percent-points (1 percent-point = 1% of container size of net visual
 * displacement). 1:1 pointer tracking therefore requires deltaPx / size * 100.
 */
describe('dragDeltaToPanPct', () => {
    const rect = { width: 1000, height: 800 };
    it('converts a pixel delta into percent of the container size', () => {
        expect(dragDeltaToPanPct(100, 80, rect)).toEqual({ x: 10, y: 10 });
    });
    it('gives 1:1 visual tracking (delta% of width equals the dragged pixels)', () => {
        const dragged = 137;
        const pct = dragDeltaToPanPct(dragged, 0, rect).x;
        // Net visual displacement = pct% of container width (see clampPan doc).
        expect((pct / 100) * rect.width).toBeCloseTo(dragged);
    });
    it('is direction-preserving for negative deltas', () => {
        expect(dragDeltaToPanPct(-50, -40, rect)).toEqual({ x: -5, y: -5 });
    });
    it('returns zero for a degenerate zero-size rect', () => {
        expect(dragDeltaToPanPct(100, 100, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
        expect(dragDeltaToPanPct(100, 100, { width: 1000, height: 0 })).toEqual({ x: 0, y: 0 });
    });
});

/**
 * UX-R4C16-06 / TEST-R4C16-05: anchored-zoom math extracted from the
 * wheel path's inline arithmetic so wheel / pinch / double-tap / click
 * share one source. These tests lock the SHIPPED wheel convention
 * verbatim (extraction must not change wheel behavior) and the
 * double-tap-from-rest cases built on it.
 */
describe('anchorPctFromClientPoint', () => {
    const rect = { left: 100, top: 50, width: 1000, height: 800 };
    it('maps the container center to (0, 0)', () => {
        expect(anchorPctFromClientPoint(600, 450, rect)).toEqual({ x: -0, y: -0 });
    });
    it('maps the top-left corner to (+50, +50) (shipped -100 scale convention)', () => {
        expect(anchorPctFromClientPoint(100, 50, rect)).toEqual({ x: 50, y: 50 });
    });
    it('maps the bottom-right corner to (-50, -50)', () => {
        expect(anchorPctFromClientPoint(1100, 850, rect)).toEqual({ x: -50, y: -50 });
    });
    it('maps a right-of-center cursor to a negative x anchor', () => {
        expect(anchorPctFromClientPoint(900, 450, rect).x).toBeCloseTo(-30);
    });
});

describe('anchoredZoomPosition', () => {
    it('is the identity when the level does not change (ratio = 1)', () => {
        expect(anchoredZoomPosition(2, 2, { x: -30, y: 10 }, { x: 12, y: -4 })).toEqual({ x: 12, y: -4 });
    });
    it('keeps a centered anchor centered from rest', () => {
        expect(anchoredZoomPosition(MIN_ZOOM, DEFAULT_ZOOM, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    });
    it('matches the pre-extraction wheel arithmetic verbatim', () => {
        // Reference: newX = anchorX + (posX - anchorX) * (newLevel / currentLevel),
        // clamped at the NEW level's pan bound (CMP-01 level-aware clamp).
        const currentLevel = 1.4;
        const newLevel = wheelStep(currentLevel, -100);
        const anchor = { x: -30, y: 12.5 };
        const pos = { x: 8, y: -20 };
        const ratio = newLevel / currentLevel;
        const expected = clampPan(
            anchor.x + (pos.x - anchor.x) * ratio,
            anchor.y + (pos.y - anchor.y) * ratio,
            newLevel,
        );
        expect(anchoredZoomPosition(currentLevel, newLevel, anchor, pos)).toEqual(expected);
    });
    it('double-tap from rest pans toward the anchor by (1 - ratio)', () => {
        // From rest (level 1, pan 0): result = anchor * (1 - ratio).
        const out = anchoredZoomPosition(MIN_ZOOM, DEFAULT_ZOOM, { x: -30, y: 20 }, { x: 0, y: 0 });
        expect(out.x).toBeCloseTo(-30 * (1 - DEFAULT_ZOOM));
        expect(out.y).toBeCloseTo(20 * (1 - DEFAULT_ZOOM));
    });
    it('reaches the exact corner pan for extreme corner anchors at MAX_ZOOM', () => {
        // Unclamped result = anchor * (1 - MAX_ZOOM) = ∓200 — exactly the
        // level-aware bound (level 5 → ±200), so corners are now reachable
        // (the old fixed ±100 clamp cut this in half; CMP-01 / AGG8b-07).
        const out = anchoredZoomPosition(MIN_ZOOM, MAX_ZOOM, { x: 50, y: -50 }, { x: 0, y: 0 });
        expect(out).toEqual({ x: -200, y: 200 });
    });
});
