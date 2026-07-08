import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isAdmin } from '@/app/actions/auth';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';
import { LoginForm } from './login-form';
import { localizePath } from '@/lib/locale-path';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { adminRouteMetadata } from './admin-metadata';

export const dynamic = 'force-dynamic';

export const generateMetadata = () => adminRouteMetadata('admin');

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    if (isRestoreMaintenanceActive()) {
        const t = await getTranslations('common');
        return <PublicRestoreMaintenance title={t('restoreMaintenanceTitle')} body={t('restoreMaintenanceBody')} />;
    }

    // If already logged in, redirect to dashboard
    let alreadyAdmin = false;
    try {
        alreadyAdmin = await isAdmin();
    } catch (err) {
        console.error('Admin login: failed to check current admin session', err);
    }
    if (alreadyAdmin) {
        redirect(localizePath(locale, '/admin/dashboard'));
    }

    return <LoginForm />;
}
