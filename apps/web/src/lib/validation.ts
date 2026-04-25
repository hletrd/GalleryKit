import { LOCALES } from '@/lib/constants';

const RESERVED_TOPIC_ROUTE_SEGMENTS = new Set([
    'admin',
    'g',
    'p',
    's',
    'uploads',
    ...LOCALES,
]);

// Validate slug format (lowercase alphanumeric, hyphens, underscores only)
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
// extended to topic aliases (C3L-SEC-01), tag names (C4L-SEC-01), and
// topic.label / image.title / image.description (C5L-SEC-01). Exported so
// all consumers share one source of truth and stay in lock-step when the
// character set evolves.
export const UNICODE_FORMAT_CHARS = /[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/;

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
    return alias.length > 0 && alias.length <= 255 && /^[^./\\\s?\x00#<>"'&]+$/.test(alias);
}

// Tag names are admin-controlled and rendered into admin tables and tag-pill
// chips on photo cards. C4L-SEC-01 closes the parity gap with topic aliases
// (C3L-SEC-01) and CSV export (C7R-RPL-11 / C8R-RPL-01) by rejecting Unicode
// bidi overrides and zero-width / invisible formatting characters before they
// can be persisted to `tags.name` and re-rendered into UI surfaces.
export function isValidTagName(tagName: string): boolean {
    const trimmed = tagName.trim();
    if (UNICODE_FORMAT_CHARS.test(trimmed)) return false;
    return trimmed.length > 0 && trimmed.length <= 100 && !trimmed.includes(',') && !/[<>"'&\x00]/.test(trimmed);
}

export function isValidTagSlug(slug: string): boolean {
    return /^[\p{Letter}\p{Number}_-]+$/u.test(slug) && slug.length > 0 && slug.length <= 100;
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
