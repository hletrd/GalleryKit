import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revalidatePath } = vi.hoisted(() => ({
    revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({
    revalidatePath,
}));

import {
    ADMIN_SURFACE_REVALIDATION_PATHS,
    getLocalizedPathVariants,
    revalidateAdminSurfaces,
    revalidateAllAppData,
    revalidateLocalizedPaths,
} from '@/lib/revalidation';

describe('getLocalizedPathVariants', () => {
    it('expands unprefixed paths to every locale plus the original path', () => {
        expect(getLocalizedPathVariants('/')).toEqual(['/', '/en', '/ko']);
        expect(getLocalizedPathVariants('/admin/dashboard')).toEqual([
            '/admin/dashboard',
            '/en/admin/dashboard',
            '/ko/admin/dashboard',
        ]);
    });

    it('does not duplicate paths that are already locale-prefixed', () => {
        expect(getLocalizedPathVariants('/ko/admin/dashboard')).toEqual(['/ko/admin/dashboard']);
    });
});

describe('revalidateLocalizedPaths', () => {
    beforeEach(() => {
        revalidatePath.mockClear();
    });

    it('revalidates each localized variant only once', () => {
        revalidateLocalizedPaths('/admin/dashboard', '/admin/dashboard', '/ko/admin/dashboard');

        expect(revalidatePath).toHaveBeenCalledTimes(3);
        expect(revalidatePath).toHaveBeenNthCalledWith(1, '/admin/dashboard');
        expect(revalidatePath).toHaveBeenNthCalledWith(2, '/en/admin/dashboard');
        expect(revalidatePath).toHaveBeenNthCalledWith(3, '/ko/admin/dashboard');
    });

    it('revalidates locale-aware admin restore surfaces', () => {
        revalidateAdminSurfaces();

        expect(ADMIN_SURFACE_REVALIDATION_PATHS).toEqual([
            '/',
            '/admin/dashboard',
            '/admin/categories',
            '/admin/tags',
        ]);
        expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
            '/',
            '/en',
            '/ko',
            '/admin/dashboard',
            '/en/admin/dashboard',
            '/ko/admin/dashboard',
            '/admin/categories',
            '/en/admin/categories',
            '/ko/admin/categories',
            '/admin/tags',
            '/en/admin/tags',
            '/ko/admin/tags',
        ]);
    });

    it('can invalidate the full app tree after a database restore', () => {
        revalidateAllAppData();

        expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });
});
