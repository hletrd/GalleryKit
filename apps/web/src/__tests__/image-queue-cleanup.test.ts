import { existsSync } from 'fs';
import { mkdtemp, mkdir, stat, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadQueueCleanup(dirs: { webp: string; avif: string; jpeg: string }) {
    vi.resetModules();
    delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for('gallerykit.imageProcessingQueue')];

    vi.doMock('p-queue', () => ({
        default: class MockPQueue {
            add = vi.fn();
            start = vi.fn();
        },
    }));
    vi.doMock('@/db', () => ({
        connection: { getConnection: vi.fn() },
        db: {},
        images: {},
        sessions: {},
        imageEmbeddings: {},
        // C2-08 (WP7): image-queue.ts now imports POOL_CONNECTION_LIMIT from @/db.
        POOL_CONNECTION_LIMIT: 10,
    }));
    vi.doMock('@/lib/process-image', () => ({
        processImageFormats: vi.fn(),
        deleteImageVariants: vi.fn(),
        IMAGE_PIPELINE_VERSION: 7,
    }));
    vi.doMock('@/lib/upload-paths', () => ({
        UPLOAD_DIR_WEBP: dirs.webp,
        UPLOAD_DIR_AVIF: dirs.avif,
        UPLOAD_DIR_JPEG: dirs.jpeg,
        resolveOriginalUploadPath: vi.fn(),
    }));
    vi.doMock('@/lib/gallery-config', () => ({
        getGalleryConfig: vi.fn(),
        // C2-10 (WP19): image-queue.ts's detached-context call sites now use
        // getGalleryConfigDetached instead of the request-cached export.
        getGalleryConfigDetached: vi.fn(),
    }));
    vi.doMock('@/lib/queue-shutdown', () => ({ drainProcessingQueueForShutdown: vi.fn() }));
    vi.doMock('@/lib/rate-limit', () => ({ purgeOldBuckets: vi.fn() }));
    vi.doMock('@/lib/audit', () => ({ purgeOldAuditLog: vi.fn() }));
    vi.doMock('@/lib/view-retention', () => ({ purgeOldViewEvents: vi.fn() }));
    vi.doMock('@/lib/process-topic-image', () => ({ cleanOrphanedTopicTempFiles: vi.fn() }));
    vi.doMock('@/lib/restore-maintenance', () => ({ isRestoreMaintenanceActive: vi.fn(() => false) }));
    vi.doMock('@/lib/advisory-locks', () => ({
        getImageProcessingLockName: vi.fn(),
        isAdvisoryLockAcquired: vi.fn(),
    }));
    vi.doMock('@/lib/caption-generator', () => ({ generateCaption: vi.fn() }));
    vi.doMock('@/lib/clip-inference', () => ({ embedImageStub: vi.fn() }));
    vi.doMock('@/lib/clip-embeddings', () => ({
        embeddingToBuffer: vi.fn(),
        STUB_MODEL_VERSION: 'stub',
        PRODUCTION_MODEL_VERSION: 'prod',
        SEMANTIC_SCAN_LIMIT: 2000,
    }));
    vi.doMock('@/lib/clip-model', () => ({ embedImageReal: vi.fn() }));

    return import('@/lib/image-queue');
}

describe('cleanOrphanedTmpFiles', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        vi.doUnmock('p-queue');
        vi.doUnmock('@/db');
    });

    it('preserves fresh active temp files and removes stale tmp/bak leftovers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'gk-queue-cleanup-'));
        const dirs = {
            webp: join(root, 'webp'),
            avif: join(root, 'avif'),
            jpeg: join(root, 'jpeg'),
        };
        await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));

        const freshTmp = join(dirs.webp, 'active.webp.tmp');
        const staleTmp = join(dirs.webp, 'orphan.webp.tmp');
        const staleBak = join(dirs.avif, 'orphan.avif.bak');
        const normalFile = join(dirs.jpeg, 'photo.jpg');
        await Promise.all([
            writeFile(freshTmp, 'fresh'),
            writeFile(staleTmp, 'stale'),
            writeFile(staleBak, 'stale backup'),
            writeFile(normalFile, 'normal'),
        ]);

        const queue = await loadQueueCleanup(dirs);
        const now = Date.now();
        const staleDate = new Date(now - queue.ORPHANED_DERIVATIVE_TEMP_MIN_AGE_MS - 1000);
        await Promise.all([
            utimes(staleTmp, staleDate, staleDate),
            utimes(staleBak, staleDate, staleDate),
        ]);

        await queue.cleanOrphanedTmpFiles(now);

        expect(existsSync(freshTmp)).toBe(true);
        expect(existsSync(staleTmp)).toBe(false);
        expect(existsSync(staleBak)).toBe(false);
        expect((await stat(normalFile)).isFile()).toBe(true);
    });
});
