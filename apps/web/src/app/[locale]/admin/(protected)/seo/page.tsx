import { getSeoSettingsAdmin } from '@/app/actions/seo';
import { SeoSettingsClient } from './seo-client';
import { getTranslations } from 'next-intl/server';
import { adminRouteMetadata } from '../../admin-metadata';

export const dynamic = 'force-dynamic';

export const generateMetadata = () => adminRouteMetadata('seo');

export default async function SeoPage() {
    const [result, t] = await Promise.all([
        getSeoSettingsAdmin(),
        getTranslations('seo'),
    ]);

    if (!result.success) {
        return (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-text">
                {t('loadFailed')}
            </div>
        );
    }

    return <SeoSettingsClient initialSettings={result.settings} />;
}
