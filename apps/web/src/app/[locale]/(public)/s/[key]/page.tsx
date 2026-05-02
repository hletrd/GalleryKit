import { getImageByShareKeyCached, getSeoSettings } from '@/lib/data';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { ArrowLeft } from 'lucide-react';
import { getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl } from '@/lib/locale-path';
import PhotoViewer from '@/components/photo-viewer';
import { getGalleryConfig } from '@/lib/gallery-config';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { getClientIp, preIncrementShareAttempt } from '@/lib/rate-limit';

export const revalidate = 0;

const sharePageRobots = {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
        index: false,
        follow: false,
        noarchive: true,
        noimageindex: true,
    },
} as const;

async function isShareLookupRateLimited() {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    return preIncrementShareAttempt(ip);
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    // C4-AGG-01: Rate limit is NOT checked here — it is enforced once in the
    // page body. Both generateMetadata and the page body run in separate React
    // render contexts, so calling preIncrementShareAttempt in both would
    // double-increment the counter, giving users half the intended budget.
    //
    // AGG-C1-02: metadata also must not perform the share-key DB lookup. That
    // lookup is the enumeration-sensitive operation and is rate-limited only in
    // the page body, so metadata stays generic/noindex rather than revealing
    // whether a key exists or exposing image-specific OG details.
    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('shared'),
        getSeoSettings(),
    ]);
    const title = t('ogTitle');
    const description = t('ogDescription', { site: seo.title });
    const pageUrl = localizeUrl(seo.url, locale, `/s/${key}`);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);

    return {
        title,
        description,
        robots: sharePageRobots,
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title,
            description,
            url: pageUrl,
            siteName: seo.title,
            type: 'website',
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
        },
        twitter: {
            card: 'summary',
            title,
            description,
        },
    };
}

export default async function SharedPhotoPage({ params }: { params: Promise<{ key: string }> }) {
    const { key } = await params;

    // Rate-limit share-key lookups to prevent automated key enumeration
    if (await isShareLookupRateLimited()) {
        return notFound();
    }

    const [locale, t, image, seo, config] = await Promise.all([
        getLocale(),
        getTranslations('shared'),
        getImageByShareKeyCached(key),
        getSeoSettings(),
        getGalleryConfig(),
    ]);

    if (!image) {
        return notFound();
    }

    const displayTitle = getPhotoDisplayTitle(image, t('sharedPhoto'));
    const subtitle = image.description || `${seo.nav_title || seo.title} · ${t('sharedPhoto')}`;

    return (
        <>
            <div className="flex items-center justify-between mb-4 px-4 pt-4">
                <Link href={localizePath(locale, '/')} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    <ArrowLeft className="h-4 w-4" /> {t('viewGallery')}
                </Link>
            </div>
            <div className="px-4 pb-3">
                <h1 className="text-2xl font-semibold tracking-tight">{displayTitle}</h1>
                <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            </div>
            <PhotoViewer
                images={[image]}
                initialImageId={image.id}
                tags={image.tags ?? []}
                prevId={null}
                nextId={null}
                isSharedView
                imageSizes={config.imageSizes}
                siteTitle={seo.title}
                shareBaseUrl={seo.url}
                untitledFallbackTitle={t('sharedPhoto')}
                showDocumentHeading={false}
            />
        </>
    );
}
