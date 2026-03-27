import { getSharedGroup } from '@/lib/data';
import { notFound } from 'next/navigation';
import PhotoViewer from '@/components/photo-viewer';
import Image from 'next/image';
import Link from 'next/link';
import siteConfig from '@/site-config.json';
import { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const group = await getSharedGroup(key);
    if (!group) return {};
    return {
        title: `Shared Photos`,
        description: `View ${group.images.length} shared photos`,
    };
}

export default async function SharedGroupPage({ params, searchParams }: { params: Promise<{ key: string }>, searchParams: Promise<{ photoId?: string }> }) {
    const { key } = await params;
    const { photoId: photoIdParam } = await searchParams;
    const group = await getSharedGroup(key);

    if (!group) {
        notFound();
    }

    // Validate photoId is a valid positive integer
    let photoId: number | null = null;
    if (photoIdParam) {
        const parsed = parseInt(photoIdParam, 10);
        if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
            photoId = parsed;
        }
    }

    let selectedImage = null;
    let prevId: number | null = null;
    let nextId: number | null = null;

    if (photoId) {
        const index = group.images.findIndex(img => img.id === photoId);
        if (index !== -1) {
            selectedImage = group.images[index];
            prevId = index > 0 ? group.images[index - 1].id : null;
            nextId = index < group.images.length - 1 ? group.images[index + 1].id : null;
        }
    }

    if (selectedImage) {
        return (
            <>
                <div className="flex items-center justify-between mb-4 px-4 pt-4">
                    <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                        ← {siteConfig.nav_title || siteConfig.title || 'GalleryKit'}
                    </Link>
                </div>
                <PhotoViewer
                    images={[selectedImage]}
                    initialImageId={selectedImage.id}
                    tags={[]}
                    prevId={prevId}
                    nextId={nextId}
                />
            </>
        );
    }

    // Render Grid
    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">Shared Photos</h1>
                <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    ← {siteConfig.nav_title || siteConfig.title || 'GalleryKit'}
                </Link>
            </div>
            <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {group.images.map((image) => {
                    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
                    const altText = image.title && !isTitleFilename ? image.title : 'Photo';

                    return (
                        <Link
                            key={image.id}
                            href={`/g/${key}?photoId=${image.id}`}
                            className="block break-inside-avoid relative group overflow-hidden rounded-lg bg-gray-100"
                        >
                             <Image
                                src={`/uploads/webp/${image.filename_webp.replace('.webp', '_1536.webp')}`}
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
                    No images in this group.
                </div>
            )}
        </div>
    );
}
