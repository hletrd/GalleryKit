/**
 * Shared sanitization utilities for user-facing input stored in the database.
 */

/** Strip all C0 control characters (0x00–0x1F, including tab, newline, carriage return), DEL (0x7F), and Unicode C1 controls (0x80–0x9F) that can cause MySQL truncation, display issues, or unexpected formatting. */
export function stripControlChars(s: string | null): string | null {
    if (!s) return s;
    return s.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

/**
 * Validate and normalize a Record<string, string> payload from a Server Action.
 * TypeScript only protects first-party callers; runtime Server Action payloads
 * can contain non-string values (null, number, array) that would cause a
 * TypeError when .trim() is called. This helper validates the input shape
 * and returns a structured error instead of throwing.
 *
 * @param input    The raw payload from the Server Action call.
 * @param allowedKeys  If provided, only these keys are permitted; others cause rejection.
 * @returns On success: `{ ok: true, record: Record<string, string> }` with trimmed+stripped values.
 *          On failure: `{ ok: false, error: string }` with a descriptive error key.
 */
export function normalizeStringRecord(
    input: unknown,
    allowedKeys?: Set<string>,
): { ok: true; record: Record<string, string> } | { ok: false; error: string } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, error: 'invalidInput' };
    }
    const raw = input as Record<string, unknown>;
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(raw)) {
        if (allowedKeys && !allowedKeys.has(key)) {
            return { ok: false, error: 'invalidSettingKey' };
        }
        if (typeof value !== 'string') {
            return { ok: false, error: 'invalidInput' };
        }
        result[key] = stripControlChars(value.trim()) ?? '';
    }
    return { ok: true, record: result };
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
