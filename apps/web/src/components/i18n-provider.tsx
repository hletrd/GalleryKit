'use client';

import { useTranslations, useLocale } from 'next-intl';

// Deprecated: This was the old provider, now we use next-intl's provider in layout.
export function I18nProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}

export function useTranslation() {
    const t = useTranslations();
    const locale = useLocale();

    // Preserve the old API: t(key, args)
    // next-intl's t(key, args) is compatible
    return { t, locale };
}

