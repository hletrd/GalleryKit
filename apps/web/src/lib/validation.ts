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

// Allow CJK characters, emojis, and most symbols for aliases, but disallow:
// - Slashes (path separators)
// - Dots because locale middleware treats dotted pathnames as asset requests
// - Backslashes (path separators/escapes)
// - Question marks (query parameters)
// - Hash/Pound (fragments)
// - Whitespace (better UX for URLs, though encoded spaces theoretically work)
export function isValidTopicAlias(alias: string): boolean {
    return alias.length > 0 && alias.length <= 255 && /^[^./\\\s?\x00#<>"'&]+$/.test(alias);
}

export function isValidTagName(tagName: string): boolean {
    const trimmed = tagName.trim();
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
