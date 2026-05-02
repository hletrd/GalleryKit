import { LOCALES } from '@/lib/constants';
import { countCodePoints } from '@/lib/utils';

const RESERVED_TOPIC_ROUTE_SEGMENTS = new Set([
    'admin',
    'g',
    'map',
    'p',
    's',
    'uploads',
    // Public file/metadata routes handled outside the dynamic topic route.
    // Keep this list in sync with app/[locale]/(public)/[topic]/page.tsx.
    'apple-icon',
    'favicon.ico',
    'icon',
    'manifest',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml',
    ...LOCALES,
]);

// Validate slug format (lowercase alphanumeric, hyphens, underscores only)
// AGG10-02: `.length` is correct here because the regex `/^[a-z0-9_-]+$/`
// restricts to ASCII characters where `.length` and `countCodePoints()`
// always agree. Same pattern as AGG9R-03 for username validation.
export function isValidSlug(slug: string): boolean {
    return /^[a-z0-9_-]+$/.test(slug) && slug.length > 0 && slug.length <= 100;
}

export function isReservedTopicRouteSegment(segment: string): boolean {
    return RESERVED_TOPIC_ROUTE_SEGMENTS.has(segment.trim().toLowerCase());
}

// Defense-in-depth Unicode-formatting policy applied to every admin-controlled
// string surface that is rendered back to admins or end users:
// - U+202A-202E LRE/RLE/PDF/LRO/RLO and U+2066-2069 LRI/RLI/FSI/PDI
//   (Trojan-Source-style bidi overrides);
// - U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM, U+2060 WJ, U+FEFF BOM, U+180E MVS,
//   U+FFF9-FFFB interlinear annotation anchors (zero-width / invisible
//   formatting characters used for visual spoofing).
//
// Lineage: introduced for CSV export hardening (C7R-RPL-11 / C8R-RPL-01),
// extended to topic aliases (C3L-SEC-01), tag names (C4L-SEC-01),
// topic.label / image.title / image.description (C5L-SEC-01), and
// seo_title / seo_description / seo_nav_title / seo_author (C6L-SEC-01).
// Exported so all consumers share one source of truth and stay in
// lock-step when the character set evolves.
// Character ranges (U+XXXX notation for editor-invariant readability):
//   U+180E MVS, U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM,
//   U+202A-202E LRE/RLE/PDF/LRO/RLO, U+2060 WJ,
//   U+2066-2069 LRI/RLI/FSI/PDI, U+FEFF BOM, U+FFF9-FFFB interlinear anchors
// C18-LOW-01: use \uXXXX escape sequences instead of literal Unicode
// characters so the regex is ASCII-safe and editor-portable. Invisible
// literal characters can be silently stripped by text editors, CI
// systems, or ASCII-only Git configs, breaking the regex without any
// visible diff.
export const UNICODE_FORMAT_CHARS = /[\u180E\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/;

/**
 * Returns true when `value` contains Unicode bidi/invisible formatting
 * characters that should be rejected at admin-controlled string entry
 * points. Null/empty inputs are treated as clean — the field-level
 * required-check decides whether to error on empty separately.
 *
 * Single canonical entry point for the C3L/C4L/C5L/C6L policy. Use this
 * helper at every admin-controlled persistent string write site so the
 * rejection layer has one implementation. Consumers that already trim
 * and assert non-empty (`isValidTopicAlias`, `isValidTagName`) may keep
 * using `UNICODE_FORMAT_CHARS.test(value)` directly without the
 * truthiness guard, since the guard adds a redundant branch.
 */
export function containsUnicodeFormatting(value: string | null | undefined): boolean {
    return !!value && UNICODE_FORMAT_CHARS.test(value);
}

// Allow CJK characters, emojis, and most symbols for aliases, but disallow:
// - Slashes (path separators)
// - Dots because locale middleware treats dotted pathnames as asset requests
// - Backslashes (path separators/escapes)
// - Question marks (query parameters)
// - Hash/Pound (fragments)
// - Whitespace (better UX for URLs, though encoded spaces theoretically work)
// - Unicode bidi/invisible formatting (see `UNICODE_FORMAT_CHARS` lineage).
export function isValidTopicAlias(alias: string): boolean {
    if (UNICODE_FORMAT_CHARS.test(alias)) return false;
    // C21-AGG-02: use countCodePoints for max-length check so CJK/emoji
    // characters (allowed by the regex) count as one character each,
    // matching MySQL's utf8mb4 varchar semantics.
    return alias.length > 0 && countCodePoints(alias) <= 255 && /^[^./\\\s?\x00#<>"'&]+$/.test(alias);
}

// Tag names are admin-controlled and rendered into admin tables and tag-pill
// chips on photo cards. C4L-SEC-01 closes the parity gap with topic aliases
// (C3L-SEC-01) and CSV export (C7R-RPL-11 / C8R-RPL-01) by rejecting Unicode
// bidi overrides and zero-width / invisible formatting characters before they
// can be persisted to `tags.name` and re-rendered into UI surfaces.
export function isValidTagName(tagName: string): boolean {
    const trimmed = tagName.trim();
    if (UNICODE_FORMAT_CHARS.test(trimmed)) return false;
    // C21-AGG-03: use countCodePoints for max-length check so CJK/emoji
    // characters (allowed by the regex) count as one character each,
    // matching MySQL's utf8mb4 varchar semantics.
    return trimmed.length > 0 && countCodePoints(trimmed) <= 100 && !trimmed.includes(',') && !/[<>"'&\x00]/.test(trimmed);
}

export function isValidTagSlug(slug: string): boolean {
    // C30-06: underscores removed from allowed chars to match getTagSlug(),
    // which always replaces underscores with hyphens before producing a slug.
    // Keeping these consistent prevents confusion where a slug passes
    // validation but would never be produced by the slug generator.
    // C22-AGG-01: use countCodePoints for max-length check so supplementary
    // characters (rare CJK ideographs allowed by the \p{Letter} regex) count
    // as one character each, matching MySQL's utf8mb4 varchar semantics and
    // the countCodePoints pattern used in isValidTopicAlias (C21-AGG-02) and
    // isValidTagName (C21-AGG-03). Replaces the prior AGG10-03 `.length`
    // usage which could reject valid supplementary-character slugs that are
    // under the varchar(100) character limit but over 100 UTF-16 code units.
    return /^[\p{Letter}\p{Number}-]+$/u.test(slug) && slug.length > 0 && countCodePoints(slug) <= 100;
}

// Validate filename (no path traversal, only safe characters)
export function isValidFilename(filename: string): boolean {
    // Check for path traversal attempts
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return false;
    }
    // Only allow safe characters and require the name to start with an alphanumeric
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) && filename.length <= 255;
}

/** Type guard for MySQL/Drizzle errors with `.code` property. */
export function isMySQLError(e: unknown): e is Error & { code: string; cause?: { code?: string } } {
    return e instanceof Error && 'code' in e && typeof (e as { code: unknown }).code === 'string';
}

/** True when the top-level or wrapped MySQL/Drizzle error matches the given code. */
export function hasMySQLErrorCode(e: unknown, code: string): boolean {
    return isMySQLError(e) && (e.code === code || e.cause?.code === code);
}

/**
 * Safely coerce a MySQL `insertId` (which may be a `BigInt`) to a `number`.
 *
 * `mysql2` returns `BigInt` when the auto-increment value exceeds
 * `Number.MAX_SAFE_INTEGER`. A bare `Number(insertId)` silently loses precision
 * in that case — the resulting number passes `Number.isFinite()` but refers to
 * the wrong row. This helper validates the value is safe before coercion and
 * throws on overflow so the caller can surface an error instead of persisting
 * a wrong ID.
 *
 * C20-MED-01: used at all three insertId sites (sharing.ts, admin-users.ts,
 * images.ts) to close the BigInt coercion risk class previously flagged as
 * C14-MED-03 / C19F-MED-02.
 */
export function safeInsertId(insertId: number | bigint): number {
    if (typeof insertId === 'bigint') {
        if (insertId > BigInt(Number.MAX_SAFE_INTEGER) || insertId < BigInt(Number.MIN_SAFE_INTEGER)) {
            throw new Error(`insertId ${insertId} exceeds Number.MAX_SAFE_INTEGER — cannot safely coerce to number`);
        }
        return Number(insertId);
    }
    // number path — still validate for Infinity/NaN from malformed results
    if (!Number.isFinite(insertId) || insertId < 0) {
        throw new Error(`insertId ${insertId} is not a valid auto-increment ID`);
    }
    return insertId;
}
