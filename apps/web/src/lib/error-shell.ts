type ErrorShellDataset = {
    galleryNavTitle?: string;
    galleryTitle?: string;
};

type ErrorShellDocumentLike = {
    title?: string | null;
    documentElement?: {
        dataset?: ErrorShellDataset | null;
    } | null;
} | null | undefined;

function normalizeBrand(value: string | null | undefined) {
    const normalized = value?.trim().replace(/\s+/g, ' ');
    return normalized ? normalized : null;
}

function brandFromDocumentTitle(title: string | null | undefined) {
    const normalizedTitle = normalizeBrand(title);
    if (!normalizedTitle) {
        return null;
    }

    const segments = normalizedTitle
        .split('|')
        .map((segment) => normalizeBrand(segment))
        .filter((segment): segment is string => !!segment);

    if (segments.length === 0) {
        return null;
    }

    return segments[segments.length - 1];
}

export function resolveErrorShellBrand(
    documentLike: ErrorShellDocumentLike,
    fallbackNavTitle: string,
    fallbackTitle: string,
) {
    const dataset = documentLike?.documentElement?.dataset;

    return normalizeBrand(dataset?.galleryNavTitle)
        ?? normalizeBrand(dataset?.galleryTitle)
        ?? brandFromDocumentTitle(documentLike?.title)
        ?? normalizeBrand(fallbackNavTitle)
        ?? normalizeBrand(fallbackTitle)
        ?? 'Gallery';
}
