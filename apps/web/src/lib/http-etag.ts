function splitEntityTagList(value: string): string[] {
    const tags: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of value) {
        if (char === '"') {
            inQuotes = !inQuotes;
        }

        if (char === ',' && !inQuotes) {
            tags.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        tags.push(current.trim());
    }

    return tags;
}

function normalizeEntityTagForWeakComparison(tag: string): string | null {
    const trimmed = tag.trim();
    const withoutWeakPrefix = trimmed.startsWith('W/')
        ? trimmed.slice(2)
        : trimmed;

    if (!withoutWeakPrefix.startsWith('"') || !withoutWeakPrefix.endsWith('"')) {
        return null;
    }

    return withoutWeakPrefix;
}

/**
 * RFC 9110 Section 13.1.2 requires If-None-Match to use weak entity-tag
 * comparison, so W/"x" and "x" match when their opaque tags are identical.
 */
export function ifNoneMatchMatches(ifNoneMatch: string | null, currentEtag: string): boolean {
    if (!ifNoneMatch) return false;

    const normalizedCurrent = normalizeEntityTagForWeakComparison(currentEtag);
    if (!normalizedCurrent) return false;

    return splitEntityTagList(ifNoneMatch).some((candidate) => {
        if (candidate === '*') return true;
        return normalizeEntityTagForWeakComparison(candidate) === normalizedCurrent;
    });
}
