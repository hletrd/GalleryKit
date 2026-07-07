import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * C7-01 (run-10 cycle 7b, 5-lane agreement): logout during a restore window
 * clears the cookie but cannot delete the DB session row. The skipped
 * revocation must be QUEUED and flushed once the window closes — never
 * silently dropped (the token would otherwise stay verifiable for up to its
 * remaining 24 h lifetime).
 */

const whereMock = vi.fn(async () => undefined);
const deleteMock = vi.fn(() => ({ where: whereMock }));

vi.mock('@/db', () => ({
    db: { delete: () => deleteMock() },
    sessions: { id: Symbol('sessions.id') },
}));

import {
    enqueuePendingSessionRevocation,
    flushPendingSessionRevocations,
    pendingSessionRevocationCount,
    _clearPendingSessionRevocationsForTest,
} from '@/lib/pending-session-revocations';

describe('pending session revocations queue', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        _clearPendingSessionRevocationsForTest();
        whereMock.mockClear();
        whereMock.mockImplementation(async () => undefined);
        deleteMock.mockClear();
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        errorSpy.mockRestore();
    });

    it('flushes queued hashes with a single DELETE and empties the queue', async () => {
        enqueuePendingSessionRevocation('hash-a');
        enqueuePendingSessionRevocation('hash-b');
        expect(pendingSessionRevocationCount()).toBe(2);

        const flushed = await flushPendingSessionRevocations();
        expect(flushed).toBe(2);
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(whereMock).toHaveBeenCalledTimes(1);
        expect(pendingSessionRevocationCount()).toBe(0);
    });

    it('keeps entries queued when the DELETE fails, and retries on the next flush', async () => {
        enqueuePendingSessionRevocation('hash-a');
        whereMock.mockRejectedValueOnce(new Error('db down'));

        expect(await flushPendingSessionRevocations()).toBe(0);
        expect(pendingSessionRevocationCount()).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('pending session revocations'),
            expect.any(Error),
        );

        expect(await flushPendingSessionRevocations()).toBe(1);
        expect(pendingSessionRevocationCount()).toBe(0);
    });

    it('is a no-op when the queue is empty (no DB round-trip)', async () => {
        expect(await flushPendingSessionRevocations()).toBe(0);
        expect(deleteMock).not.toHaveBeenCalled();
    });

    it('bounds the queue: the oldest entry is evicted past the cap', async () => {
        for (let i = 0; i < 300; i++) {
            enqueuePendingSessionRevocation(`hash-${i}`);
        }
        expect(pendingSessionRevocationCount()).toBe(256);
    });

    it('deduplicates repeated enqueues of the same hash', () => {
        enqueuePendingSessionRevocation('hash-a');
        enqueuePendingSessionRevocation('hash-a');
        expect(pendingSessionRevocationCount()).toBe(1);
    });
});

describe('C7-01 wiring source contracts', () => {
    const appRoot = path.resolve(__dirname, '..', '..');
    const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8');

    it('logout queues the skipped revocation on the blocked branch', () => {
        const source = read('src/app/actions/auth.ts');
        expect(source).toContain("enqueuePendingSessionRevocation(hashSessionToken(token))");
        // The queue call must sit on the not-revoked path, guarded by the
        // revoked flag set only after the actual DB delete.
        expect(source).toContain('let revoked = false;');
        expect(source).toContain('if (!revoked) {');
    });

    it('the restore path flushes after clearing the maintenance marker', () => {
        const source = read('src/app/[locale]/admin/db-actions.ts');
        const endMarker = source.indexOf('endDurableRestoreMaintenance();');
        const flush = source.indexOf('await flushPendingSessionRevocations();');
        const drainPendingFiles = source.indexOf('await drainPendingFileDeletions()');
        expect(endMarker).toBeGreaterThan(-1);
        expect(flush).toBeGreaterThan(endMarker);
        expect(drainPendingFiles).toBeGreaterThan(endMarker);
        expect(drainPendingFiles).toBeGreaterThan(flush);
    });

    it('the hourly maintenance sweep includes the flush as a backstop', () => {
        const source = read('src/lib/maintenance-scheduler.ts');
        expect(source).toContain("runMaintenanceTask('flushPendingSessionRevocations', flushPendingSessionRevocations)");
        expect(source).toContain("runMaintenanceTask('drainPendingFileDeletions', drainPendingFileDeletions)");
    });
});
