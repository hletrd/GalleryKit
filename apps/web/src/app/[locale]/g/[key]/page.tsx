import { getSharedGroup } from '@/lib/data';
import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import siteConfig from '@/site-config.json';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { imageUrl } from '@/lib/image-url';

const PhotoViewer = dynamic(() => import('@/components/photo-viewer'));

const BASE_URL = process.env.BASE_URL || siteConfig.url;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const locale = await getLocale();
    const group = await getSharedGroup(key, { incrementViewCount: false });
    if (!group) return {
        title: 'Shared Photos Not Found',
        description: 'This shared collection could not be found.',
    };
    const pageUrl = `${BASE_URL}/${locale}/g/${key}`;
    const coverImage = group.images[0];
    return {
        title: `Shared Photos`,
        description: `View ${group.images.length} shared photos`,
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title: `Shared Photos`,
            description: `View ${group.images.length} shared photos from ${siteConfig.title}`,
            url: pageUrl,
            siteName: siteConfig.title,
            type: 'website',
            ...(coverImage ? {
                images: [{
                    url: `${BASE_URL}/uploads/webp/${coverImage.filename_webp.replace('.webp', '_2048.webp')}`,
                    width: coverImage.width,
                    height: coverImage.height,
                    alt: 'Shared Photos',
                }],
            } : {}),
        },
        twitter: {
            card: 'summary_large_image',
            title: 'Shared Photos',
            description: `View ${group.images.length} shared photos from ${siteConfig.title}`,
            ...(coverImage ? {
                images: [`${BASE_URL}/uploads/webp/${coverImage.filename_webp.replace('.webp', '_2048.webp')}`],
            } : {}),
        },
    };
}

export default async function SharedGroupPage({ params, searchParams }: { params: Promise<{ key: string, locale: string }>, searchParams: Promise<{ photoId?: string }> }) {
    const { key, locale } = await params;
    const { photoId: photoIdParam } = await searchParams;
    const group = await getSharedGroup(key);

    if (!group) {
        notFound();
    }

    const t = await getTranslations('sharedGroup');

    // Validate photoId is a valid positive integer
    let photoId: number | null = null;
    if (photoIdParam) {
        const parsed = parseInt(photoIdParam, 10);
        if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
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
        return (
            <>
                <div className="flex items-center justify-between mb-4 px-4 pt-4">
                    <Link href={`/${locale}`} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                        ← {siteConfig.nav_title || siteConfig.title || 'GalleryKit'}
                    </Link>
                </div>
                <PhotoViewer
                    images={group.images}
                    initialImageId={selectedImage.id}
                    tags={[]}
                />
            </>
        );
    }

    // Render Grid
    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <Link href={`/${locale}`} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    ← {siteConfig.nav_title || siteConfig.title || 'GalleryKit'}
                </Link>
            </div>
            <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {group.images.map((image) => {
                    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
                    const altText = image.title && !isTitleFilename ? image.title : t('photo');

                    return (
                        <Link
                            key={image.id}
                            href={`/${locale}/g/${key}?photoId=${image.id}`}
                            className="block break-inside-avoid relative group overflow-hidden rounded-lg bg-muted/20"
                        >
                             <Image
                                src={imageUrl(`/uploads/webp/${image.filename_webp.replace('.webp', '_1536.webp')}`)}
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
