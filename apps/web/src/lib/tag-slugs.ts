type TagLike = { slug: string };

const MAX_TAG_QUERY_LENGTH = 256;
const MAX_TAG_COUNT = 20;

export function parseRequestedTagSlugs(tagsParam?: string) {
    if (!tagsParam) {
        return [];
    }

    if (tagsParam.length > MAX_TAG_QUERY_LENGTH) {
        return [];
    }

    return canonicalizeRequestedTagSlugs(tagsParam.split(','));
}

export function canonicalizeRequestedTagSlugs(tagSlugs: string[]) {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const rawSlug of tagSlugs) {
        const slug = rawSlug.trim();
        if (!slug || seen.has(slug)) {
            continue;
        }
        seen.add(slug);
        out.push(slug);
        if (out.length >= MAX_TAG_COUNT) {
            break;
        }
    }

    return out;
}

export function filterExistingTagSlugs<T extends TagLike>(requestedTagSlugs: string[], availableTags: T[]) {
    const seen = new Set<string>();
    return requestedTagSlugs.filter((slug) => {
        if (seen.has(slug)) {
            return false;
        }
        const exists = availableTags.some((tag) => tag.slug === slug);
        if (exists) {
            seen.add(slug);
        }
        return exists;
    });
}
