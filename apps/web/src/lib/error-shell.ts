type ErrorShellDataset = {
    galleryNavTitle?: string;
    galleryTitle?: string;
};

type ErrorShellClassListLike = {
    contains(token: string): boolean;
};

type ErrorShellDocumentLike = {
    title?: string | null;
    documentElement?: {
        dataset?: ErrorShellDataset | null;
        classList?: ErrorShellClassListLike | null;
    } | null;
} | null | undefined;

/**
 * COR-R4C15-01: resolve the theme class the crashed document was using
 * so the global error shell can re-apply it to the fresh `<html>` it
 * renders. The theme system ships FOUR themes (`lib/theme.ts`
 * THEME_VALUES: system/light/dark/oled) and next-themes applies the
 * resolved theme name as the `<html>` class — `oled` (true black,
 * `globals.css` `.oled`) is a SIBLING of `dark`, not a subclass, so a
 * dark-only check renders OLED users a blinding white fatal-error page.
 *
 * The return contract is deliberately closed (`'oled' | 'dark' | null`,
 * null = light tokens via `:root`) so adding a fifth theme forces a
 * conscious decision here instead of silently falling through to light.
 * `oled` wins the defensive both-classes case (more specific token set).
 *
 * Pure helper (mirrors `resolveErrorShellBrand` below) so
 * `__tests__/error-shell.test.ts` can lock it without rendering React.
 */
export function resolveErrorShellThemeClass(
    documentLike: ErrorShellDocumentLike,
): 'oled' | 'dark' | null {
    const classList = documentLike?.documentElement?.classList;
    if (!classList) {
        return null;
    }
    if (classList.contains('oled')) {
        return 'oled';
    }
    if (classList.contains('dark')) {
        return 'dark';
    }
    return null;
}

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
