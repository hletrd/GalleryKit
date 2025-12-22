'use client';

import { useTranslations, useLocale } from 'next-intl';



export function useTranslation() {
    const t = useTranslations();
    const locale = useLocale();

    // Preserve the old API: t(key, args)
    // next-intl's t(key, args) is compatible
    return { t, locale };
}

