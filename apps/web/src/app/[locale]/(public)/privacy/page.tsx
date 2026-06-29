import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import siteConfig from '@/site-config.json';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('privacy');
    return {
        title: t('title'),
        description: t('description'),
    };
}

export default async function PrivacyPage() {
    const t = await getTranslations('privacy');
    const hasGoogleAnalytics = /^(G-[A-Z0-9]+|UA-\d+-\d+)$/.test(siteConfig.google_analytics_id ?? '');

    return (
        <div className="mx-auto max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
            <div className="mt-6 space-y-5 text-sm leading-7 text-muted-foreground">
                <p>{t('intro')}</p>
                <section className="space-y-2">
                    <h2 className="text-lg font-medium text-foreground">{t('analyticsTitle')}</h2>
                    <p>{hasGoogleAnalytics ? t('analyticsEnabled') : t('analyticsDisabled')}</p>
                </section>
                <section className="space-y-2">
                    <h2 className="text-lg font-medium text-foreground">{t('metadataTitle')}</h2>
                    <p>{t('metadataBody')}</p>
                </section>
            </div>
        </div>
    );
}
