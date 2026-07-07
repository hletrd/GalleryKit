import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { getSeoSettings } from '@/lib/data';
import { localizeUrl } from '@/lib/locale-path';

export async function generateMetadata(): Promise<Metadata> {
    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('aboutGalleryKit'),
        getSeoSettings(),
    ]);

    return {
        title: t('title'),
        description: t('description'),
        alternates: { canonical: localizeUrl(seo.url, locale, '/about-gallerykit') },
    };
}

export default async function AboutGalleryKitPage() {
    const t = await getTranslations('aboutGalleryKit');

    return (
        <article className="mx-auto max-w-3xl space-y-8 py-4">
            <header className="space-y-3">
                <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
                <p className="text-base leading-7 text-muted-foreground">{t('description')}</p>
            </header>

            <section className="space-y-3">
                <h2 className="text-xl font-semibold">{t('forTitle')}</h2>
                <p className="leading-7 text-muted-foreground">{t('forBody')}</p>
            </section>

            <section className="space-y-3">
                <h2 className="text-xl font-semibold">{t('operatorTitle')}</h2>
                <p className="leading-7 text-muted-foreground">{t('operatorBody')}</p>
            </section>

            <section className="space-y-3">
                <h2 className="text-xl font-semibold">{t('notForTitle')}</h2>
                <p className="leading-7 text-muted-foreground">{t('notForBody')}</p>
            </section>
        </article>
    );
}
