import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export async function getPublicRestoreMaintenanceMetadata(): Promise<Metadata | null> {
    if (!isRestoreMaintenanceActive()) return null;

    const t = await getTranslations('common');
    return {
        title: t('restoreMaintenanceTitle'),
        description: t('restoreMaintenanceBody'),
        robots: {
            index: false,
            follow: false,
            nocache: true,
        },
    };
}
