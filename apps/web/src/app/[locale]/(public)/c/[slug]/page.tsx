import { getSmartCollectionBySlugCached, getImagesForSmartCollection, getTagsCached, getTopicsCached, getSeoSettings } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { getGalleryConfig } from '@/lib/gallery-config';
import { parseSmartCollectionQuery, compileSmartCollection } from '@/lib/smart-collections';
import { localizeUrl, getOpenGraphLocale, getAlternateOpenGraphLocales } from '@/lib/locale-path';
import { absoluteImageUrl } from '@/lib/image-url';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { getCspNonce } from '@/lib/csp-nonce';
import { safeJsonLd } from '@/lib/safe-json-ld';

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const collection = await getSmartCollectionBySlugCached(slug);
    if (!collection || !collection.is_public) {
        return {
            title: '',
            robots: { index: false, follow: false },
        };
    }

    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('smartCollection'),
        getSeoSettings(),
    ]);

    const pageUrl = localizeUrl(seo.url, locale, `/c/${collection.slug}`);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);
    const title = collection.name;
    const description = t('ogDescription', { name: collection.name, site: seo.title });

    return {
        title,
        description,
        alternates: { canonical: pageUrl },
        openGraph: {
            title: `${title} | ${seo.title}`,
            description,
            url: pageUrl,
            siteName: seo.title,
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title: `${title} | ${seo.title}`,
            description,
        },
    };
}

export default async function SmartCollectionPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const collection = await getSmartCollectionBySlugCached(slug);

    if (!collection || !collection.is_public) {
        return notFound();
    }

    let ast;
    try {
        ast = parseSmartCollectionQuery(collection.query_json);
    } catch {
        return notFound();
    }

    let compiledCondition;
    try {
        compiledCondition = compileSmartCollection(ast);
    } catch {
        return notFound();
    }

    const PAGE_SIZE = 30;
    const { images, totalCount, hasMore } = await getImagesForSmartCollection(compiledCondition, PAGE_SIZE, 0);

    const [locale, seo, config, allTags, allTopics] = await Promise.all([
        getLocale(),
        getSeoSettings(),
        getGalleryConfig(),
        getTagsCached(),
        getTopicsCached(),
    ]);

    const baseUrl = seo.url;
    const nonce = await getCspNonce();

    const galleryLd = images.length > 0 ? {
        '@context': 'https://schema.org',
        '@type': 'ImageGallery',
        name: `${collection.name} | ${seo.title}`,
        url: localizeUrl(baseUrl, locale, `/c/${collection.slug}`),
        image: images.slice(0, 10).map((img) => ({
            '@type': 'ImageObject',
            contentUrl: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, baseUrl),
            thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(config.imageSizes, 640)}.jpg`)}`, baseUrl),
            name: getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`),
        })),
    } : null;

    return (
        <>
            {galleryLd && (
                <script
                    type="application/ld+json"
                    nonce={nonce}
                    dangerouslySetInnerHTML={{
                        __html: safeJsonLd(galleryLd)
                    }}
                />
            )}
            <HomeClient
                images={images}
                tags={allTags.filter(t => t.count > 1)}
                topics={allTopics}
                heading={collection.name}
                hasMore={hasMore}
                totalCount={totalCount}
                imageSizes={config.imageSizes}
                smartCollectionSlug={collection.slug}
            />
        </>
    );
}
