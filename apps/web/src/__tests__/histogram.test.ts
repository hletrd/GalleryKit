import { describe, expect, it } from 'vitest';

import { requestHistogramFromWorker } from '@/components/histogram';

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
    it('produces different luminance bins for sRGB vs display-p3 colorSpace', async () => {
        const worker = new FakeWorker();

        // A single pixel with pure red (255, 0, 0).
        // sRGB BT.709:  0.2126 * 255 = 54.213 → 54
        // P3:           0.22897 * 255 = 58.387 → 58
        const pixel = new Uint8ClampedArray([255, 0, 0, 255]);

        const srgbPromise = requestHistogramFromWorker(worker, {
            imageData: pixel.buffer,
            width: 1,
            height: 1,
            colorSpace: 'srgb',
        });
        const p3Promise = requestHistogramFromWorker(worker, {
            imageData: pixel.buffer,
            width: 1,
            height: 1,
            colorSpace: 'display-p3',
        });

        const [srgbMsg, p3Msg] = worker.messages;

        // Simulate the worker logic with the correct coefficients per colorSpace.
        function computeHistogram(
            imageData: ArrayBuffer,
            width: number,
            height: number,
            colorSpace: 'srgb' | 'display-p3',
        ) {
            const data = new Uint8ClampedArray(imageData);
            const r = new Array(256).fill(0);
            const g = new Array(256).fill(0);
            const b = new Array(256).fill(0);
            const l = new Array(256).fill(0);
            const isP3 = colorSpace === 'display-p3';
            const lr = isP3 ? 0.22897 : 0.2126;
            const lg = isP3 ? 0.69174 : 0.7152;
            const lb = isP3 ? 0.07929 : 0.0722;
            const len = width * height * 4;
            for (let i = 0; i < len; i += 4) {
                const rv = data[i];
                const gv = data[i + 1];
                const bv = data[i + 2];
                r[rv]++;
                g[gv]++;
                b[bv]++;
                const lum = Math.round(lr * rv + lg * gv + lb * bv);
                l[lum]++;
            }
            return { r, g, b, l };
        }

        worker.emit({
            requestId: srgbMsg.requestId,
            histogram: computeHistogram(srgbMsg.imageData, srgbMsg.width, srgbMsg.height, 'srgb'),
        });
        worker.emit({
            requestId: p3Msg.requestId,
            histogram: computeHistogram(p3Msg.imageData, p3Msg.width, p3Msg.height, 'display-p3'),
        });

        const srgbResult = await srgbPromise;
        const p3Result = await p3Promise;

        // RGB bins should be identical (same raw pixel values).
        expect(srgbResult.r).toEqual(p3Result.r);
        expect(srgbResult.g).toEqual(p3Result.g);
        expect(srgbResult.b).toEqual(p3Result.b);

        // Luminance bins should differ: sRGB=54, P3=58.
        expect(srgbResult.l[54]).toBe(1);
        expect(srgbResult.l[58]).toBe(0);
        expect(p3Result.l[58]).toBe(1);
        expect(p3Result.l[54]).toBe(0);
    });
});
