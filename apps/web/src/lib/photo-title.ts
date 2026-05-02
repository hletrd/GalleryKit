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

/**
 * AGG1L-LOW-01 / plan-301-A: humanize a slug- or word-shaped tag label.
 *
 * Tag slugs (and `tag_names` rows derived from them) canonically use `_`
 * as a word separator. The visible UI, the alt-text, and the JSON-LD
 * `name` field should all show those as spaces — `Color_in_Music_Festival`
 * is awkward in every consumer.
 *
 * The single source of truth for the transform lives here so visible UI,
 * alt text, and structured-data emitters cannot drift from each other.
 */
export function humanizeTagLabel(name: string): string {
    return name.replace(/_/g, ' ');
}

export function getPhotoDisplayTitle(
    image: PhotoTitleInput,
    fallback: string,
    options: PhotoTitleOptions = {},
): string {
    if (options.preferTags && image.tags && image.tags.length > 0) {
        return image.tags.map((tag) => `#${humanizeTagLabel(tag.name)}`).join(' ');
    }

    if (image.title && image.title.trim() && !isFilenameLikeTitle(image.title)) {
        if (options.formatTitleAsTags) {
            return image.title.split(/\s+/).map((word) => `#${word}`).join(' ');
        }
        return image.title;
    }

    if (image.tags && image.tags.length > 0) {
        return image.tags.map((tag) => `#${humanizeTagLabel(tag.name)}`).join(' ');
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
    image: {
        title: string | null | undefined;
        tag_names?: string | null | undefined;
        // US-P52: AI-generated alt text suggestion. Used as fallback when
        // title and tags are absent. Admin-set alt always takes precedence.
        alt_text_suggested?: string | null | undefined;
    },
    fallback: string,
): string {
    // F-18 / AGG1L-LOW-01: derive alt text from the photo's tag list (or
    // title) so screen reader users get distinguishable per-photo labels
    // instead of a wall of identical "Photo" placeholders. Underscores
    // are normalized via `humanizeTagLabel` (now applied at the helper
    // level above), so this routine just strips the `#` prefix marks
    // that `getPhotoDisplayTitle` adds for visual hashtag formatting.
    //
    // Fallback chain: title > tag-derived > alt_text_suggested > fallback
    // US-P52: if neither title nor tags produce a non-fallback result,
    // use alt_text_suggested before the generic fallback string.
    const hasMeaningfulTitle = image.title && image.title.trim() && !isFilenameLikeTitle(image.title);
    const hasTags = image.tag_names && image.tag_names.trim();
    if (!hasMeaningfulTitle && !hasTags && image.alt_text_suggested && image.alt_text_suggested.trim()) {
        return image.alt_text_suggested.trim();
    }
    return getPhotoDisplayTitleFromTagNames(image, fallback)
        .replace(/^#+/, '')
        .replace(/\s+#/g, ', ');
}
