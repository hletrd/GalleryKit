'use client';

import Link from 'next/link';
import { useTranslation } from '@/components/i18n-provider';

export default function AdminError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { t, locale } = useTranslation();

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
            <h1 className="text-7xl font-bold text-muted-foreground/30">{t('error.title')}</h1>
            <p className="text-lg text-muted-foreground">
                {t('error.adminDescription')}
            </p>
            <div className="flex gap-4">
                <button
                    onClick={reset}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
                >
                    {t('error.tryAgain')}
                </button>
                <Link
                    href={`/${locale}/admin/dashboard`}
                    className="px-4 py-2 border rounded-md hover:bg-muted text-sm"
                >
                    {t('error.backToDashboard')}
                </Link>
            </div>
        </div>
    );
}
