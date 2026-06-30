'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useTranslation } from '@/components/i18n-provider';
import { localizePath } from '@/lib/locale-path';

export default function Error({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { t, locale } = useTranslation();

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const siteTitle = document.documentElement.dataset.galleryTitle?.trim();
        document.title = siteTitle ? `${t('error.title')} | ${siteTitle}` : t('error.title');
    }, [t]);

    return (
        <div className="flex min-h-dvh flex-col bg-background">
            <header className="border-b bg-background/90 backdrop-blur-xl">
                <nav aria-label={t('nav.label')} className="container mx-auto flex min-h-16 items-center justify-between px-4">
                    <Link
                        href={localizePath(locale, '/')}
                        className="inline-flex min-h-11 items-center rounded-md text-xl font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        {t('nav.home')}
                    </Link>
                </nav>
            </header>
            <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 focus:outline-none" role="main">
                <section className="flex w-full max-w-md flex-col items-center gap-6 rounded-lg border bg-card p-6 text-center shadow-sm" aria-labelledby="route-error-title">
                    {/* AGG-R7-03 (run-7 c1): a single visible readable <h1>. */}
                    <h1 id="route-error-title" className="text-3xl font-semibold tracking-tight">{t('error.title')}</h1>
                    <p className="text-lg text-muted-foreground">
                        {t('error.description')}
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            onClick={reset}
                            className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {t('error.tryAgain')}
                        </button>
                        <Link
                            href={localizePath(locale, '/')}
                            className="flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {t('error.backToGallery')}
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
