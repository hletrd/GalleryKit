import { getTranslations } from 'next-intl/server';

export default async function Loading() {
    const t = await getTranslations('common');

    return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" role="status" aria-label={t('loading')} />
        </div>
    );
}
