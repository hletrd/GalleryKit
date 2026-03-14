'use client';


import Link from 'next/link';
import { TagFilter } from '@/components/tag-filter';
import { useTranslation } from "@/components/i18n-provider";
import { OptimisticImage } from './optimistic-image';

interface HomeClientProps {
    images: any[];
    tags: any[];
    currentTags?: string[];
}

export function HomeClient({ images, tags, currentTags }: HomeClientProps) {
    const { t } = useTranslation();
    const displayTags = (currentTags || []).map((tag) => {
        const match = tags.find((t: any) => t.slug === tag.trim().toLowerCase());
        return match?.name ?? tag;
    });

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">
                        {t('home.latestUploads')}
                        {currentTags && currentTags.length > 0 && (
                            <span className="text-muted-foreground font-normal ml-2">
                                {displayTags.map(tag => `#${tag}`).join(' ')}
                            </span>
                        )}
                    </h1>
                    <p className="text-muted-foreground">
                        {t('home.metaTitle', { count: images.length })}
                    </p>
                </div>
                <TagFilter tags={tags} />
            </div>

            <div className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 gap-4 space-y-4">
                {images.map((image) => {
                    const altText = (image.description && image.description.trim())
                        ? image.description
                        : (image.title && image.title.trim() && !image.title.match(/\.[a-z0-9]{3,4}$/i))
                            ? image.title
                            : image.tag_names
                                ? image.tag_names.split(',').map((t: string) => t.trim()).join(', ')
                                : 'Photo';
                    const displayTitle = (() => {
                        if (image.title && image.title.trim().length > 0) {
                             return image.title;
                        }
                        if (image.tag_names) {
                            return image.tag_names.split(',').map((tag: string) => `#${tag.trim()}`).join(' ');
                        }
                        return image.user_filename || 'Untitled';
                    })();

                    return (
                        <div
                            key={image.id}
                            className="break-inside-avoid relative group overflow-hidden rounded-xl bg-muted/20 [mask-image:radial-gradient(white,black)]"
                            style={image.blur_data_url ? {
                                backgroundImage: `url(${image.blur_data_url})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                            } : undefined}
                        >
                            <Link href={`/p/${image.id}`}>
                                <div className="relative w-full">
                                    <picture>
                                        {(() => {
                                            const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
                                            const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');

                                            if (baseWebp && baseAvif) {
                                                return (
                                                    <>
                                                        <source
                                                            type="image/avif"
                                                            srcSet={`/uploads/avif/${baseAvif}_640.avif 640w, /uploads/avif/${baseAvif}_1536.avif 1536w`}
                                                            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                        />
                                                        <source
                                                            type="image/webp"
                                                            srcSet={`/uploads/webp/${baseWebp}_640.webp 640w, /uploads/webp/${baseWebp}_1536.webp 1536w`}
                                                            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                        />
                                                        <img
                                                            src={`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, '_640.jpg')}`}
                                                            alt={altText}
                                                            width={image.width}
                                                            height={image.height}
                                                            className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                            loading="lazy"
                                                            decoding="async"
                                                        />
                                                    </>
                                                );
                                            }

                                            return (
                                                <OptimisticImage
                                                    src={`/uploads/jpeg/${image.filename_jpeg}`}
                                                    alt={altText}
                                                    width={image.width}
                                                    height={image.height}
                                                    className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                    sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                    blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                                                    placeholder="blur"
                                                />
                                            );
                                        })()}
                                    </picture>
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                                        <h3 className="text-white font-medium truncate">
                                            {displayTitle}
                                        </h3>
                                        <p className="text-white/80 text-xs truncate">{image.topic}</p>
                                    </div>
                                </div>
                            </Link>
                        </div>
                    );
                })}
            </div>

            {images.length === 0 && (
                <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-xl text-muted-foreground gap-2">
                    <p>{t('home.noImages')}</p>
                    {currentTags && currentTags.length > 0 && (
                        <Link href="/" className="underline hover:text-primary">
                            {t('home.clearFilter')}
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
