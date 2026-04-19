import { getImageByShareKeyCached } from '@/lib/data';
import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import siteConfig from '@/site-config.json';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import { BASE_URL } from '@/lib/constants';

const PhotoViewer = dynamic(() => import('@/components/photo-viewer'));

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const locale = await getLocale();
    const t = await getTranslations('shared');
    const image = await getImageByShareKeyCached(key);
    if (!image) return {
        title: t('ogNotFoundTitle'),
        description: t('ogNotFoundDescription'),
    };
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
    const title = image.title && !isTitleFilename ? image.title : t('ogTitle');
    const pageUrl = localizeUrl(BASE_URL, locale, `/s/${key}`);
    return {
        title: title,
        description: image.description || t('ogDescription', { site: siteConfig.title }),
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title: title,
            description: image.description || t('ogDescription', { site: siteConfig.title }),
            url: pageUrl,
            siteName: siteConfig.title,
            images: [
                {
                    url: `${BASE_URL}/uploads/webp/${image.filename_webp.replace('.webp', '_2048.webp')}`,
                    width: image.width,
                    height: image.height,
                    alt: title,
                }
            ],
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title: title,
            description: image.description || t('ogDescription', { site: siteConfig.title }),
            images: [`${BASE_URL}/uploads/webp/${image.filename_webp.replace('.webp', '_2048.webp')}`],
        },
    };
}

export default async function SharedPhotoPage({ params }: { params: Promise<{ key: string }> }) {
    const { key } = await params;
    const locale = await getLocale();
    const t = await getTranslations('shared');
    const image = await getImageByShareKeyCached(key);

    if (!image) {
        notFound();
    }

    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
    const displayTitle = image.title && !isTitleFilename ? image.title : t('sharedPhoto');
    const subtitle = image.description || `${siteConfig.nav_title || siteConfig.title} · ${t('sharedPhoto')}`;

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
            />
        </>
    );
}
