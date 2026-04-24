import { afterEach, describe, expect, it, vi } from 'vitest';

const originalMaxFiles = process.env.UPLOAD_MAX_FILES_PER_WINDOW;

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
});
