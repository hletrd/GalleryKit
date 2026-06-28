'use client';

import Link from 'next/link';
import { useTranslation } from '@/components/i18n-provider';
import { localizePath } from '@/lib/locale-path';

export default function AdminError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { t, locale } = useTranslation();

    return (
        // DES-R4C15-06: the outer wrapper is pure layout — labelling BOTH
        // nested elements with the same id announced two identical regions
        // to AT. Single labelled <section> inside a plain <div>, matching
        // the public twin (app/[locale]/error.tsx) structure.
        <div className="flex min-h-[60vh] items-center justify-center px-4">
            <section className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border bg-card p-6 text-center shadow-sm" aria-labelledby="admin-route-error-title">
                {/* AGG-9 → AGG-R7-03 (run-7 c1): a single VISIBLE readable <h1>
                    at a prominent, WCAG-1.4.3-passing size, mirroring the public
                    twin (app/[locale]/error.tsx). AGG-9 first split the faint
                    /30 (~1.5:1) glyph into an aria-hidden span + sr-only h1 to
                    fix the accessibility tree, but that left sighted admins with
                    a faint title and no real heading; AGG-R7-03 promotes the h1
                    to a legible visible heading (the title text would just be
                    duplicated by a separate decorative glyph, so we render one). */}
                <h1 id="admin-route-error-title" className="text-3xl font-semibold tracking-tight">{t('error.title')}</h1>
                <p className="text-lg text-muted-foreground">
                    {t('error.adminDescription')}
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                <button
                    onClick={reset}
                    className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {t('error.tryAgain')}
                </button>
                <Link
                    href={localizePath(locale, '/admin/dashboard')}
                    className="flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {t('error.backToDashboard')}
                </Link>
                </div>
            </section>
        </div>
    );
}
