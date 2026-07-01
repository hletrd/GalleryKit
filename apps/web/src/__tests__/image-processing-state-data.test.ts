import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    selectMock,
    fromMock,
    whereMock,
    limitMock,
} = vi.hoisted(() => {
    const limitMock = vi.fn();
    const whereMock = vi.fn(() => ({ limit: limitMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));

    return { selectMock, fromMock, whereMock, limitMock };
});

vi.mock('@/db', async () => {
    const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
    return {
        ...schema,
        db: {
            select: selectMock,
        },
    };
});

import { images } from '@/db';
import { getImageProcessingState } from '@/lib/data';

describe('getImageProcessingState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects invalid ids before querying', async () => {
        await expect(getImageProcessingState(0)).resolves.toBeNull();
        await expect(getImageProcessingState(1.5)).resolves.toBeNull();

        expect(selectMock).not.toHaveBeenCalled();
    });

    it('returns pending rows instead of filtering them out', async () => {
        limitMock.mockResolvedValueOnce([{ id: 42, processed: false }]);

        await expect(getImageProcessingState(42)).resolves.toEqual({
            id: 42,
            processed: false,
        });

        expect(selectMock).toHaveBeenCalledWith({
            id: images.id,
            processed: images.processed,
        });
        expect(fromMock).toHaveBeenCalledWith(images);
        expect(whereMock).toHaveBeenCalledTimes(1);
        expect(limitMock).toHaveBeenCalledWith(1);
    });

    it('returns processed rows and permanent misses distinctly', async () => {
        limitMock
            .mockResolvedValueOnce([{ id: 7, processed: true }])
            .mockResolvedValueOnce([]);

        await expect(getImageProcessingState(7)).resolves.toEqual({
            id: 7,
            processed: true,
        });
        await expect(getImageProcessingState(404)).resolves.toBeNull();
    });
});
