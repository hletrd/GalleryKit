import { getImageByShareKey } from '@/lib/data';
import { notFound } from 'next/navigation';
import PhotoViewer from '@/components/photo-viewer';
import Link from 'next/link';
import siteConfig from '@/site-config.json';
import { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const image = await getImageByShareKey(key);
    if (!image) return {};
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
    return {
        title: image.title && !isTitleFilename ? image.title : 'Shared Photo',
        description: image.description || 'View this photo on Gallery',
        openGraph: {
            images: [`/uploads/webp/${image.filename_webp.replace('.webp', '_2048.webp')}`]
        }
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
                    ← {siteConfig.nav_title || siteConfig.title || 'Gallery'}
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
