import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { requestHistogramFromWorker, estimateKeyType, resolveHistogramSourceLabel, resolveIsClipped } from '@/components/histogram';

class FakeWorker {
    listeners = new Set<(event: MessageEvent) => void>();
    messages: Array<{ requestId: number; imageData: ArrayBuffer; width: number; height: number; colorSpace?: 'srgb' | 'display-p3' }> = [];

    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listeners.add(listener);
    }

    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listeners.delete(listener);
    }

    postMessage(message: { requestId: number; imageData: ArrayBuffer; width: number; height: number; colorSpace?: 'srgb' | 'display-p3' }) {
        this.messages.push(message);
    }

    emit(data: unknown) {
        for (const listener of [...this.listeners]) {
            listener({ data } as MessageEvent);
        }
    }
}

function runShippedHistogramWorker(message: {
    requestId: number;
    imageData: ArrayBuffer;
    width: number;
    height: number;
    colorSpace?: 'srgb' | 'display-p3';
}) {
    const source = readFileSync(new URL('../../public/histogram-worker.js', import.meta.url), 'utf8');
    const posted: unknown[] = [];
    const scope: {
        self?: unknown;
        onmessage?: (event: { data: typeof message }) => void;
        postMessage: (data: unknown) => void;
        Uint8ClampedArray: typeof Uint8ClampedArray;
        Array: ArrayConstructor;
        Math: Math;
    } = {
        postMessage: (data: unknown) => posted.push(data),
        Uint8ClampedArray,
        Array,
        Math,
    };
    scope.self = scope;

    vm.runInContext(source, vm.createContext(scope), {
        filename: 'public/histogram-worker.js',
    });

    expect(scope.onmessage).toBeTypeOf('function');
    scope.onmessage?.({ data: message });
    expect(posted).toHaveLength(1);
    return posted[0] as {
        requestId: number;
        histogram: { r: number[]; g: number[]; b: number[]; l: number[] };
    };
}

describe('requestHistogramFromWorker', () => {
    it('matches worker replies to the correct in-flight request', async () => {
        const worker = new FakeWorker();
        const firstHistogram = { r: [1], g: [2], b: [3], l: [4] };
        const secondHistogram = { r: [5], g: [6], b: [7], l: [8] };

        const firstPromise = requestHistogramFromWorker(worker, {
            imageData: new Uint8ClampedArray([1, 2, 3, 255]).buffer,
            width: 1,
            height: 1,
        });
        const secondPromise = requestHistogramFromWorker(worker, {
            imageData: new Uint8ClampedArray([5, 6, 7, 255]).buffer,
            width: 1,
            height: 1,
        });

        const [firstMessage, secondMessage] = worker.messages;

        worker.emit({ requestId: firstMessage.requestId, histogram: firstHistogram });
        await expect(firstPromise).resolves.toEqual(firstHistogram);

        let secondResolved = false;
        void secondPromise.then(() => {
            secondResolved = true;
        });
        await Promise.resolve();
        expect(secondResolved).toBe(false);

        worker.emit({ requestId: secondMessage.requestId, histogram: secondHistogram });
        await expect(secondPromise).resolves.toEqual(secondHistogram);
    });
});

describe('histogram-worker luminance coefficients', () => {
    it('executes the shipped worker and produces different luminance bins for sRGB vs display-p3 colorSpace', () => {
        // A single pixel with pure red (255, 0, 0).
        // sRGB BT.709:  0.2126 * 255 = 54.213 → 54
        // P3:           0.22897 * 255 = 58.387 → 58
        const pixel = new Uint8ClampedArray([255, 0, 0, 255]);

        const srgbResult = runShippedHistogramWorker({
            requestId: 1,
            imageData: pixel.buffer,
            width: 1,
            height: 1,
            colorSpace: 'srgb',
        });
        const p3Result = runShippedHistogramWorker({
            requestId: 2,
            imageData: pixel.buffer,
            width: 1,
            height: 1,
            colorSpace: 'display-p3',
        });

        expect(srgbResult.requestId).toBe(1);
        expect(p3Result.requestId).toBe(2);

        // RGB bins should be identical (same raw pixel values).
        expect(srgbResult.histogram.r).toEqual(p3Result.histogram.r);
        expect(srgbResult.histogram.g).toEqual(p3Result.histogram.g);
        expect(srgbResult.histogram.b).toEqual(p3Result.histogram.b);

        // Luminance bins should differ: sRGB=54, P3=58.
        expect(srgbResult.histogram.l[54]).toBe(1);
        expect(srgbResult.histogram.l[58]).toBe(0);
        expect(p3Result.histogram.l[58]).toBe(1);
        expect(p3Result.histogram.l[54]).toBe(0);
    });
});

describe('estimateKeyType — percentile-based classification (R10-M4)', () => {
    function makeHistogram(l: number[]): { r: number[]; g: number[]; b: number[]; l: number[] } {
        const zeroes = new Array(256).fill(0);
        return { r: [...zeroes], g: [...zeroes], b: [...zeroes], l };
    }

    it('classifies high-key when p90 > 220 and p10 > 100', () => {
        const bins = new Array(256).fill(0);
        bins[240] = 1000;
        bins[180] = 500;
        expect(estimateKeyType(makeHistogram(bins))).toBe('high-key');
    });

    it('classifies low-key when p10 < 40 and p90 < 180', () => {
        const bins = new Array(256).fill(0);
        bins[20] = 1000;
        bins[100] = 500;
        expect(estimateKeyType(makeHistogram(bins))).toBe('low-key');
    });

    it('classifies balanced for midtone spread', () => {
        const bins = new Array(256).fill(0);
        bins[50] = 500;
        bins[128] = 500;
        bins[200] = 500;
        expect(estimateKeyType(makeHistogram(bins))).toBe('balanced');
    });

    it('classifies balanced for empty histogram', () => {
        expect(estimateKeyType(makeHistogram(new Array(256).fill(0)))).toBe('balanced');
    });

    it('classifies balanced when only p90 is high but p10 is low', () => {
        // Mostly dark with a few bright highlights — not high-key because
        // the shadow tail (p10) is too dark.
        const bins = new Array(256).fill(0);
        bins[10] = 800;
        bins[240] = 200;
        expect(estimateKeyType(makeHistogram(bins))).toBe('balanced');
    });

    it('classifies balanced when only p10 is high but p90 is moderate', () => {
        // Mostly bright but highlights don't blow out — not high-key because
        // p90 is below the threshold.
        const bins = new Array(256).fill(0);
        bins[150] = 1000;
        bins[200] = 500;
        expect(estimateKeyType(makeHistogram(bins))).toBe('balanced');
    });
});

// R27-HD-MED-1: histogram source label + clipped hint must reflect the URL
// the worker actually loaded, not the priority intent. When the AVIF
// candidate 404s and the resolver falls back to a sized/base JPEG, the
// label must read "JPEG" and the (sRGB clipped) hint must fire on a P3
// display so a photographer auditing the histogram sees the honest source.
describe('resolveHistogramSourceLabel (R27-HD-MED-1)', () => {
    it('returns AVIF when effectiveUrl matches avifUrl', () => {
        expect(resolveHistogramSourceLabel('/p.avif', '/p.avif')).toBe('AVIF');
    });

    it('returns JPEG when effectiveUrl falls back from AVIF to sized JPEG', () => {
        // Photographer dropped the AVIF derivative; resolver picked the sized JPEG.
        expect(resolveHistogramSourceLabel('/p_1536.jpg', '/p.avif')).toBe('JPEG');
    });

    it('returns JPEG when effectiveUrl falls back to base JPEG', () => {
        expect(resolveHistogramSourceLabel('/p.jpg', '/p.avif')).toBe('JPEG');
    });

    it('returns JPEG when no AVIF candidate was offered (legacy photo)', () => {
        expect(resolveHistogramSourceLabel('/p.jpg', undefined)).toBe('JPEG');
    });

    it('returns null when effectiveUrl is null', () => {
        expect(resolveHistogramSourceLabel(null, '/p.avif')).toBeNull();
    });
});

describe('resolveIsClipped (R27-HD-MED-1)', () => {
    it('returns false for an sRGB photo regardless of display', () => {
        expect(resolveIsClipped({
            isWideGamut: false, colorGamut: 'srgb', preferAvif: false,
            effectiveUrl: '/p.jpg', avifUrl: undefined,
        })).toBe(false);
        expect(resolveIsClipped({
            isWideGamut: false, colorGamut: 'p3', preferAvif: false,
            effectiveUrl: '/p.jpg', avifUrl: undefined,
        })).toBe(false);
    });

    it('returns true for a wide-gamut photo on an sRGB display', () => {
        expect(resolveIsClipped({
            isWideGamut: true, colorGamut: 'srgb', preferAvif: false,
            effectiveUrl: '/p.jpg', avifUrl: '/p.avif',
        })).toBe(true);
    });

    it('returns false for a wide-gamut photo on a P3 display when AVIF is fetched', () => {
        expect(resolveIsClipped({
            isWideGamut: true, colorGamut: 'p3', preferAvif: true,
            effectiveUrl: '/p.avif', avifUrl: '/p.avif',
        })).toBe(false);
    });

    it('returns true for a wide-gamut photo on a P3 display when AVIF fell back to JPEG', () => {
        // AVIF 404'd; resolver fell through to the sized JPEG → bytes the
        // canvas reads are sRGB-clipped on the P3 display.
        expect(resolveIsClipped({
            isWideGamut: true, colorGamut: 'p3', preferAvif: true,
            effectiveUrl: '/p_1536.jpg', avifUrl: '/p.avif',
        })).toBe(true);
    });
});
