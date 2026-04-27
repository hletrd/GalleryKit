/**
 * Shared sanitization utilities for user-facing input stored in the database.
 */

/** Strip all C0 control characters (0x00–0x1F, including tab, newline, carriage return), DEL (0x7F), and Unicode C1 controls (0x80–0x9F) that can cause MySQL truncation, display issues, or unexpected formatting. */
export function stripControlChars(s: string | null): string | null {
    if (!s) return s;
    return s.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

/**
 * AGG4R2-06: Combines stripControlChars + reject-if-changed into one call.
 * Returns `{ value, rejected }` where `value` is the sanitized string and
 * `rejected` is true when sanitization changed the input (meaning it
 * contained control characters). Callers should return an error when
 * `rejected` is true instead of silently proceeding with stripped data.
 *
 * Before this helper, the pattern `stripControlChars(raw) + if (clean !== raw)`
 * was copy-pasted across 14+ call sites in actions/.
 *
 * @param raw  The raw user input (may be null/undefined).
 * @param trim Whether to trim whitespace before sanitizing (default: true).
 */
export function requireCleanInput(raw: string | null | undefined, trim = true): { value: string; rejected: boolean } {
    const input = trim ? (raw?.trim() ?? '') : (raw ?? '');
    const sanitized = stripControlChars(input) ?? '';
    return { value: sanitized, rejected: sanitized !== input };
}
