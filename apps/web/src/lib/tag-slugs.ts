type TagLike = { slug: string };

export function parseRequestedTagSlugs(tagsParam?: string) {
    if (!tagsParam) {
        return [];
    }

    const seen = new Set<string>();
    return tagsParam
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
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
