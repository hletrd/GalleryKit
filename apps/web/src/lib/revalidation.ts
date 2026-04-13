import { revalidatePath } from 'next/cache';

import { LOCALES } from '@/lib/constants';

function normalizePath(path: string): string {
    if (!path) return '/';
    if (path === '/') return '/';
    return path.startsWith('/') ? path : `/${path}`;
}

export function getLocalizedPathVariants(path: string): string[] {
    const normalizedPath = normalizePath(path);
    const segments = normalizedPath.split('/').filter(Boolean);
    const firstSegment = segments[0]?.toLowerCase();

    if (firstSegment && (LOCALES as readonly string[]).includes(firstSegment)) {
        return [normalizedPath];
    }

    const variants = new Set<string>([normalizedPath]);
    for (const locale of LOCALES) {
        variants.add(normalizedPath === '/' ? `/${locale}` : `/${locale}${normalizedPath}`);
    }

    return [...variants];
}

export function revalidateLocalizedPaths(...paths: string[]) {
    const seen = new Set<string>();

    for (const path of paths) {
        for (const variant of getLocalizedPathVariants(path)) {
            if (seen.has(variant)) continue;
            seen.add(variant);
            revalidatePath(variant);
        }
    }
}
