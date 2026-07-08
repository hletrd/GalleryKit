import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isAdmin: vi.fn(),
    isRestoreMaintenanceActive: vi.fn(),
    redirect: vi.fn((target: string) => {
        throw new Error(`redirect:${target}`);
    }),
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: mocks.isAdmin,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: mocks.isRestoreMaintenanceActive,
}));

vi.mock('next/navigation', () => ({
    redirect: mocks.redirect,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}.${key}`),
}));

import AdminPage from '@/app/[locale]/admin/page';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';

describe('admin login restore-maintenance gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isAdmin.mockResolvedValue(false);
        mocks.isRestoreMaintenanceActive.mockReturnValue(false);
    });

    it('renders the login form when maintenance is inactive and no admin session is present', async () => {
        const result = await AdminPage({ params: Promise.resolve({ locale: 'en' }) });

        expect(result.type.name).toBe('LoginForm');
        expect(mocks.isAdmin).toHaveBeenCalledTimes(1);
    });

    it('renders maintenance before probing the admin session', async () => {
        mocks.isRestoreMaintenanceActive.mockReturnValue(true);

        const result = await AdminPage({ params: Promise.resolve({ locale: 'ko' }) });

        expect(result.type).toBe(PublicRestoreMaintenance);
        expect(result.props).toEqual({
            title: 'common.restoreMaintenanceTitle',
            body: 'common.restoreMaintenanceBody',
        });
        expect(mocks.isAdmin).not.toHaveBeenCalled();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });
});
