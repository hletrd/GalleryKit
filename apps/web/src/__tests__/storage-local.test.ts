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

    it('applies the same key validation before generating public URLs', async () => {
        const storage = new LocalStorageBackend();

        await expect(storage.getUrl('')).rejects.toThrow(/Invalid storage key/);
        await expect(storage.getUrl('/jpeg/photo.jpg')).rejects.toThrow(/Invalid storage key/);
        await expect(storage.getUrl('jpeg/../../secret.txt')).rejects.toThrow(/Invalid storage key/);
        await expect(storage.getUrl('original/photo.jpg')).rejects.toThrow(/Private original uploads/);
        await expect(storage.getUrl('jpeg/hello world.jpg')).resolves.toBe('/uploads/jpeg/hello%20world.jpg');
    });
});
