import { getMapImages, getSeoSettings } from '@/lib/data';
import { getGalleryConfig } from '@/lib/gallery-config';
import { getLocale, getTranslations } from 'next-intl/server';
import { Metadata } from 'next';
import { MapLoader } from '@/components/map/map-loader';
import Link from 'next/link';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';
import { getPublicRestoreMaintenanceMetadata } from '@/lib/public-restore-maintenance-metadata';

// Public map pages must reflect GPS data immediately as topics are toggled.
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
    const maintenanceMetadata = await getPublicRestoreMaintenanceMetadata();
    if (maintenanceMetadata) return maintenanceMetadata;

    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('map'),
        getSeoSettings(),
    ]);
    const pageUrl = localizeUrl(seo.url, locale, '/map');
    return {
        title: t('title'),
        description: t('description'),
        alternates: { canonical: pageUrl },
        robots: { index: false, follow: true },
    };
}

export default async function MapPage() {
    if (isRestoreMaintenanceActive()) {
        const tCommon = await getTranslations('common');
        return <PublicRestoreMaintenance title={tCommon('restoreMaintenanceTitle')} body={tCommon('restoreMaintenanceBody')} />;
    }
    // PERF-R4C15-02: getGalleryConfig is React cache()-wrapped, so this
    // costs nothing extra in a request where Nav already resolved it; the
    // configured image_sizes drive sized popup thumbnails in MapClient.
    const [t, locale, mapImages, config] = await Promise.all([
        getTranslations('map'),
        getLocale(),
        getMapImages(),
        getGalleryConfig(),
    ]);
    const tPhoto = await getTranslations('photo');

    // Only pass images that have non-null lat/lng (type-narrowed for the client).
    const markers = mapImages
        .filter((img): img is typeof img & { latitude: number; longitude: number } =>
            img.latitude !== null && img.longitude !== null
        )
        .map(img => ({
            id: img.id,
            latitude: img.latitude,
            longitude: img.longitude,
            title: img.title ?? null,
            displayTitle: img.title ?? tPhoto('titleWithId', { id: img.id }),
            filename_jpeg: img.filename_jpeg,
            topic: img.topic,
        }));

    return (
        <div>
            <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
            {markers.length === 0 ? (
                <p className="text-muted-foreground">{t('noPhotos')}</p>
            ) : (
                <>
                    <a
                        href="#map-photo-list"
                        className="sr-only focus-visible:not-sr-only focus-visible:mb-3 focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground"
                    >
                        {t('skipToPhotoList')}
                    </a>
                    <section aria-labelledby="map-region-title" aria-describedby="map-region-help">
                        <h2 id="map-region-title" className="sr-only">{t('mapRegionLabel')}</h2>
                        <p id="map-region-help" className="sr-only">{t('mapInstructions')}</p>
                        <MapLoader
                            markers={markers}
                            locale={locale}
                            noPhotosLabel={t('noPhotos')}
                            openPhotoLabel={t('openPhoto')}
                            loadingLabel={t('loading')}
                            imageSizes={config.imageSizes}
                        />
                    </section>
                    <ul id="map-photo-list" className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('photoListLabel')}>
                        {markers.map((marker) => (
                            <li key={marker.id}>
                                <Link
                                    href={localizePath(locale, `/p/${marker.id}`)}
                                    className="block min-h-11 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                >
                                    <span className="font-medium">{marker.displayTitle}</span>
                                    <span className="block text-xs text-muted-foreground">{marker.topic}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
