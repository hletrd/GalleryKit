import { getTranslations } from 'next-intl/server';
import { getTopPhotosByViews, getTopTopicsByViews, getCountryBreakdown, getReferrerBreakdown, getTopSharedGroupsByViews, type TimeWindow } from '@/lib/analytics-data';
import { AnalyticsClient } from './analytics-client';
import { adminRouteMetadata } from '../../admin-metadata';

export const dynamic = 'force-dynamic';

export const generateMetadata = () => adminRouteMetadata('analytics');

export default async function AnalyticsPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ window?: string }>;
}) {
    const { locale } = await params;
    const { window: windowParam } = await searchParams;
    const validWindows: TimeWindow[] = ['30d', '90d', 'all'];
    const window: TimeWindow = validWindows.includes(windowParam as TimeWindow)
        ? (windowParam as TimeWindow)
        : '30d';

    const t = await getTranslations('analytics');

    const [topPhotos, topTopics, countries, referrers, topSharedGroups] = await Promise.all([
        getTopPhotosByViews(window, 20),
        getTopTopicsByViews(window, 20),
        getCountryBreakdown(window, 30),
        getReferrerBreakdown(window, 20),
        // Cycle 4 RPF loop R27-UX-MED-4: surface per-share-link engagement
        // for client-delivery analytics. Limit 25 keeps the table scannable
        // while still covering the long tail for accounts with many
        // outstanding client delivery links.
        getTopSharedGroupsByViews(window, 25),
    ]);

    return (
        <AnalyticsClient
            locale={locale}
            topPhotos={topPhotos}
            topTopics={topTopics}
            countries={countries}
            referrers={referrers}
            topSharedGroups={topSharedGroups}
            currentWindow={window}
            t={{
                title: t('title'),
                windowLabel: t('windowLabel'),
                window30d: t('window30d'),
                window90d: t('window90d'),
                windowAll: t('windowAll'),
                topPhotosTitle: t('topPhotosTitle'),
                topTopicsTitle: t('topTopicsTitle'),
                countriesTitle: t('countriesTitle'),
                referrersTitle: t('referrersTitle'),
                topSharedAlbumsTitle: t('topSharedAlbumsTitle'),
                colPhoto: t('colPhoto'),
                colTopic: t('colTopic'),
                colViews: t('colViews'),
                colCountry: t('colCountry'),
                colReferrer: t('colReferrer'),
                colSharedAlbum: t('colSharedAlbum'),
                noData: t('noData'),
                unknownCountry: t('unknownCountry'),
                untitled: t('untitled'),
                opensInNewWindow: t('opensInNewWindow'),
                approximateDisclaimer: t('approximateDisclaimer'),
            }}
        />
    );
}
