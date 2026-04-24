import { describe, expect, it, vi } from 'vitest';
const { uploadRoot } = vi.hoisted(() => ({
    uploadRoot: '/tmp/gallery-storage-local-test',
}));

vi.mock('@/lib/upload-paths', () => ({
    UPLOAD_ROOT: uploadRoot,
}));

import { LocalStorageBackend } from '@/lib/storage/local';

describe('LocalStorageBackend key validation', () => {
    it('rejects empty and dot keys before resolving to the upload root', async () => {
        const storage = new LocalStorageBackend();

        await expect(storage.readBuffer('')).rejects.toThrow(/Invalid storage key/);
        await expect(storage.readBuffer('   ')).rejects.toThrow(/Invalid storage key/);
        await expect(storage.readBuffer('.')).rejects.toThrow(/Invalid storage key/);
    });

    it('rejects traversal keys before filesystem access', async () => {
        const storage = new LocalStorageBackend();

        await expect(storage.readBuffer('..')).rejects.toThrow(/Invalid storage key/);
        await expect(storage.readBuffer('../secret.txt')).rejects.toThrow(/Invalid storage key|Path traversal blocked/);
        await expect(storage.readBuffer('safe/../../secret.txt')).rejects.toThrow(/Invalid storage key|Path traversal blocked/);
    });
});
