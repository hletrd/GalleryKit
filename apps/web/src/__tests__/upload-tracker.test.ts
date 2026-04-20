import { describe, expect, it } from 'vitest';
import { settleUploadTrackerClaim, type UploadTrackerEntry } from '@/lib/upload-tracker';

function createTrackerEntry(count: number, bytes: number): UploadTrackerEntry {
    return { count, bytes, windowStart: Date.now() };
}

describe('upload tracker adjustment', () => {
    it('rolls back the pre-claimed quota when every upload fails', () => {
        const tracker = new Map<string, UploadTrackerEntry>([
            ['ip', createTrackerEntry(8, 4000)],
        ]);

        settleUploadTrackerClaim(tracker, 'ip', 3, 3000, 0, 0);

        expect(tracker.get('ip')).toMatchObject({ count: 5, bytes: 1000 });
    });

    it('removes the full claim when there was no prior quota usage', () => {
        const tracker = new Map<string, UploadTrackerEntry>([
            ['ip', createTrackerEntry(3, 3000)],
        ]);

        settleUploadTrackerClaim(tracker, 'ip', 3, 3000, 0, 0);

        expect(tracker.get('ip')).toMatchObject({ count: 0, bytes: 0 });
    });

    it('clamps values to zero if reconciliation would otherwise drift negative', () => {
        const tracker = new Map<string, UploadTrackerEntry>([
            ['ip', createTrackerEntry(2, 100)],
        ]);

        settleUploadTrackerClaim(tracker, 'ip', 5, 500, 0, 0);

        expect(tracker.get('ip')).toMatchObject({ count: 0, bytes: 0 });
    });

    it('keeps only the successful portion of a partially completed batch', () => {
        const tracker = new Map<string, UploadTrackerEntry>([
            ['ip', createTrackerEntry(5, 5000)],
        ]);

        settleUploadTrackerClaim(tracker, 'ip', 5, 5000, 3, 3000);

        expect(tracker.get('ip')).toMatchObject({ count: 3, bytes: 3000 });
    });

    it('leaves the claim intact when the full batch succeeds', () => {
        const tracker = new Map<string, UploadTrackerEntry>([
            ['ip', createTrackerEntry(5, 5000)],
        ]);

        settleUploadTrackerClaim(tracker, 'ip', 5, 5000, 5, 5000);

        expect(tracker.get('ip')).toMatchObject({ count: 5, bytes: 5000 });
    });

    it('preserves existing usage while rolling back only the failed portion', () => {
        const tracker = new Map<string, UploadTrackerEntry>([
            ['ip', createTrackerEntry(53, 53000)],
        ]);

        settleUploadTrackerClaim(tracker, 'ip', 3, 3000, 2, 2000);

        expect(tracker.get('ip')).toMatchObject({ count: 52, bytes: 52000 });
    });

    it('is a no-op when the tracker entry was already pruned', () => {
        const tracker = new Map<string, UploadTrackerEntry>();

        settleUploadTrackerClaim(tracker, 'missing', 1, 2000000, 0, 0);

        expect(tracker.size).toBe(0);
    });
});
