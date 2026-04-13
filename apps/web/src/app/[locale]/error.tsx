'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const t = useTranslations('error');

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
            <h1 className="text-7xl font-bold text-muted-foreground/30">{t('title')}</h1>
            <p className="text-lg text-muted-foreground">
                {t('description')}
            </p>
            <div className="flex gap-4">
                <button
                    onClick={reset}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
                >
                    {t('tryAgain')}
                </button>
                <Link
                    href="/"
                    className="px-4 py-2 border rounded-md hover:bg-muted text-sm"
                >
                    {t('backToGallery')}
                </Link>
            </div>
        </div>
    );
}
