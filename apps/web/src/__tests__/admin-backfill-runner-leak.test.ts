/**
 * R29-CRIT-1 — admin-backfill-runner leak regression test.
 *
 * The previous shape of `runBackfill` mutated `state.running = true` and
 * called `await getGalleryConfig()` BEFORE entering the try/catch/finally
 * block. If `getGalleryConfig()` rejected, the function's promise rejected
 * synchronously to `void runBackfill(...)` and:
 *   1. `state.running` stayed `true` forever
 *   2. the MySQL advisory lock was never released
 *   3. the lock connection was never returned to the pool
 *
 * This test exercises the contract by mocking `getGalleryConfig` to throw
 * and asserting:
 *   - `state.running` returns to `false`
 *   - the lock-connection's RELEASE_LOCK + release() are called
 *   - `state.lastError` is populated
 *   - subsequent runs see a fresh state (no `already_running` poisoning)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();
const lockConnection = { query: queryMock, release: releaseMock };

vi.mock('@/db', () => ({
    connection: {
        getConnection: vi.fn(async () => lockConnection),
    },
    db: {
        execute: vi.fn(),
    },
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: vi.fn(),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: vi.fn(() => false),
}));

vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        processImageFormats: vi.fn(),
        resolveColorPipelineDecision: vi.fn(() => null),
        IMAGE_PIPELINE_VERSION: 7,
    };
});

vi.mock('@/lib/color-detection', () => ({
    detectColorSignals: vi.fn(),
}));

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: vi.fn(async (n: string) => n),
}));

import { triggerAdminBackfill, readAdminBackfillState } from '@/lib/admin-backfill-runner';
import { getGalleryConfig } from '@/lib/gallery-config';
import { db } from '@/db';

describe('R29-CRIT-1: admin-backfill-runner does not leak on early throw', () => {
    beforeEach(() => {
        // Reset the global state symbol so each test starts clean.
        const sym = Symbol.for('gallerykit.adminBackfillState');
        const g = globalThis as Record<symbol, unknown>;
        g[sym] = {
            running: false,
            lastQueuedCount: 0,
            completedRuns: 0,
            lastError: null,
        };

        queryMock.mockReset();
        releaseMock.mockReset();

        // Advisory lock acquire returns success.
        // Order of queries the runner will issue on the lock connection:
        //   1) SELECT GET_LOCK(?, 0) AS acquired   → return { acquired: 1 }
        //   2) SELECT RELEASE_LOCK(?)              → return ok
        queryMock.mockImplementation(async (sqlText: string) => {
            if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) {
                return [[{ acquired: 1 }]];
            }
            if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) {
                return [[{ released: 1 }]];
            }
            return [[]];
        });
    });

    it('releases lock, connection, and state.running on getGalleryConfig() rejection', async () => {
        // db.execute is called by fetchCandidates() (count → fetch). Return one
        // synthetic candidate row so the trigger reaches the runner handoff.
        (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
            return [
                [
                    {
                        id: 1,
                        filename_original: 'original-1.jpg',
                        filename_avif: 'a.avif',
                        filename_webp: 'a.webp',
                        filename_jpeg: 'a.jpg',
                        icc_profile_name: null,
                        color_primaries: null,
                        width: 100,
                    },
                ],
            ];
        });

        // Make getGalleryConfig blow up so the runner takes the early-throw
        // path the previous code couldn't recover from.
        (getGalleryConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('boom: admin_settings row missing'),
        );

        const result = await triggerAdminBackfill();
        // The trigger queues successfully — the rejection happens in the
        // fire-and-forget runner.
        expect(result.status).toBe('queued');

        // Wait for the fire-and-forget rejection to propagate through the
        // finally block. setImmediate × 2 is enough for the catch+finally to
        // run (one tick for the await, one for the .catch() handler).
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        const state = readAdminBackfillState();
        expect(state.running).toBe(false);
        // R29-CRIT-1 acceptance: lastError populated, not silently null.
        expect(state.lastError).toBeTruthy();
        expect(state.lastError).toContain('boom');

        // Lock connection released back to the pool.
        expect(releaseMock).toHaveBeenCalled();

        // RELEASE_LOCK actually issued before the connection went back.
        const releaseLockCall = queryMock.mock.calls.find(
            (call) => typeof call[0] === 'string' && call[0].includes('RELEASE_LOCK'),
        );
        expect(releaseLockCall).toBeDefined();
    });

    it('does not poison state — a second trigger after a failure is not stuck on already_running', async () => {
        (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => [
            [
                {
                    id: 1,
                    filename_original: 'original-1.jpg',
                    filename_avif: 'a.avif',
                    filename_webp: 'a.webp',
                    filename_jpeg: 'a.jpg',
                    icc_profile_name: null,
                    color_primaries: null,
                    width: 100,
                },
            ],
        ]);

        (getGalleryConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

        const first = await triggerAdminBackfill();
        expect(first.status).toBe('queued');
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        // Second trigger: state.running should be back to false so the trigger
        // does NOT short-circuit on the in-process `running` flag. Mock a
        // working config the second time; we don't care about the runner's
        // actual work, just that the trigger isn't poisoned.
        (getGalleryConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            imageQualityWebp: 80,
            imageQualityAvif: 60,
            imageQualityJpeg: 80,
            imageSizes: [640],
            forceSrgbDerivatives: false,
            wideGamutJpegChroma: '4:4:4' as const,
            avifEffort: 6,
            sdrJpegChroma: '4:2:0' as const,
            wideGamutMaxSourcePixels: 50_000_000,
        });

        const second = await triggerAdminBackfill();
        expect(second.status).toBe('queued');
    });
});
