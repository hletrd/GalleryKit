type TagLike = { slug: string };

export function parseRequestedTagSlugs(tagsParam?: string) {
    return tagsParam
        ? tagsParam.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];
}

export function filterExistingTagSlugs<T extends TagLike>(requestedTagSlugs: string[], availableTags: T[]) {
    return requestedTagSlugs.filter((slug) => availableTags.some((tag) => tag.slug === slug));
}
