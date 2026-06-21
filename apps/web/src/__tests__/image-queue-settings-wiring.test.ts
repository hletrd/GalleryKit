/**
 * CR-R9C6-01 (run-9 c6) — upload-path processing-settings wiring pin.
 *
 * BUG: the queue handler resolved 6 admin-tunable processing settings
 * (forceSrgbDerivatives, wideGamutJpegChroma, avifEffort, sdrJpegChroma,
 * wideGamutMaxSourcePixels, autoAltTextEnabled) ONLY inside the
 * `if (!quality && !imageSizes)` config-load gate. The upload path always
 * supplies a non-null `quality` object, so that gate NEVER enters on a real
 * upload, and those 6 settings silently fell back to process-image defaults —
 * diverging from the same photo after a backfill (which DOES honor them).
 *
 * FIX: the 6 settings are now carried on `ImageProcessingJob` (snapshotted at
 * upload time) and seeded into the handler locals before the gate, so a fresh
 * upload honors them WITHOUT entering the config-load block.
 *
 * This test drives the PQueue job closure end-to-end (the p-queue mock captures
 * and synchronously runs the task) and asserts processImageFormats receives the
 * job's NON-DEFAULT settings — not the process-image fallbacks. Proven
 * non-vacuous: reverting the handler to resolve the 6 only inside the gate
 * flips the forceSrgbDerivatives / chroma / effort / pixel assertions RED
 * (the job-supplied values would be ignored).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queueAddMock, getConnectionMock, processImageFormatsMock, getGalleryConfigMock } =
    vi.hoisted(() => ({
        queueAddMock: vi.fn(),
        getConnectionMock: vi.fn(),
        processImageFormatsMock: vi.fn(),
        getGalleryConfigMock: vi.fn(),
    }));

vi.mock('p-queue', () => ({
    default: class MockPQueue {
        add = queueAddMock;
        start = vi.fn();
    },
}));

// db.select() → claim check returns a pending row; db.update() → processed mark
// returns affectedRows: 1 (not deleted-during-processing).
const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 42, topic: null }]),
};
const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
};

vi.mock('@/db', () => ({
    connection: { getConnection: getConnectionMock },
    db: {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => updateChain),
    },
    images: { id: 'id', processed: 'processed' },
    sessions: {},
}));

vi.mock('@/lib/process-image', () => ({
    processImageFormats: processImageFormatsMock,
    deleteImageVariants: vi.fn(),
    IMAGE_PIPELINE_VERSION: 7,
}));

vi.mock('@/lib/upload-paths', () => ({
    UPLOAD_DIR_WEBP: '/tmp/webp',
    UPLOAD_DIR_AVIF: '/tmp/avif',
    UPLOAD_DIR_JPEG: '/tmp/jpeg',
    resolveOriginalUploadPath: vi.fn(async (fn: string) => `/tmp/original/${fn}`),
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('@/lib/queue-shutdown', () => ({
    drainProcessingQueueForShutdown: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ purgeOldBuckets: vi.fn() }));
vi.mock('@/lib/audit', () => ({ purgeOldAuditLog: vi.fn() }));
vi.mock('@/lib/process-topic-image', () => ({ cleanOrphanedTopicTempFiles: vi.fn() }));
vi.mock('@/lib/restore-maintenance', () => ({ isRestoreMaintenanceActive: vi.fn(() => false) }));
vi.mock('@/lib/caption', () => ({ generateCaption: vi.fn(async () => null) }));

// image-queue imports `fs from 'fs/promises'` (default import): access()
// resolves (original exists); stat() reports non-zero size so the 3-format
// verification passes; the handler then reaches db.update.
vi.mock('fs/promises', async () => {
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    return {
        ...actual,
        default: {
            ...actual,
            access: vi.fn().mockResolvedValue(undefined),
            stat: vi.fn().mockResolvedValue({ size: 1234 }),
        },
        access: vi.fn().mockResolvedValue(undefined),
        stat: vi.fn().mockResolvedValue({ size: 1234 }),
    };
});

import { enqueueImageProcessing, getProcessingQueueState } from '@/lib/image-queue';

// A lock connection whose advisory GET_LOCK returns 1 (claim acquired).
function makeLockConnection() {
    return {
        query: vi.fn(async (sql: string) => {
            if (/GET_LOCK/i.test(sql)) return [[{ acquired: 1 }]];
            if (/RELEASE_LOCK/i.test(sql)) return [[{ released: 1 }]];
            return [[]];
        }),
        release: vi.fn(),
    };
}

async function runQueuedTask() {
    const task = queueAddMock.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
    expect(task, 'a queue task must have been enqueued').toBeDefined();
    await task!();
}

describe('CR-R9C6-01: upload-path processing settings reach processImageFormats', () => {
    beforeEach(() => {
        queueAddMock.mockReset();
        processImageFormatsMock.mockReset();
        processImageFormatsMock.mockResolvedValue({ wasDownscaled: false, avif10bit: false });
        getGalleryConfigMock.mockReset();
        // Default config (used by the fire-and-forget embedding hook at the end
        // of the handler, which calls getGalleryConfig for semanticSearchMode).
        // These values DIFFER from both the job (test 1) and the process-image
        // fallbacks, so if the upload-path fix regressed and the gate wrongly
        // pulled config, the arg assertions below would show THESE values.
        getGalleryConfigMock.mockResolvedValue({
            semanticSearchMode: 'disabled',
            imageQualityWebp: 50,
            imageQualityAvif: 50,
            imageQualityJpeg: 50,
            imageSizes: [999],
            autoAltTextEnabled: false,
            forceSrgbDerivatives: false,
            wideGamutJpegChroma: '4:4:4',
            avifEffort: 9,
            sdrJpegChroma: '4:4:4',
            wideGamutMaxSourcePixels: 99_000_000,
        });
        getConnectionMock.mockReset();
        getConnectionMock.mockResolvedValue(makeLockConnection());
        const state = getProcessingQueueState();
        state.enqueued.clear();
        state.retryCounts.clear();
        state.claimRetryCounts.clear();
        state.shuttingDown = false;
    });

    it('forwards the job-supplied 6 settings (NOT process-image defaults / config) to processImageFormats', async () => {
        // Non-default values for all 6, distinct from BOTH the process-image
        // fallbacks (false / '4:4:4' / 6 / '4:2:0' / 50M / false) AND the
        // default config in beforeEach. With the bug present (settings resolved
        // only inside the `if (!quality && !imageSizes)` gate), the gate would
        // not enter (quality is supplied) → process-image defaults reach the
        // encoder, NOT these job values → these assertions go RED.
        enqueueImageProcessing({
            id: 42,
            filenameOriginal: 'orig.jpg',
            filenameWebp: 'out.webp',
            filenameAvif: 'out.avif',
            filenameJpeg: 'out.jpg',
            width: 1200,
            quality: { webp: 80, avif: 70, jpeg: 88 },
            imageSizes: [640, 1536],
            forceSrgbDerivatives: true,
            wideGamutJpegChroma: '4:2:0',
            avifEffort: 3,
            sdrJpegChroma: '4:2:2',
            wideGamutMaxSourcePixels: 20_000_000,
            autoAltTextEnabled: true,
        });

        await runQueuedTask();

        expect(processImageFormatsMock).toHaveBeenCalledTimes(1);
        const args = processImageFormatsMock.mock.calls[0];
        // processImageFormats(inputPath, webp, avif, jpeg, width, quality,
        //   sizes, iccProfileName, forceSrgbDerivatives, signals,
        //   wideGamutJpegChroma, avifEffort, sdrJpegChroma, wideGamutMaxSourcePixels)
        expect(args[5], 'quality (job)').toEqual({ webp: 80, avif: 70, jpeg: 88 });
        expect(args[6], 'imageSizes (job)').toEqual([640, 1536]);
        expect(args[8], 'forceSrgbDerivatives (job)').toBe(true);
        expect(args[10], 'wideGamutJpegChroma (job)').toBe('4:2:0');
        expect(args[11], 'avifEffort (job)').toBe(3);
        expect(args[12], 'sdrJpegChroma (job)').toBe('4:2:2');
        expect(args[13], 'wideGamutMaxSourcePixels (job)').toBe(20_000_000);
    });

    it('bootstrap-shaped job (no quality/imageSizes) still loads all settings from config', async () => {
        // Bootstrap path omits quality + imageSizes, so the gate MUST open and
        // pull every setting from current config (this path was always correct;
        // pin it so the fix did not regress it). Use distinctive config values.
        getGalleryConfigMock.mockResolvedValue({
            semanticSearchMode: 'disabled',
            imageQualityWebp: 91,
            imageQualityAvif: 86,
            imageQualityJpeg: 92,
            imageSizes: [640, 2048],
            autoAltTextEnabled: true,
            forceSrgbDerivatives: true,
            wideGamutJpegChroma: '4:2:2',
            avifEffort: 4,
            sdrJpegChroma: '4:2:0',
            wideGamutMaxSourcePixels: 30_000_000,
        });

        enqueueImageProcessing({
            id: 42,
            filenameOriginal: 'orig.jpg',
            filenameWebp: 'out.webp',
            filenameAvif: 'out.avif',
            filenameJpeg: 'out.jpg',
            width: 1200,
            // no quality, no imageSizes → bootstrap shape
        });

        await runQueuedTask();

        expect(processImageFormatsMock).toHaveBeenCalledTimes(1);
        const args = processImageFormatsMock.mock.calls[0];
        expect(args[8], 'forceSrgbDerivatives (from config)').toBe(true);
        expect(args[10], 'wideGamutJpegChroma (from config)').toBe('4:2:2');
        expect(args[11], 'avifEffort (from config)').toBe(4);
        expect(args[12], 'sdrJpegChroma (from config)').toBe('4:2:0');
        expect(args[13], 'wideGamutMaxSourcePixels (from config)').toBe(30_000_000);
    });
});
