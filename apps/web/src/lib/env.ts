export function parseBoundedPositiveInteger(
    raw: string | undefined,
    {
        fallback,
        max,
    }: {
        fallback: number;
        max: number;
    },
): number {
    if (!Number.isInteger(fallback) || fallback < 1) {
        throw new Error('fallback must be a positive integer');
    }
    if (!Number.isInteger(max) || max < fallback) {
        throw new Error('max must be an integer greater than or equal to fallback');
    }

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) {
        return fallback;
    }

    return Math.min(Math.floor(value), max);
}
