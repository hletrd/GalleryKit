import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    isAdmin: vi.fn(),
    getCurrentUser: vi.fn(),
    isRestoreMaintenanceActive: vi.fn(),
    redirect: vi.fn((target: string) => {
        throw new Error(`redirect:${target}`);
    }),
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: mocks.isAdmin,
    getCurrentUser: mocks.getCurrentUser,
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
import AdminLayout from '@/app/[locale]/admin/layout';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';

describe('protected admin restore-maintenance layout gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isAdmin.mockResolvedValue(true);
        mocks.getCurrentUser.mockResolvedValue({ id: 1, username: 'admin' });
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
        expect(mocks.isAdmin).not.toHaveBeenCalled();
    });

    it('renders restore maintenance before redirecting unauthenticated requests', async () => {
        mocks.isAdmin.mockResolvedValue(false);
        mocks.isRestoreMaintenanceActive.mockReturnValue(true);

        const result = await ProtectedLayout({
            children: <div />,
            params: Promise.resolve({ locale: 'ko' }),
        });

        expect(result.type).toBe(PublicRestoreMaintenance);
        expect(mocks.isAdmin).not.toHaveBeenCalled();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it('parent admin layout skips current-user lookup while restore maintenance is active', async () => {
        mocks.isRestoreMaintenanceActive.mockReturnValue(true);
        const child = <div data-testid="admin-child" />;

        const result = await AdminLayout({ children: child });

        expect(result.props.children[0]).toBeNull();
        // The admin <main> wraps its children in a centered max-width container
        // (`mx-auto`), so the child sits one level deeper than the <main>.
        expect(result.props.children[1].props.children.props.children).toBe(child);
        expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    });
});
