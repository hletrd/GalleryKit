import { getTranslations } from 'next-intl/server';
import { getTopPhotosByViews, getTopTopicsByViews, getCountryBreakdown, getReferrerBreakdown, type TimeWindow } from '@/lib/analytics-data';
import { AnalyticsClient } from './analytics-client';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
    searchParams,
}: {
    searchParams: Promise<{ window?: string }>;
}) {
    const { window: windowParam } = await searchParams;
    const validWindows: TimeWindow[] = ['30d', '90d', 'all'];
    const window: TimeWindow = validWindows.includes(windowParam as TimeWindow)
        ? (windowParam as TimeWindow)
        : '30d';

    const t = await getTranslations('analytics');

    const [topPhotos, topTopics, countries, referrers] = await Promise.all([
        getTopPhotosByViews(window, 20),
        getTopTopicsByViews(window, 20),
        getCountryBreakdown(window, 30),
        getReferrerBreakdown(window, 20),
    ]);

    return (
        <AnalyticsClient
            topPhotos={topPhotos}
            topTopics={topTopics}
            countries={countries}
            referrers={referrers}
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
                colPhoto: t('colPhoto'),
                colTopic: t('colTopic'),
                colViews: t('colViews'),
                colCountry: t('colCountry'),
                colReferrer: t('colReferrer'),
                noData: t('noData'),
                untitled: t('untitled'),
            }}
        />
    );
}
