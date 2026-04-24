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

    const seen = new Set<string>();
    return tagsParam
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, MAX_TAG_COUNT)
        .filter((slug) => {
            if (seen.has(slug)) {
                return false;
            }
            seen.add(slug);
            return true;
        });
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
