'use client';

import { useTranslation } from '@/components/i18n-provider';

export function PhotoViewerLoading() {
    const { t } = useTranslation();

    return (
        <div
            className="flex min-h-[60vh] items-center justify-center"
            role="status"
            aria-live="polite"
            aria-label={t('common.loading')}
        >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
        </div>
    );
}
