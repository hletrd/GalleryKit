import { getSeoSettingsAdmin } from '@/app/actions/seo';
import { SeoSettingsClient } from './seo-client';

export const dynamic = 'force-dynamic';

export default async function SeoPage() {
    const result = await getSeoSettingsAdmin();
    const settings = result.success ? result.settings : {
        seo_title: '',
        seo_description: '',
        seo_nav_title: '',
        seo_author: '',
        seo_locale: '',
        seo_og_image_url: '',
    };

    return <SeoSettingsClient initialSettings={settings} />;
}
