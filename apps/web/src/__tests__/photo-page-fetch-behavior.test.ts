import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getImageCachedMock,
    getImageForViewerCachedMock,
    getSeoSettingsMock,
    isAdminMock,
    getLocaleMock,
    getTranslationsMock,
    getGalleryConfigMock,
    recordPhotoViewMock,
    isRestoreMaintenanceActiveMock,
    getPublicRestoreMaintenanceMetadataMock,
} = vi.hoisted(() => ({
    getImageCachedMock: vi.fn(),
    getImageForViewerCachedMock: vi.fn(),
    getSeoSettingsMock: vi.fn(),
    isAdminMock: vi.fn(),
    getLocaleMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    recordPhotoViewMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
    getPublicRestoreMaintenanceMetadataMock: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getImageCached: getImageCachedMock,
    getImageForViewerCached: getImageForViewerCachedMock,
    getSeoSettings: getSeoSettingsMock,
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
}));

vi.mock('next-intl/server', () => ({
    getLocale: getLocaleMock,
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('@/app/actions/public', () => ({
    recordPhotoView: recordPhotoViewMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

vi.mock('@/lib/public-restore-maintenance-metadata', () => ({
    getPublicRestoreMaintenanceMetadata: getPublicRestoreMaintenanceMetadataMock,
}));

vi.mock('next/dynamic', () => ({
    default: () => () => null,
}));

vi.mock('next/link', () => ({
    default: () => null,
}));

vi.mock('next/navigation', () => ({
    notFound: () => {
        throw new Error('notFound');
    },
}));

import PhotoPage from '@/app/[locale]/(public)/p/[id]/page';

const sampleImage = {
    id: 123,
    title: 'Golden frame',
    description: null,
    tags: [{ id: 1, name: 'Seoul', slug: 'seoul' }],
    topic: null,
    topic_label: null,
    filename_jpeg: 'golden.jpg',
    filename_avif: 'golden.avif',
    filename_webp: 'golden.webp',
    width: 1600,
    height: 1000,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    camera_model: null,
    lens_model: null,
    iso: null,
    f_number: null,
    exposure_time: null,
    prevId: null,
    nextId: null,
    prevImage: null,
    nextImage: null,
};

describe('PhotoPage public/admin image fetch behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getLocaleMock.mockResolvedValue('en');
        getTranslationsMock.mockResolvedValue((key: string, values?: Record<string, string | number>) => {
            if (key === 'titleWithId') return `Photo ${values?.id ?? ''}`.trim();
            return key;
        });
        getSeoSettingsMock.mockResolvedValue({
            title: 'GalleryKit',
            description: 'Gallery',
            nav_title: 'GalleryKit',
            author: 'Photographer',
            locale: 'en_US',
            url: 'https://example.com',
            og_image_url: null,
        });
        getGalleryConfigMock.mockResolvedValue({
            imageSizes: [640, 1536, 2048],
            slideshowIntervalSeconds: 5,
            forceShowColorChips: false,
            forceSrgbDerivatives: false,
            semanticSearchMode: 'disabled',
        });
        recordPhotoViewMock.mockResolvedValue(undefined);
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        getPublicRestoreMaintenanceMetadataMock.mockResolvedValue(null);
    });

    it('uses the public cached image only for anonymous photo renders', async () => {
        getImageCachedMock.mockResolvedValue(sampleImage);
        isAdminMock.mockResolvedValue(false);

        await expect(PhotoPage({ params: Promise.resolve({ id: '123' }) })).resolves.toBeTruthy();

        expect(getImageCachedMock).toHaveBeenCalledWith(123);
        expect(getImageForViewerCachedMock).not.toHaveBeenCalled();
        expect(recordPhotoViewMock).toHaveBeenCalledWith(123);
        expect(getImageCachedMock.mock.invocationCallOrder[0])
            .toBeLessThan(isAdminMock.mock.invocationCallOrder[0]);
    });

    it('fetches admin viewer fields only for authenticated photo renders with a public row', async () => {
        const adminImage = { ...sampleImage, filename_original: 'original.nef' };
        getImageCachedMock.mockResolvedValue(sampleImage);
        getImageForViewerCachedMock.mockResolvedValue(adminImage);
        isAdminMock.mockResolvedValue(true);

        await expect(PhotoPage({ params: Promise.resolve({ id: '123' }) })).resolves.toBeTruthy();

        expect(getImageCachedMock).toHaveBeenCalledWith(123);
        expect(getImageForViewerCachedMock).toHaveBeenCalledWith(123, true);
        expect(recordPhotoViewMock).toHaveBeenCalledWith(123);
        expect(getImageCachedMock.mock.invocationCallOrder[0])
            .toBeLessThan(getImageForViewerCachedMock.mock.invocationCallOrder[0]);
    });
});
