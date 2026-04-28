import { getTranslations } from 'next-intl/server';

export default async function AdminLoading() {
    const t = await getTranslations('common');

    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <div className="flex items-center gap-3" role="status" aria-label={t('loading')}>
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">{t('loading')}</span>
            </div>
        </div>
    );
}
