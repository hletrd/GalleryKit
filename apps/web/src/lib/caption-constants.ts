/**
 * Client-safe constants for the [AUTO] stub prefix used by the caption
 * generator (US-P52). Extracted so photo-title.ts and the client-side
 * viewer can consume these without pulling in the server-only
 * caption-generator module.
 *
 * ARCH-R5C2-02: single source of truth — both caption-generator.ts and
 * photo-title.ts must import from here; they must not define their own
 * copies of these values.
 */

/** Prefix prepended to every AI-generated alt-text stub. */
export const ALT_TEXT_STUB_PREFIX = '[AUTO] ';

/**
 * Anchored RegExp that matches the leading stub prefix (plus any
 * trailing whitespace). Module-level constant — avoid rebuilding on
 * every call.
 */
export const ALT_TEXT_STUB_PREFIX_RE = new RegExp(
    `^${ALT_TEXT_STUB_PREFIX.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`
);

/**
 * Strip one leading occurrence of ALT_TEXT_STUB_PREFIX from `value`.
 * Returns the remainder. The caller is responsible for empty-string
 * handling (e.g. falling through to a generic fallback).
 */
export function stripStubPrefix(value: string): string {
    return value.replace(ALT_TEXT_STUB_PREFIX_RE, '');
}
