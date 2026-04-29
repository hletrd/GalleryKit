import { afterEach, describe, expect, it, vi } from 'vitest';

const originalMaxFiles = process.env.UPLOAD_MAX_FILES_PER_WINDOW;
const originalBodyMax = process.env.NEXT_UPLOAD_BODY_MAX_BYTES;

async function importUploadLimits() {
    vi.resetModules();
    return import('@/lib/upload-limits');
}

describe('upload limits', () => {
    afterEach(() => {
        if (originalMaxFiles === undefined) {
            delete process.env.UPLOAD_MAX_FILES_PER_WINDOW;
        } else {
            process.env.UPLOAD_MAX_FILES_PER_WINDOW = originalMaxFiles;
        }
        if (originalBodyMax === undefined) {
            delete process.env.NEXT_UPLOAD_BODY_MAX_BYTES;
        } else {
            process.env.NEXT_UPLOAD_BODY_MAX_BYTES = originalBodyMax;
        }
        vi.resetModules();
    });

    it('uses the documented 100-file default when unset', async () => {
        delete process.env.UPLOAD_MAX_FILES_PER_WINDOW;

        const { UPLOAD_MAX_FILES_PER_WINDOW } = await importUploadLimits();

        expect(UPLOAD_MAX_FILES_PER_WINDOW).toBe(100);
    });

    it('honors a positive UPLOAD_MAX_FILES_PER_WINDOW override', async () => {
        process.env.UPLOAD_MAX_FILES_PER_WINDOW = '42';

        const { UPLOAD_MAX_FILES_PER_WINDOW } = await importUploadLimits();

        expect(UPLOAD_MAX_FILES_PER_WINDOW).toBe(42);
    });

    it('falls back to the safe default for invalid file-count overrides', async () => {
        process.env.UPLOAD_MAX_FILES_PER_WINDOW = '0';

        const { UPLOAD_MAX_FILES_PER_WINDOW } = await importUploadLimits();

        expect(UPLOAD_MAX_FILES_PER_WINDOW).toBe(100);
    });

    it('sizes the default Server Action body cap for the largest upload/restore surface plus overhead', async () => {
        delete process.env.NEXT_UPLOAD_BODY_MAX_BYTES;

        const {
            MAX_RESTORE_FILE_BYTES,
            MAX_UPLOAD_FILE_BYTES,
            NEXT_SERVER_ACTION_BODY_SIZE_LIMIT,
            SERVER_ACTION_BODY_OVERHEAD_BYTES,
            SERVER_ACTION_UPLOAD_BODY_BYTES,
        } = await importUploadLimits();

        expect(SERVER_ACTION_UPLOAD_BODY_BYTES).toBe(Math.max(MAX_UPLOAD_FILE_BYTES, MAX_RESTORE_FILE_BYTES) + SERVER_ACTION_BODY_OVERHEAD_BYTES);
        expect(SERVER_ACTION_UPLOAD_BODY_BYTES).toBeGreaterThan(MAX_RESTORE_FILE_BYTES);
        expect(NEXT_SERVER_ACTION_BODY_SIZE_LIMIT).toBe('266mb');
    });
});
