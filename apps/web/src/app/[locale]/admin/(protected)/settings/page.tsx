import { getGallerySettingsAdmin } from '@/app/actions/settings';
import { SettingsClient } from './settings-client';
import { getTranslations } from 'next-intl/server';
import { getImageCount } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const [result, t, imageCount] = await Promise.all([
        getGallerySettingsAdmin(),
        getTranslations('settings'),
        getImageCount(undefined, undefined, { includeUnprocessed: true }),
    ]);

    if (!result.success) {
        return (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {t('loadFailed')}
            </div>
        );
    }

    return <SettingsClient initialSettings={result.settings} hasExistingImages={imageCount > 0} />;
}
