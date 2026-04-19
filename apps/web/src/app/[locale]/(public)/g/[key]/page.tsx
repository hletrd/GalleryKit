import { getSharedGroupCached, getSeoSettings } from '@/lib/data';
import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { imageUrl } from '@/lib/image-url';
import { localizePath, localizeUrl } from '@/lib/locale-path';

const PhotoViewer = dynamic(() => import('@/components/photo-viewer'));

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const locale = await getLocale();
    const t = await getTranslations('sharedGroup');
    const seo = await getSeoSettings();
    const group = await getSharedGroupCached(key, { incrementViewCount: false });
    if (!group) return {
        title: t('notFoundTitle'),
        description: t('notFoundDescription'),
    };
    const pageUrl = localizeUrl(seo.url, locale, `/g/${key}`);
    const coverImage = group.images[0];

    // Use custom OG image if configured, otherwise use cover photo
    const ogImages = seo.og_image_url
        ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: seo.title }]
        : coverImage
            ? [{
                url: `${seo.url}/uploads/jpeg/${coverImage.filename_jpeg.replace(/\.jpg$/i, '_1536.jpg')}`,
                width: coverImage.width,
                height: coverImage.height,
                alt: t('ogAlt'),
            }]
            : [];

    return {
        title: t('ogTitle'),
        description: t('ogDescription', { count: group.images.length }),
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title: t('ogTitle'),
            description: t('ogDescriptionWithSite', { count: group.images.length, site: seo.title }),
            url: pageUrl,
            siteName: seo.title,
            type: 'website',
            images: ogImages,
        },
        twitter: {
            card: 'summary_large_image',
            title: t('ogTitle'),
            description: t('ogDescriptionWithSite', { count: group.images.length, site: seo.title }),
            ...(coverImage && !seo.og_image_url ? {
                images: [`${seo.url}/uploads/jpeg/${coverImage.filename_jpeg.replace(/\.jpg$/i, '_1536.jpg')}`],
            } : seo.og_image_url ? {
                images: [seo.og_image_url],
            } : {}),
        },
    };
}

export default async function SharedGroupPage({ params, searchParams }: { params: Promise<{ key: string, locale: string }>, searchParams: Promise<{ photoId?: string }> }) {
    const { key, locale } = await params;
    const { photoId: photoIdParam } = await searchParams;
    const group = await getSharedGroupCached(key);

    if (!group) {
        return notFound();
    }

    const t = await getTranslations('sharedGroup');

    let photoId: number | null = null;
    if (photoIdParam && /^\d+$/.test(photoIdParam)) {
        const parsed = parseInt(photoIdParam, 10);
        if (parsed > 0) {
            photoId = parsed;
        }
    }

    let selectedImage = null;

    if (photoId) {
        const index = group.images.findIndex(img => img.id === photoId);
        if (index !== -1) {
            selectedImage = group.images[index];
        }
    }

    if (selectedImage) {
        const isTitleFilename = selectedImage.title && /\.[a-z0-9]{3,4}$/i.test(selectedImage.title);
        const displayTitle = selectedImage.title && !isTitleFilename ? selectedImage.title : t('photo');
        const subtitle = selectedImage.description || t('viewCount', { count: group.images.length });

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
                    images={group.images}
                    initialImageId={selectedImage.id}
                    tags={selectedImage.tags ?? []}
                    isSharedView
                    syncPhotoQueryBasePath={localizePath(locale, `/g/${key}`)}
                />
            </>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <Link href={localizePath(locale, '/')} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    <ArrowLeft className="h-4 w-4" /> {t('viewGallery')}
                </Link>
            </div>
            <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {group.images.map((image) => {
                    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
                    const altText = image.title && !isTitleFilename ? image.title : t('photo');

                    return (
                        <Link
                            key={image.id}
                            href={`${localizePath(locale, `/g/${key}`)}?photoId=${image.id}`}
                            className="block break-inside-avoid relative group overflow-hidden rounded-lg bg-muted/20"
                        >
                            <div className="absolute inset-x-0 top-0 z-10 sm:hidden bg-gradient-to-b from-black/65 to-transparent p-3">
                                <p className="text-white text-sm font-medium truncate">{altText}</p>
                            </div>
                            <Image
                                src={imageUrl(`/uploads/webp/${image.filename_webp.replace(/\.webp$/i, '_1536.webp')}`)}
                                alt={altText}
                                width={image.width}
                                height={image.height}
                                className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-105"
                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            />
                        </Link>
                    );
                })}
            </div>
            {group.images.length === 0 && (
                <div className="text-center py-20 text-muted-foreground">
                    {t('empty')}
                </div>
            )}
        </div>
    );
}
