import { getImageByShareKey } from '@/lib/data';
import { notFound } from 'next/navigation';
import PhotoViewer from '@/components/photo-viewer';
import Link from 'next/link';
import siteConfig from '@/site-config.json';
import { Metadata } from 'next';

const BASE_URL = process.env.BASE_URL || siteConfig.url;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const image = await getImageByShareKey(key);
    if (!image) return {
        title: 'Photo Not Found',
        description: 'This shared photo could not be found.',
    };
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
    const title = image.title && !isTitleFilename ? image.title : 'Shared Photo';
    return {
        title: title,
        description: image.description || `View this photo on ${siteConfig.title}`,
        alternates: {
            canonical: `${BASE_URL}/s/${key}`,
        },
        openGraph: {
            title: title,
            description: image.description || `View this photo on ${siteConfig.title}`,
            url: `${BASE_URL}/s/${key}`,
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
            description: image.description || `View this photo on ${siteConfig.title}`,
            images: [`${BASE_URL}/uploads/webp/${image.filename_webp.replace('.webp', '_2048.webp')}`],
        },
    };
}

export default async function SharedPhotoPage({ params }: { params: Promise<{ key: string }> }) {
    const { key } = await params;
    const image = await getImageByShareKey(key);

    if (!image) {
        notFound();
    }

    return (
        <>
            <div className="flex items-center justify-between mb-4 px-4 pt-4">
                <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    ← {siteConfig.nav_title || siteConfig.title || 'GalleryKit'}
                </Link>
            </div>
            <PhotoViewer
                images={[image]}
                initialImageId={image.id}
                tags={[]}
                prevId={null}
                nextId={null}
            />
        </>
    );
}
