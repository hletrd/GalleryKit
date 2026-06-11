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
 * x/y are expressed as percentages of the container size.
 */
export function clampPan(x: number, y: number): { x: number; y: number } {
    return {
        x: Math.max(-100, Math.min(100, x)),
        y: Math.max(-100, Math.min(100, y)),
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
    );
}
