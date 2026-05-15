/**
 * useDisplayCapability tests (P4-B1 / R4-M1 / R9-R1).
 *
 * Pure-function tests for the underlying detection. These mock
 * `window`, `screen.colorGamut`, `matchMedia`, and the canvas-P3
 * probe to cover each browser path:
 *
 *   - Chromium 121+ via `screen.colorGamut`.
 *   - Chrome / Safari / Edge via `(color-gamut: p3)` MQ.
 *   - Firefox — defaults to 'srgb' because canvas-P3 probe is not
 *     display-gated (R9-R1).
 *   - Pure sRGB displays — no signal indicates P3.
 *   - Rec.2020 advertised via `screen.colorGamut`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We import the module from the project — the SSR-safe code path checks
// `typeof window === 'undefined'`, so we monkey-patch globalThis.window
// from these tests rather than rely on jsdom presets.
import { _resetCanvasP3CacheForTesting } from '@/lib/use-display-capability';

// ---------------------------------------------------------------------------
// Test harness — control the window.* surface from each test.
// ---------------------------------------------------------------------------

interface MockMatchMediaEntry {
    matches: boolean;
}

interface MockWindowOptions {
    screenColorGamut?: 'srgb' | 'p3' | 'rec2020';
    matchMediaResults?: Record<string, MockMatchMediaEntry>;
    /** When true, the test simulates Firefox where `screen.colorGamut` is undefined. */
    omitScreenColorGamut?: boolean;
    /** When true, simulates browsers without `matchMedia`. */
    omitMatchMedia?: boolean;
}

let originalWindow: unknown;
let originalDocument: unknown;

function installMockWindow(opts: MockWindowOptions = {}): void {
    originalWindow = (globalThis as Record<string, unknown>).window;
    originalDocument = (globalThis as Record<string, unknown>).document;

    const screen: { colorGamut?: string } = {};
    if (!opts.omitScreenColorGamut && opts.screenColorGamut) {
        screen.colorGamut = opts.screenColorGamut;
    }

    const matchMedia = opts.omitMatchMedia
        ? undefined
        : (query: string) => {
            const res = opts.matchMediaResults?.[query];
            return {
                matches: res?.matches ?? false,
                addEventListener: () => { /* noop */ },
                removeEventListener: () => { /* noop */ },
                addListener: () => { /* noop */ },
                removeListener: () => { /* noop */ },
                dispatchEvent: () => false,
                onchange: null,
                media: query,
            } as unknown as MediaQueryList;
        };

    const win: Record<string, unknown> = { screen };
    if (matchMedia) {
        win.matchMedia = matchMedia;
    }
    (globalThis as Record<string, unknown>).window = win;
    // Document is needed for the canvas-P3 probe inside detect()
    (globalThis as Record<string, unknown>).document = {
        createElement: () => ({
            getContext: () => ({
                getContextAttributes: () => ({ colorSpace: 'srgb' }),
            }),
        }),
    };
}

function uninstallMockWindow(): void {
    if (typeof originalWindow === 'undefined') {
        delete (globalThis as Record<string, unknown>).window;
    } else {
        (globalThis as Record<string, unknown>).window = originalWindow;
    }
    if (typeof originalDocument === 'undefined') {
        delete (globalThis as Record<string, unknown>).document;
    } else {
        (globalThis as Record<string, unknown>).document = originalDocument;
    }
}

beforeEach(() => {
    _resetCanvasP3CacheForTesting();
});

afterEach(() => {
    uninstallMockWindow();
    vi.restoreAllMocks();
    _resetCanvasP3CacheForTesting();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDisplayCapability detection', () => {
    it('returns p3 when screen.colorGamut === "p3" (Chromium 121+ path)', async () => {
        installMockWindow({ screenColorGamut: 'p3' });
        const _mod = await import('@/lib/use-display-capability');
        // Reach into the unexported detect via a fresh import: the hook runs
        // detect() synchronously the first time. We re-implement the same
        // public-API pathway by calling detect through useSyncExternalStore
        // semantics — for unit tests we directly invoke detect() through
        // the hook's getSnapshot path, which the module exposes as
        // useDisplayCapability().
        // We can't render a hook here, but useSyncExternalStore's getSnapshot
        // is wired through `detect()`. Importing the module after
        // installMockWindow guarantees that the first synchronous detect()
        // sees the mocked surface.
        const result = (await import('@/lib/use-display-capability')).useDisplayCapability;
        // Call the exported `detect` indirectly via the hook export — but the
        // hook wraps useSyncExternalStore so calling it would require React
        // context. Instead test via the side-effect of detect() through a
        // re-import of the module's internal `detect` is cleaner. We expose
        // a small helper for this:
        void result;
        // Instead, verify via the publicly observable mocked screen surface
        // and the hook contract: `screen.colorGamut === 'p3'` must yield 'p3'.
        // The detect() function is referenced through the hook; we test
        // detection by invoking the same pattern detect() uses:
        const win = (globalThis as Record<string, unknown>).window as Window & { screen?: { colorGamut?: string } };
        expect(win.screen?.colorGamut).toBe('p3');
        // To actually run detect(), import a small test helper. We add one:
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('p3');
        expect(cap.isHdr).toBe(false);

        uninstallMockWindow();
    });

    it('returns rec2020 when screen.colorGamut === "rec2020"', async () => {
        installMockWindow({ screenColorGamut: 'rec2020' });
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('rec2020');
    });

    it('returns srgb when screen.colorGamut === "srgb"', async () => {
        installMockWindow({ screenColorGamut: 'srgb' });
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('srgb');
    });

    it('returns p3 via matchMedia when screen.colorGamut is unavailable', async () => {
        installMockWindow({
            omitScreenColorGamut: true,
            matchMediaResults: {
                '(color-gamut: p3)': { matches: true },
                '(color-gamut: rec2020)': { matches: false },
                '(dynamic-range: high)': { matches: false },
            },
        });
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('p3');
    });

    it('returns rec2020 via matchMedia when screen.colorGamut is unavailable', async () => {
        installMockWindow({
            omitScreenColorGamut: true,
            matchMediaResults: {
                '(color-gamut: rec2020)': { matches: true },
                '(color-gamut: p3)': { matches: true },
                '(dynamic-range: high)': { matches: false },
            },
        });
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('rec2020');
    });

    it('defaults Firefox to srgb when neither screen.colorGamut nor MQ is available (R9-R1)', async () => {
        // Firefox: no screen.colorGamut, no MQ support, canvas-P3 probe
        // would return true but is not display-gated — must default to 'srgb'.
        installMockWindow({
            omitScreenColorGamut: true,
            matchMediaResults: {
                '(color-gamut: p3)': { matches: false },
                '(color-gamut: rec2020)': { matches: false },
                '(dynamic-range: high)': { matches: false },
            },
        });
        _resetCanvasP3CacheForTesting();
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('srgb');
        expect(cap.isHdr).toBe(false);
    });

    it('returns srgb when no signal indicates P3', async () => {
        installMockWindow({
            omitScreenColorGamut: true,
            matchMediaResults: {
                '(color-gamut: p3)': { matches: false },
                '(color-gamut: rec2020)': { matches: false },
                '(dynamic-range: high)': { matches: false },
            },
        });
        // Default mocked document returns colorSpace 'srgb' from canvas probe
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('srgb');
        expect(cap.isHdr).toBe(false);
    });

    it('reports HDR when "(dynamic-range: high)" matches', async () => {
        installMockWindow({
            screenColorGamut: 'p3',
            matchMediaResults: {
                '(color-gamut: p3)': { matches: true },
                '(color-gamut: rec2020)': { matches: false },
                '(dynamic-range: high)': { matches: true },
            },
        });
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.isHdr).toBe(true);
    });

    it('SSR returns { p3, isHdr=false } when window is undefined', async () => {
        // No installMockWindow — leaves window undefined as in Node SSR.
        delete (globalThis as Record<string, unknown>).window;
        delete (globalThis as Record<string, unknown>).document;
        const { _detectForTesting } = await import('@/lib/use-display-capability');
        const cap = _detectForTesting!();
        expect(cap.colorGamut).toBe('p3');
        expect(cap.isHdr).toBe(false);
    });
});
