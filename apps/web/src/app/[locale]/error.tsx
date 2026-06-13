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
                {/* AGG-R7-03 (run-7 c1): a single VISIBLE readable <h1> at a
                    prominent, WCAG-1.4.3-passing size. The prior AGG-9 split
                    fixed the accessibility tree (sr-only h1) but left sighted
                    users with only a ~1.5:1 faint title (/30) and no real
                    heading. The title text ('Error') is the same string the
                    old faint glyph showed, so a separate decorative duplicate
                    would just repeat it — we render one legible heading instead
                    (not-found.tsx can keep its decorative '404' numeral because
                    that glyph differs from its 'Page not found' heading). */}
                <h1 id="route-error-title" className="text-3xl font-semibold tracking-tight">{t('error.title')}</h1>
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
