'use client';

import Link from 'next/link';
import { useTranslation } from '@/components/i18n-provider';
import { localizePath } from '@/lib/locale-path';

export default function Error({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { t, locale } = useTranslation();

    return (
        <main className="flex min-h-[60vh] items-center justify-center px-4" role="main">
            <section className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border bg-card p-6 text-center shadow-sm" aria-labelledby="route-error-title">
                <h1 id="route-error-title" className="text-7xl font-bold text-muted-foreground/30">{t('error.title')}</h1>
                <p className="text-lg text-muted-foreground">
                    {t('error.description')}
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                <button
                    onClick={reset}
                    className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                >
                    {t('error.tryAgain')}
                </button>
                <Link
                    href={localizePath(locale, '/')}
                    className="flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-muted"
                >
                    {t('error.backToGallery')}
                </Link>
                </div>
            </section>
        </main>
    );
}
