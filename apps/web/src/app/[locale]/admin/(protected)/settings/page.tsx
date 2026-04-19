import { getGallerySettingsAdmin } from '@/app/actions/settings';
import { SettingsClient } from './settings-client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const result = await getGallerySettingsAdmin();
    const settings = result.success ? result.settings : {};

    return <SettingsClient initialSettings={settings} />;
}
