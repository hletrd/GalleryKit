import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, SNAP_THRESHOLD, anchorPctFromClientPoint, anchoredZoomPosition, clampPan, clampZoom, touchDistance, touchMidpoint, wheelStep } from '@/lib/image-zoom-math';

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

describe('clampPan', () => {
    it('passes through values within bounds', () => {
        expect(clampPan(50, -50)).toEqual({ x: 50, y: -50 });
    });
    it('clamps x to -100..100', () => {
        expect(clampPan(-200, 0).x).toBe(-100);
        expect(clampPan(200, 0).x).toBe(100);
    });
    it('clamps y to -100..100', () => {
        expect(clampPan(0, -200).y).toBe(-100);
        expect(clampPan(0, 200).y).toBe(100);
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
        // Reference: newX = anchorX + (posX - anchorX) * (newLevel / currentLevel)
        const currentLevel = 1.4;
        const newLevel = wheelStep(currentLevel, -100);
        const anchor = { x: -30, y: 12.5 };
        const pos = { x: 8, y: -20 };
        const ratio = newLevel / currentLevel;
        const expected = clampPan(
            anchor.x + (pos.x - anchor.x) * ratio,
            anchor.y + (pos.y - anchor.y) * ratio,
        );
        expect(anchoredZoomPosition(currentLevel, newLevel, anchor, pos)).toEqual(expected);
    });
    it('double-tap from rest pans toward the anchor by (1 - ratio)', () => {
        // From rest (level 1, pan 0): result = anchor * (1 - ratio).
        const out = anchoredZoomPosition(MIN_ZOOM, DEFAULT_ZOOM, { x: -30, y: 20 }, { x: 0, y: 0 });
        expect(out.x).toBeCloseTo(-30 * (1 - DEFAULT_ZOOM));
        expect(out.y).toBeCloseTo(20 * (1 - DEFAULT_ZOOM));
    });
    it('saturates at the pan clamp for extreme corner anchors', () => {
        const out = anchoredZoomPosition(MIN_ZOOM, MAX_ZOOM, { x: 50, y: -50 }, { x: 0, y: 0 });
        expect(out).toEqual({ x: -100, y: 100 });
    });
});
