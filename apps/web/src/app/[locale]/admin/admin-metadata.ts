import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

type NavTitleKey =
    | 'admin'
    | 'analytics'
    | 'categories'
    | 'dashboard'
    | 'db'
    | 'password'
    | 'seo'
    | 'settings'
    | 'tags'
    | 'users';

export async function adminRouteMetadata(titleKey: NavTitleKey): Promise<Metadata> {
    const t = await getTranslations('nav');
    const title = titleKey === 'admin'
        ? t('admin')
        : `${t(titleKey)} | ${t('admin')}`;

    return { title };
}

export async function adminTokenRouteMetadata(): Promise<Metadata> {
    const [tNav, tToken] = await Promise.all([
        getTranslations('nav'),
        getTranslations('lrToken'),
    ]);

    return { title: `${tToken('title')} | ${tNav('admin')}` };
}
