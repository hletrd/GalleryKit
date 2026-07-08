import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import ProtectedLayout from '@/app/[locale]/admin/(protected)/layout';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';

describe('protected admin restore-maintenance layout gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isAdmin.mockResolvedValue(true);
        mocks.isRestoreMaintenanceActive.mockReturnValue(false);
    });

    it('renders children when authenticated and restore maintenance is inactive', async () => {
        const child = <div data-testid="admin-child" />;

        const result = await ProtectedLayout({
            children: child,
            params: Promise.resolve({ locale: 'en' }),
        });

        expect(result.props.children).toBe(child);
    });

    it('renders a non-querying maintenance shell instead of protected children during restore', async () => {
        const child = <div data-testid="admin-child" />;
        mocks.isRestoreMaintenanceActive.mockReturnValue(true);

        const result = await ProtectedLayout({
            children: child,
            params: Promise.resolve({ locale: 'en' }),
        });

        expect(result.type).toBe(PublicRestoreMaintenance);
        expect(result.props).toEqual({
            title: 'common.restoreMaintenanceTitle',
            body: 'common.restoreMaintenanceBody',
        });
    });

    it('still redirects unauthenticated requests before checking restore maintenance', async () => {
        mocks.isAdmin.mockResolvedValue(false);
        mocks.isRestoreMaintenanceActive.mockReturnValue(true);

        await expect(ProtectedLayout({
            children: <div />,
            params: Promise.resolve({ locale: 'ko' }),
        })).rejects.toThrow('redirect:/ko/admin');
        expect(mocks.isRestoreMaintenanceActive).not.toHaveBeenCalled();
    });
});
