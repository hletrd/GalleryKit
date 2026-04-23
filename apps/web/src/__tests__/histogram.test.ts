import { describe, expect, it } from 'vitest';

import { requestHistogramFromWorker } from '@/components/histogram';

class FakeWorker {
    listeners = new Set<(event: MessageEvent) => void>();
    messages: Array<{ requestId: number; imageData: ArrayBuffer; width: number; height: number }> = [];

    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listeners.add(listener);
    }

    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listeners.delete(listener);
    }

    postMessage(message: { requestId: number; imageData: ArrayBuffer; width: number; height: number }) {
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
