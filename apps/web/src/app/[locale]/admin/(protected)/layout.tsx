import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isAdmin } from '@/app/actions/auth';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';
import { localizePath } from '@/lib/locale-path';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export default async function ProtectedLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    if (isRestoreMaintenanceActive()) {
        const t = await getTranslations('common');
        return <PublicRestoreMaintenance title={t('restoreMaintenanceTitle')} body={t('restoreMaintenanceBody')} />;
    }

    if (!(await isAdmin())) {
        redirect(localizePath(locale, '/admin'));
    }

    return <>{children}</>;
}
