import { getSmartCollectionBySlugCached, getImagesForSmartCollection, getTagsCached, getTopicsCached, getSeoSettings } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { getGalleryConfig } from '@/lib/gallery-config';
import { parseSmartCollectionQuery, compileSmartCollection } from '@/lib/smart-collections';
import { localizeUrl, getOpenGraphLocale, getAlternateOpenGraphLocales, buildHreflangAlternates } from '@/lib/locale-path';
import { absoluteImageUrl } from '@/lib/image-url';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { getCspNonce } from '@/lib/csp-nonce';
import { safeJsonLd } from '@/lib/safe-json-ld';

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const collection = await getSmartCollectionBySlugCached(slug);
    // R19-L1: prefetch translations so the not-found / private-collection
    // branch returns a translated `notFoundTitle` instead of an empty
    // <title>. Empty titles render the URL itself as the tab label and
    // trip Lighthouse / axe-core a11y audits.
    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('smartCollection'),
        getSeoSettings(),
    ]);

    if (!collection || !collection.is_public) {
        return {
            title: t('notFoundTitle'),
            robots: { index: false, follow: false },
        };
    }

    const pageUrl = localizeUrl(seo.url, locale, `/c/${collection.slug}`);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);
    const title = collection.name;
    const description = t('ogDescription', { name: collection.name, site: seo.title });

    // R19-L2: hreflang alternates so `/en/c/{slug}` and `/ko/c/{slug}`
    // are associated as translation pairs (avoids duplicate-content
    // penalties). Mirrors the topic-page metadata block.
    const alternateLanguages = buildHreflangAlternates(seo.url, `/c/${collection.slug}`);

    // R19-L2: OG image fallback. The smart-collection share path is the
    // photographer-share surface; an empty social preview undermines the
    // share. Defer collection-specific `/api/og?collection=...` rendering
    // (see plan Deferred row R19-L2-OG) but emit the admin-configured
    // site OG image when available.
    const ogImages = seo.og_image_url
        ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: title }]
        : undefined;

    return {
        title,
        description,
        alternates: { canonical: pageUrl, languages: alternateLanguages },
        openGraph: {
            title: `${title} | ${seo.title}`,
            description,
            url: pageUrl,
            siteName: seo.title,
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
            type: 'website',
            ...(ogImages ? { images: ogImages } : {}),
        },
        twitter: {
            card: 'summary_large_image',
            title: `${title} | ${seo.title}`,
            description,
            ...(ogImages ? { images: ogImages.map((image) => image.url) } : {}),
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
            // R21-M2: base JPEG filename for JSON-LD thumbnail so
            // Googlebot Image always gets a 200 response (sized
            // derivative can 404 for legacy / mid-backfill rows).
            thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, baseUrl),
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
