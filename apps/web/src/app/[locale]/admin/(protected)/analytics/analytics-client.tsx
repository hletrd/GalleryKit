'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { type TopPhotoRow, type TopTopicRow, type CountryRow, type ReferrerRow, type TimeWindow } from '@/lib/analytics-data';

interface AnalyticsTranslations {
    title: string;
    windowLabel: string;
    window30d: string;
    window90d: string;
    windowAll: string;
    topPhotosTitle: string;
    topTopicsTitle: string;
    countriesTitle: string;
    referrersTitle: string;
    colPhoto: string;
    colTopic: string;
    colViews: string;
    colCountry: string;
    colReferrer: string;
    noData: string;
    untitled: string;
}

interface Props {
    topPhotos: TopPhotoRow[];
    topTopics: TopTopicRow[];
    countries: CountryRow[];
    referrers: ReferrerRow[];
    currentWindow: TimeWindow;
    t: AnalyticsTranslations;
}

export function AnalyticsClient({ topPhotos, topTopics, countries, referrers, currentWindow, t }: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    function setWindow(w: TimeWindow) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('window', w);
        router.push(`${pathname}?${params.toString()}`);
    }

    const windows: { value: TimeWindow; label: string }[] = [
        { value: '30d', label: t.window30d },
        { value: '90d', label: t.window90d },
        { value: 'all', label: t.windowAll },
    ];

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h1 className="text-2xl font-bold">{t.title}</h1>
                <div className="flex items-center gap-2" role="group" aria-label={t.windowLabel}>
                    {windows.map((w) => (
                        <button
                            key={w.value}
                            onClick={() => setWindow(w.value)}
                            aria-pressed={currentWindow === w.value}
                            className={`min-h-11 min-w-11 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                                currentWindow === w.value
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {/* Top Photos */}
                <section>
                    <h2 className="mb-3 text-lg font-semibold">{t.topPhotosTitle}</h2>
                    <div className="rounded-md border">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="px-4 py-3 text-left font-medium">{t.colPhoto}</th>
                                    <th className="px-4 py-3 text-left font-medium">{t.colTopic}</th>
                                    <th className="px-4 py-3 text-right font-medium">{t.colViews}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topPhotos.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                                            {t.noData}
                                        </td>
                                    </tr>
                                ) : (
                                    topPhotos.map((row) => (
                                        <tr key={row.imageId} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="px-4 py-3">
                                                <a
                                                    href={`/p/${row.imageId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-primary underline-offset-4 hover:underline"
                                                >
                                                    {row.title || `${t.untitled} #${row.imageId}`}
                                                </a>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">{row.topic}</td>
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Top Topics */}
                <section>
                    <h2 className="mb-3 text-lg font-semibold">{t.topTopicsTitle}</h2>
                    <div className="rounded-md border">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="px-4 py-3 text-left font-medium">{t.colTopic}</th>
                                    <th className="px-4 py-3 text-right font-medium">{t.colViews}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topTopics.length === 0 ? (
                                    <tr>
                                        <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                                            {t.noData}
                                        </td>
                                    </tr>
                                ) : (
                                    topTopics.map((row) => (
                                        <tr key={row.topic} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="px-4 py-3">{row.label}</td>
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Country Breakdown */}
                <section>
                    <h2 className="mb-3 text-lg font-semibold">{t.countriesTitle}</h2>
                    <div className="rounded-md border">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="px-4 py-3 text-left font-medium">{t.colCountry}</th>
                                    <th className="px-4 py-3 text-right font-medium">{t.colViews}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {countries.length === 0 ? (
                                    <tr>
                                        <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                                            {t.noData}
                                        </td>
                                    </tr>
                                ) : (
                                    countries.map((row) => (
                                        <tr key={row.country_code} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="px-4 py-3 font-mono">{row.country_code}</td>
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Referrer Breakdown */}
                <section>
                    <h2 className="mb-3 text-lg font-semibold">{t.referrersTitle}</h2>
                    <div className="rounded-md border">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="px-4 py-3 text-left font-medium">{t.colReferrer}</th>
                                    <th className="px-4 py-3 text-right font-medium">{t.colViews}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {referrers.length === 0 ? (
                                    <tr>
                                        <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                                            {t.noData}
                                        </td>
                                    </tr>
                                ) : (
                                    referrers.map((row) => (
                                        <tr key={row.referrer_host} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="px-4 py-3 font-mono">{row.referrer_host}</td>
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}
