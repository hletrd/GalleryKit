/**
 * Shared sanitization utilities for user-facing input stored in the database.
 */

/** Strip all C0 control characters (0x00–0x1F, including tab, newline, carriage return), DEL (0x7F), and Unicode C1 controls (0x80–0x9F) that can cause MySQL truncation, display issues, or unexpected formatting. */
export function stripControlChars(s: string | null): string | null {
    if (!s) return s;
    return s.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}
