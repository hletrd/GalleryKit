import { describe, expect, it } from 'vitest';

import { createPendingUploadItems } from '@/components/upload-dropzone';

describe('createPendingUploadItems', () => {
    it('assigns different IDs to distinct files even when metadata matches', () => {
        const first = new File(['a'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1234 });
        const second = new File(['b'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1234 });

        const ids = ['upload-1', 'upload-2'];
        const items = createPendingUploadItems([first, second], () => ids.shift()!);

        expect(items).toEqual([
            { id: 'upload-1', file: first },
            { id: 'upload-2', file: second },
        ]);
        expect(items[0].id).not.toBe(items[1].id);
    });
});
