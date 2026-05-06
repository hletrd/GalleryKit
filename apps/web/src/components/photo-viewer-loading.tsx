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
            <div className="relative w-full max-w-3xl">
                <div className="aspect-[4/3] w-full rounded-2xl bg-muted/60 shadow-inner animate-pulse" aria-hidden="true" />
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground bg-background/70 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
                        <span>{t('photo.loading')}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
