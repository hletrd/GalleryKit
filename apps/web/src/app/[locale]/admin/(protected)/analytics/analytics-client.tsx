'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { type TopPhotoRow, type TopTopicRow, type CountryRow, type ReferrerRow, type TopSharedGroupRow, type TimeWindow } from '@/lib/analytics-data';
import { localizePath } from '@/lib/locale-path';

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
    // Cycle 4 RPF loop R27-UX-MED-4: shared-album engagement section title
    topSharedAlbumsTitle: string;
    colPhoto: string;
    colTopic: string;
    colViews: string;
    colCountry: string;
    colReferrer: string;
    colSharedAlbum: string;
    noData: string;
    untitled: string;
    opensInNewWindow: string;
    // R27-UX-MED-2: surface the truth about counter precision so the
    // photographer doesn't trust this as billing/audit-grade state.
    approximateDisclaimer: string;
}

interface Props {
    locale: string;
    topPhotos: TopPhotoRow[];
    topTopics: TopTopicRow[];
    countries: CountryRow[];
    referrers: ReferrerRow[];
    topSharedGroups: TopSharedGroupRow[];
    currentWindow: TimeWindow;
    t: AnalyticsTranslations;
}

export function AnalyticsClient({ locale, topPhotos, topTopics, countries, referrers, topSharedGroups, currentWindow, t }: Props) {
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
                            className={`min-h-11 min-w-11 rounded-md px-4 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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
            {/* R27-UX-MED-2: approximate-count disclosure rendered above the
                first data block so the photographer reads the caveat before
                interpreting any of the tables. Shared-group view counters
                buffer events in memory and flush asynchronously per the
                CLAUDE.md runtime-topology note. */}
            <p className="text-xs text-muted-foreground" role="note">
                {t.approximateDisclaimer}
            </p>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {/* Top Photos */}
                <section>
                    <h2 className="mb-3 text-lg font-semibold">{t.topPhotosTitle}</h2>
                    <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th scope="col" className="px-4 py-3 text-left font-medium">{t.colPhoto}</th>
                                    <th scope="col" className="px-4 py-3 text-left font-medium">{t.colTopic}</th>
                                    <th scope="col" className="px-4 py-3 text-right font-medium">{t.colViews}</th>
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
                                    topPhotos.map((row) => {
                                        const label = row.title || `${t.untitled} #${row.imageId}`;
                                        return (
                                            <tr key={row.imageId} className="border-b last:border-0 hover:bg-muted/30">
                                                <td className="px-4 py-3">
                                                    <a
                                                        href={localizePath(locale, `/p/${row.imageId}`)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        aria-label={`${label} ${t.opensInNewWindow}`}
                                                        className="inline-flex min-h-11 min-w-11 items-center rounded text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                    >
                                                        {label}
                                                    </a>
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">{row.topic}</td>
                                                <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString(locale)}</td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Top Topics */}
                <section>
                    <h2 className="mb-3 text-lg font-semibold">{t.topTopicsTitle}</h2>
                    <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th scope="col" className="px-4 py-3 text-left font-medium">{t.colTopic}</th>
                                    <th scope="col" className="px-4 py-3 text-right font-medium">{t.colViews}</th>
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
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString(locale)}</td>
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
                    <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th scope="col" className="px-4 py-3 text-left font-medium">{t.colCountry}</th>
                                    <th scope="col" className="px-4 py-3 text-right font-medium">{t.colViews}</th>
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
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString(locale)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Cycle 4 RPF loop R27-UX-MED-4: top shared albums.
                    Each row links to the locale-scoped `/g/${shareKey}`
                    public route so the admin previews the album with the
                    same language chrome as the current admin session. */}
                <section>
                    <h2 className="mb-3 text-lg font-semibold">{t.topSharedAlbumsTitle}</h2>
                    <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th scope="col" className="px-4 py-3 text-left font-medium">{t.colSharedAlbum}</th>
                                    <th scope="col" className="px-4 py-3 text-right font-medium">{t.colViews}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topSharedGroups.length === 0 ? (
                                    <tr>
                                        <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                                            {t.noData}
                                        </td>
                                    </tr>
                                ) : (
                                    topSharedGroups.map((row) => (
                                        <tr key={row.shareKey} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="px-4 py-3">
                                                <a
                                                    href={localizePath(locale, `/g/${row.shareKey}`)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`${row.shareKey} ${t.opensInNewWindow}`}
                                                    className="inline-flex min-h-11 min-w-11 items-center rounded font-mono text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                >
                                                    {row.shareKey}
                                                </a>
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString(locale)}</td>
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
                    <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th scope="col" className="px-4 py-3 text-left font-medium">{t.colReferrer}</th>
                                    <th scope="col" className="px-4 py-3 text-right font-medium">{t.colViews}</th>
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
                                            <td className="px-4 py-3 text-right tabular-nums">{row.viewCount.toLocaleString(locale)}</td>
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
