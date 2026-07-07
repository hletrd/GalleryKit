export const MIN_ZOOM = 1.0;
export const MAX_ZOOM = 5.0;
export const DEFAULT_ZOOM = 2.5;
export const SNAP_THRESHOLD = 1.1;

export interface ClientPoint {
    clientX: number;
    clientY: number;
}

/** Euclidean distance between two pointer/touch points. */
export function touchDistance(t0: ClientPoint, t1: ClientPoint): number {
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Midpoint between two pointer/touch points, in client coordinates. */
export function touchMidpoint(t0: ClientPoint, t1: ClientPoint): { x: number; y: number } {
    return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
}

export function clampZoom(level: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
}

export function wheelStep(current: number, deltaY: number): number {
    // Less sensitive than the previous 5% step so trackpad scrolls don't
    // jump the zoom level — 2.5% per tick keeps wheel zoom feel smooth.
    const factor = deltaY > 0 ? 0.975 : 1.025;
    return clampZoom(current * factor);
}

/**
 * Compute the clamped pan position after a zoom or pan operation.
 *
 * x/y are "percent-points" of the container size: applyTransform emits
 * `translate(${x / level}%, ...)` and the surrounding `scale(level)`
 * multiplies that back, so the NET visual displacement of the zoomed image
 * is exactly x% of the container width (independent of level).
 *
 * CMP-01 / AGG8b-07 (run-10 c8b): the bound is level-aware. A centered
 * image scaled to `level` overflows the container by (level - 1) * 50
 * percent-points per side — precisely the pan that brings an image EDGE to
 * the container edge. The previous fixed ±100 clamp both over-panned at low
 * zoom (level 1.5 only needs ±25) and made the corners UNREACHABLE at 5×
 * zoom (which needs ±200).
 */
export function clampPan(x: number, y: number, level: number): { x: number; y: number } {
    const maxPan = Math.max(0, (level - 1) * 50);
    return {
        x: Math.max(-maxPan, Math.min(maxPan, x)),
        y: Math.max(-maxPan, Math.min(maxPan, y)),
    };
}

/**
 * CMP-01 / AGG8b-07: convert a pointer drag delta (CSS pixels) into the
 * percent-point pan space. Because percent-points translate 1:1 into
 * container-relative visual displacement (see clampPan), 1:1 pointer
 * tracking is `deltaPx / containerSize * 100`. The drag paths previously
 * fed raw pixel deltas into percent space, so pan speed scaled with the
 * container width (~10× too fast on a 1000 px viewport).
 */
export function dragDeltaToPanPct(
    deltaXPx: number,
    deltaYPx: number,
    rect: { width: number; height: number },
): { x: number; y: number } {
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
        x: (deltaXPx / rect.width) * 100,
        y: (deltaYPx / rect.height) * 100,
    };
}

export interface AnchorRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * UX-R4C16-06: convert a client-coordinate point (cursor / tap) into the
 * anchor-percentage space the pan transform uses. This is the exact
 * convention the shipped wheel-zoom path established (image-zoom.tsx
 * cursor anchoring): offset from container center, normalized to
 * [-0.5, 0.5], scaled by -100.
 */
export function anchorPctFromClientPoint(
    clientX: number,
    clientY: number,
    rect: AnchorRect,
): { x: number; y: number } {
    return {
        x: ((clientX - rect.left) / rect.width - 0.5) * -100,
        y: ((clientY - rect.top) / rect.height - 0.5) * -100,
    };
}

/**
 * UX-R4C16-06: pan position that keeps the anchor point visually fixed
 * across a zoom-level change — extracted VERBATIM from the wheel path's
 * inline arithmetic (and structurally identical to the pinch path's),
 * so wheel, pinch, double-tap, and click zoom all share ONE
 * anchor-math source. Any future correction to the convention lands
 * here once instead of in three inline copies (the c15 theme bug's
 * exact failure mode).
 *
 * `ratio = newLevel / currentLevel`; identity when ratio === 1; result
 * is clamped to the pan bounds.
 */
export function anchoredZoomPosition(
    currentLevel: number,
    newLevel: number,
    anchor: { x: number; y: number },
    position: { x: number; y: number },
): { x: number; y: number } {
    const scaleRatio = newLevel / currentLevel;
    return clampPan(
        anchor.x + (position.x - anchor.x) * scaleRatio,
        anchor.y + (position.y - anchor.y) * scaleRatio,
        newLevel,
    );
}
