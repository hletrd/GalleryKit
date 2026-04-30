/**
 * Shared sanitization utilities for user-facing input stored in the database.
 */

import { UNICODE_FORMAT_CHARS } from '@/lib/validation';

// C7-AGG7R-03: Unicode bidi overrides, zero-width / invisible formatting
// characters, and interlinear annotation anchors. Added to stripControlChars
// so stripping + rejection happen in one place. `containsUnicodeFormatting`
// in validation.ts remains as a secondary defense-in-depth guard.
// Character ranges (matching UNICODE_FORMAT_CHARS in validation.ts):
//   U+180E MVS, U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM,
//   U+202A-202E LRE/RLE/PDF/LRO/RLO, U+2060 WJ,
//   U+2066-2069 LRI/RLI/FSI/PDI, U+FEFF BOM, U+FFF9-FFFB interlinear anchors
const UNICODE_FORMAT_CHARS_RE = /[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/g;

/** Strip all C0 control characters (0x00–0x1F, including tab, newline, carriage return), DEL (0x7F), Unicode C1 controls (0x80–0x9F), and Unicode bidi/invisible formatting characters that can cause MySQL truncation, display issues, unexpected formatting, or Trojan-Source-style visual spoofing. */
export function stripControlChars(s: string | null): string | null {
    if (!s) return s;
    return s.replace(/[\x00-\x1F\x7F-\x9F]/g, '').replace(UNICODE_FORMAT_CHARS_RE, '');
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

/**
 * Sanitize stderr from mysqldump/mysql child processes before logging.
 * stderr may contain connection strings or passwords (e.g.,
 * "Access denied for user 'gallery'@'10.0.0.1' (using password: YES)").
 * Redact the MYSQL_PWD value and common credential patterns.
 *
 * Two regexes cover distinct MySQL error message formats:
 *
 * Regex 1: matches "password=VALUE" and "password:VALUE" patterns.
 * Broadened from "=" only to "[:=]" (C4-AGG-08) to also match
 * colon-separated credential patterns.
 *
 * Regex 2: matches the specific MySQL "using password: YES/NO" format
 * that appears in Access denied messages. Although regex 1 overlaps for
 * the "password:" case, this regex is intentionally kept because
 * "using password:" is a distinct MySQL error format prefix. Removing
 * it could miss edge cases with custom auth plugins that emit
 * "using password: <hash>".
 *
 * Do NOT remove either regex without understanding both formats.
 * Moved from db-actions.ts for unit-testability (C5-AGG-01).
 */
export function sanitizeStderr(data: Buffer | string, pwd?: string): string {
    let text = typeof data === 'string' ? data : data.toString('utf8');
    // Redact the actual password value if it appears in stderr
    if (pwd && pwd.length > 0) {
        // Escape regex-special chars in the password
        const escaped = pwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
    // Regex 1: generic password=VALUE and password:VALUE patterns (see doc above)
    text = text.replace(/(password\s*[:=]\s*)[^\s;'"`)]*/gi, '$1[REDACTED]');
    // Regex 2: specific MySQL "using password: YES/NO" format (see doc above)
    text = text.replace(/(using password:\s*)[^\s)]+/gi, '$1[REDACTED]');
    return text;
}

/**
 * C7-AGG7R-03: Combined sanitization + validation for admin-controlled
 * persistent strings. Strips C0/C1 controls and Unicode bidi/invisible
 * formatting characters, then rejects if the original input contained
 * formatting characters (defense-in-depth).
 *
 * Before this helper, every admin string entry point had to call both
 * `stripControlChars` and `containsUnicodeFormatting` separately. Missing
 * either one allowed bidi/zero-width characters through. This helper
 * enforces the contract at the function level.
 *
 * @param raw  The raw user input (may be null/undefined).
 * @param trim Whether to trim whitespace before sanitizing (default: true).
 * @returns `{ value, rejected }` where `rejected` is true when Unicode
 *          formatting characters were found in the input. Callers should
 *          return an error when `rejected` is true.
 */
export function sanitizeAdminString(raw: string | null | undefined, trim = true): { value: string | null; rejected: boolean } {
    if (!raw) return { value: raw ?? null, rejected: false };
    const input = trim ? raw.trim() : raw;

    // C8-AGG8R-01: Use UNICODE_FORMAT_CHARS (non-`/g`) for .test()
    // instead of UNICODE_FORMAT_CHARS_RE (which has `/g` flag). The `/g`
    // flag makes .test() stateful — it advances lastIndex on each call,
    // causing the rejected flag to alternate between true and false on
    // repeated calls with the same input. .replace() is not affected
    // (it always starts from the beginning), so UNICODE_FORMAT_CHARS_RE
    // with `/g` is still correct for stripControlChars.
    // C1F-CR-08 / C1F-TE-05: return null when rejected=true so callers cannot
    // accidentally persist a stripped value that looks visually identical to
    // the original (with invisible formatting chars removed). All current
    // callers already return errors on rejected=true, so this is backward-
    // compatible. Returning null forces explicit handling of the rejection.
    if (UNICODE_FORMAT_CHARS.test(input)) {
        return { value: null, rejected: true };
    }

    const stripped = stripControlChars(input) ?? '';
    return { value: stripped, rejected: stripped !== input };
}
