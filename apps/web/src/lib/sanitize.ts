/**
 * Shared sanitization utilities for user-facing input stored in the database.
 */

/** Strip null bytes and control characters (including DEL) that can cause MySQL truncation or display issues. */
export function stripControlChars(s: string | null): string | null {
    if (!s) return s;
    return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
