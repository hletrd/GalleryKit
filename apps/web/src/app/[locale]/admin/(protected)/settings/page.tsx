import { getGallerySettingsAdmin } from '@/app/actions/settings';
import { SettingsClient } from './settings-client';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const [result, t] = await Promise.all([
        getGallerySettingsAdmin(),
        getTranslations('settings'),
    ]);

    if (!result.success) {
        return (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {t('loadFailed')}
            </div>
        );
    }

    return <SettingsClient initialSettings={result.settings} />;
}
