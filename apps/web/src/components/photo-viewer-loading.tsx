'use client';

import { useTranslation } from '@/components/i18n-provider';

export function PhotoViewerLoading() {
    const { t } = useTranslation();

    return (
        <div
            className="flex min-h-[60vh] items-center justify-center px-4"
            role="status"
            aria-live="polite"
            aria-label={t('photo.loading')}
        >
            <div className="flex w-full max-w-3xl flex-col items-center gap-4 text-center">
                <div className="aspect-[4/3] w-full rounded-2xl bg-muted/60 shadow-inner animate-pulse" aria-hidden="true" />
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
                    <span>{t('photo.loading')}</span>
                </div>
            </div>
        </div>
    );
}
