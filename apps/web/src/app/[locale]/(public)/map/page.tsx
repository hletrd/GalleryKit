import { getMapImages, getSeoSettings } from '@/lib/data';
import { getGalleryConfig } from '@/lib/gallery-config';
import { getLocale, getTranslations } from 'next-intl/server';
import { Metadata } from 'next';
import { MapLoader } from '@/components/map/map-loader';
import { localizeUrl } from '@/lib/locale-path';

// Public map pages must reflect GPS data immediately as topics are toggled.
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
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
    // PERF-R4C15-02: getGalleryConfig is React cache()-wrapped, so this
    // costs nothing extra in a request where Nav already resolved it; the
    // configured image_sizes drive sized popup thumbnails in MapClient.
    const [t, locale, mapImages, config] = await Promise.all([
        getTranslations('map'),
        getLocale(),
        getMapImages(),
        getGalleryConfig(),
    ]);

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
            filename_jpeg: img.filename_jpeg,
            topic: img.topic,
        }));

    return (
        <div>
            <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
            {markers.length === 0 ? (
                <p className="text-muted-foreground">{t('noPhotos')}</p>
            ) : (
                <MapLoader
                    markers={markers}
                    locale={locale}
                    noPhotosLabel={t('noPhotos')}
                    openPhotoLabel={t('openPhoto')}
                    loadingLabel={t('loading')}
                    imageSizes={config.imageSizes}
                />
            )}
        </div>
    );
}
