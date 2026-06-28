/**
 * Parse a `?page=` query-string value into a clamped, 1-based integer page
 * number in `[1, maxPage]`.
 *
 * R22C22 T2 (DBG22-03): uses `Number()` not `parseInt()`. `parseInt('1e3', 10)`
 * stops at the `e` and returns `1`, so `?page=1e3` silently paginated to page 1
 * instead of 1000 (the same env/user-input parse class swept across the codebase
 * in cycle-20/21). `Number('1e3') === 1000`. Non-numeric input (`NaN`), zero,
 * and negative values fall back to page 1; fractional values are floored
 * (matching the prior `parseInt` truncation, e.g. `'3.9'` → 3).
 */
export function parsePageParam(raw: string | undefined | null, maxPage: number): number {
    const n = Number(raw ?? '');
    const page = Number.isFinite(n) ? Math.floor(n) : 1;
    return Math.min(Math.max(1, page || 1), Math.max(1, maxPage));
}
