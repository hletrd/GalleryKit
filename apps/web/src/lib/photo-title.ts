import type { TagInfo } from '@/lib/image-types';

interface PhotoTitleInput {
    title: string | null;
    tags?: TagInfo[] | null;
}

interface PhotoTitleOptions {
    preferTags?: boolean;
    formatTitleAsTags?: boolean;
}

export function isFilenameLikeTitle(title: string | null | undefined): boolean {
    return Boolean(title && /\.[a-z0-9]{3,4}$/i.test(title));
}

export function getPhotoDisplayTitle(
    image: PhotoTitleInput,
    fallback: string,
    options: PhotoTitleOptions = {},
): string {
    if (options.preferTags && image.tags && image.tags.length > 0) {
        return image.tags.map((tag) => `#${tag.name}`).join(' ');
    }

    if (image.title && image.title.trim() && !isFilenameLikeTitle(image.title)) {
        if (options.formatTitleAsTags) {
            return image.title.split(/\s+/).map((word) => `#${word}`).join(' ');
        }
        return image.title;
    }

    if (image.tags && image.tags.length > 0) {
        return image.tags.map((tag) => `#${tag.name}`).join(' ');
    }

    return fallback;
}

export function getPhotoDocumentTitle(
    displayTitle: string | null,
    siteTitle: string,
    fallbackTitle: string,
): string {
    return displayTitle ? `${displayTitle} — ${siteTitle}` : fallbackTitle;
}


export function getPhotoDisplayTitleFromTagNames(
    image: { title: string | null | undefined; tag_names?: string | null | undefined },
    fallback: string,
): string {
    const tags = image.tag_names
        ?.split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

    return getPhotoDisplayTitle(
        {
            title: image.title ?? null,
            tags: tags?.map((name) => ({ id: 0, name, slug: name })) ?? null,
        },
        fallback,
    );
}

export function getConcisePhotoAltText(
    image: { title: string | null | undefined; tag_names?: string | null | undefined },
    fallback: string,
): string {
    return getPhotoDisplayTitleFromTagNames(image, fallback).replace(/^#+/, '').replace(/\s+#/g, ', ');
}
