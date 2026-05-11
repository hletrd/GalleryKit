/**
 * useDisplayCapability — unified display gamut + HDR detection (P4-B1 / R4-M1).
 *
 * Layered detection in priority order:
 *
 *   1. `screen.colorGamut` (Chromium 121+, Safari 18+ TP) — authoritative.
 *   2. `(color-gamut: rec2020)` MQ — supported on Chrome / Safari / Edge.
 *   3. `(color-gamut: p3)` MQ — same browsers.
 *   4. Canvas-P3 feature probe — Firefox 113+ (no MQ support today).
 *
 * The hook returns `{ colorGamut, isHdr }`. `colorGamut` collapses the
 * three buckets ('srgb' | 'p3' | 'rec2020') consumers care about — the
 * `WideGamutHint` shows for srgb only (it does not use `isHdr`), and
 * the `Histogram` requests a Display-P3 canvas for any non-sRGB display.
 *
 * The hook subscribes to MQ changes so that switching displays / dragging
 * to an external monitor / toggling system color profile propagates without
 * a full re-render.
 *
 * SSR: returns `{ colorGamut: 'p3', isHdr: false }`. Defaulting to P3
 * suppresses the SDR-only `WideGamutHint` on first paint — the hint
 * settles on the client side after hydration. This avoids flicker for the
 * common P3-display case.
 */

'use client';

import { useSyncExternalStore } from 'react';

export type ColorGamut = 'srgb' | 'p3' | 'rec2020';

export interface DisplayCapability {
    colorGamut: ColorGamut;
    isHdr: boolean;
}

const SERVER_DEFAULT: DisplayCapability = { colorGamut: 'p3', isHdr: false };

/**
 * Module-cached canvas-P3 probe — runs once per process, identical to the
 * pattern in `histogram.tsx`'s `getSupportsCanvasP3`.
 */
let _cachedSupportsCanvasP3: boolean | null = null;
function probeCanvasP3(): boolean {
    if (_cachedSupportsCanvasP3 !== null) return _cachedSupportsCanvasP3;
    if (typeof document === 'undefined') {
        _cachedSupportsCanvasP3 = false;
        return false;
    }
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' as PredefinedColorSpace });
        _cachedSupportsCanvasP3 = ctx !== null && ctx.getContextAttributes().colorSpace === 'display-p3';
    } catch {
        _cachedSupportsCanvasP3 = false;
    }
    return _cachedSupportsCanvasP3;
}

// `useSyncExternalStore` checks `Object.is(prev, next)` between getSnapshot()
// calls. If `detect()` returns a fresh `{ colorGamut, isHdr }` object every
// call, React detects a "change" on every render → re-render → new snapshot
// → infinite loop (React error #185). Cache the last snapshot by VALUE so
// repeated calls return the same reference until the underlying media-query
// or feature-probe state actually flips.
let _cachedSnapshot: DisplayCapability | null = null;

function detect(): DisplayCapability {
    if (typeof window === 'undefined') return SERVER_DEFAULT;

    let gamut: ColorGamut = 'srgb';
    const screen = typeof window.screen === 'object' ? window.screen as Screen & { colorGamut?: string } : undefined;
    if (screen && typeof screen.colorGamut === 'string') {
        if (screen.colorGamut === 'rec2020') gamut = 'rec2020';
        else if (screen.colorGamut === 'p3') gamut = 'p3';
        else gamut = 'srgb';
    } else if (typeof window.matchMedia === 'function') {
        if (window.matchMedia('(color-gamut: rec2020)').matches) {
            gamut = 'rec2020';
        } else if (window.matchMedia('(color-gamut: p3)').matches) {
            gamut = 'p3';
        } else if (probeCanvasP3()) {
            // Firefox path: no MQ support today; fall back to canvas-P3.
            gamut = 'p3';
        }
    } else if (probeCanvasP3()) {
        gamut = 'p3';
    }

    const isHdr = typeof window.matchMedia === 'function'
        ? window.matchMedia('(dynamic-range: high)').matches
        : false;

    if (
        _cachedSnapshot &&
        _cachedSnapshot.colorGamut === gamut &&
        _cachedSnapshot.isHdr === isHdr
    ) {
        return _cachedSnapshot;
    }
    _cachedSnapshot = { colorGamut: gamut, isHdr };
    return _cachedSnapshot;
}

function subscribe(callback: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => { /* noop */ };
    }
    const queries = ['(color-gamut: p3)', '(color-gamut: rec2020)', '(dynamic-range: high)'];
    const handlers: (() => void)[] = [];
    for (const q of queries) {
        try {
            const mq = window.matchMedia(q);
            mq.addEventListener('change', callback);
            handlers.push(() => mq.removeEventListener('change', callback));
        } catch {
            // Some browsers throw on unsupported MQ — ignore those.
        }
    }
    // R5-M4: `screen.colorGamut` has no change-event API. Re-detect on
    // window focus / visibilitychange as a best-effort fallback so dragging
    // the browser from a P3 monitor to an sRGB laptop (or vice versa) does
    // not leave stale state indefinitely.
    const handleVisibility = () => { if (!document.hidden) callback(); };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', callback);
    handlers.push(() => document.removeEventListener('visibilitychange', handleVisibility));
    handlers.push(() => window.removeEventListener('focus', callback));
    return () => { for (const h of handlers) h(); };
}

function getServerSnapshot(): DisplayCapability {
    return SERVER_DEFAULT;
}

/**
 * React hook — subscribes to display gamut + HDR media-query changes and
 * returns the current capability. Pure-client only (`'use client'`).
 */
export function useDisplayCapability(): DisplayCapability {
    return useSyncExternalStore(subscribe, detect, getServerSnapshot);
}

// Test-only export so a unit test can reset the cached canvas-P3 probe
// between cases when the test mocks document / canvas behavior. Also resets
// the snapshot memoization so toggling test state produces fresh detect()
// results.
export function _resetCanvasP3CacheForTesting(): void {
    _cachedSupportsCanvasP3 = null;
    _cachedSnapshot = null;
}

// Test-only export of the synchronous detect() function. Calling the hook
// directly from a unit test would require React renderer setup; the tests
// only need to verify that the detection logic responds to the mocked
// `window` / `screen` / `matchMedia` surface.
export const _detectForTesting = detect;
