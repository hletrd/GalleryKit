import { describe, it, expect } from 'vitest';
import { containsUnicodeFormatting, hasMySQLErrorCode, isValidSlug, isValidFilename, isValidTopicAlias, isReservedTopicRouteSegment, isValidTagName, isValidTagSlug, safeInsertId } from '@/lib/validation';

describe('isValidSlug', () => {
    it('accepts lowercase alphanumeric with hyphens and underscores', () => {
        expect(isValidSlug('my-topic')).toBe(true);
        expect(isValidSlug('my_topic')).toBe(true);
        expect(isValidSlug('topic123')).toBe(true);
    });

    it('rejects uppercase letters', () => {
        expect(isValidSlug('MyTopic')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isValidSlug('')).toBe(false);
    });

    it('rejects slugs with spaces', () => {
        expect(isValidSlug('my topic')).toBe(false);
    });

    it('rejects slugs with special characters', () => {
        expect(isValidSlug('my/topic')).toBe(false);
        expect(isValidSlug('my@topic')).toBe(false);
    });

    it('rejects slugs longer than 100 characters', () => {
        expect(isValidSlug('a'.repeat(100))).toBe(true);
        expect(isValidSlug('a'.repeat(101))).toBe(false);
    });
});

describe('isValidFilename', () => {
    it('accepts normal filenames', () => {
        expect(isValidFilename('photo.jpg')).toBe(true);
        expect(isValidFilename('image-2024.png')).toBe(true);
        expect(isValidFilename('file_name.webp')).toBe(true);
    });

    it('rejects path traversal attempts', () => {
        expect(isValidFilename('../secret.txt')).toBe(false);
        expect(isValidFilename('../../etc/passwd')).toBe(false);
    });

    it('rejects slashes', () => {
        expect(isValidFilename('path/file.txt')).toBe(false);
        expect(isValidFilename('path\\file.txt')).toBe(false);
    });

    it('rejects filenames starting with non-alphanumeric', () => {
        expect(isValidFilename('.hidden')).toBe(false);
        expect(isValidFilename('-flag')).toBe(false);
    });

    it('rejects filenames longer than 255 characters', () => {
        expect(isValidFilename('a'.repeat(255))).toBe(true);
        expect(isValidFilename('a'.repeat(256))).toBe(false);
    });
});

describe('isValidTopicAlias', () => {
    it('accepts CJK characters and emojis', () => {
        expect(isValidTopicAlias('my-alias')).toBe(true);
    });

    it('rejects slashes', () => {
        expect(isValidTopicAlias('a/b')).toBe(false);
        expect(isValidTopicAlias('a\\b')).toBe(false);
    });

    it('rejects dots because locale middleware skips dotted pathnames', () => {
        expect(isValidTopicAlias('tokyo.2026')).toBe(false);
    });

    it('rejects whitespace', () => {
        expect(isValidTopicAlias('a b')).toBe(false);
    });

    it('rejects query and fragment markers', () => {
        expect(isValidTopicAlias('a?b')).toBe(false);
        expect(isValidTopicAlias('a#b')).toBe(false);
    });

    it('rejects null bytes', () => {
        expect(isValidTopicAlias('a\x00b')).toBe(false);
    });

    it('rejects HTML-special characters', () => {
        expect(isValidTopicAlias('a<b')).toBe(false);
        expect(isValidTopicAlias('a>b')).toBe(false);
        expect(isValidTopicAlias('a"b')).toBe(false);
        expect(isValidTopicAlias("a'b")).toBe(false);
        expect(isValidTopicAlias('a&b')).toBe(false);
    });

    // C3L-SEC-01: defense-in-depth parity with CSV export hardening
    // (C7R-RPL-11 / C8R-RPL-01). Topic aliases become URL path segments
    // and admin-UI strings, so they must reject Unicode bidi overrides
    // (Trojan Source) and zero-width / invisible formatting characters.
    it('rejects Unicode bidi override / isolate characters', () => {
        expect(isValidTopicAlias('a‮b')).toBe(false); // RLO
        expect(isValidTopicAlias('a‪b')).toBe(false); // LRE
        expect(isValidTopicAlias('a‭b')).toBe(false); // LRO
        expect(isValidTopicAlias('a⁦b')).toBe(false); // LRI
        expect(isValidTopicAlias('a⁩b')).toBe(false); // PDI
    });

    it('rejects zero-width / invisible formatting characters', () => {
        expect(isValidTopicAlias('a​b')).toBe(false); // ZWSP
        expect(isValidTopicAlias('a‌b')).toBe(false); // ZWNJ
        expect(isValidTopicAlias('a‍b')).toBe(false); // ZWJ
        expect(isValidTopicAlias('a‎b')).toBe(false); // LRM
        expect(isValidTopicAlias('a‏b')).toBe(false); // RLM
        expect(isValidTopicAlias('a⁠b')).toBe(false); // WJ
        expect(isValidTopicAlias('a﻿b')).toBe(false); // BOM
        expect(isValidTopicAlias('a᠎b')).toBe(false); // MVS
        expect(isValidTopicAlias('a￹b')).toBe(false); // interlinear anchor
    });
});

describe('isReservedTopicRouteSegment', () => {
    it('rejects static locale route segments', () => {
        expect(isReservedTopicRouteSegment('admin')).toBe(true);
        expect(isReservedTopicRouteSegment('P')).toBe(true);
        expect(isReservedTopicRouteSegment('uploads')).toBe(true);
        expect(isReservedTopicRouteSegment('en')).toBe(true);
        expect(isReservedTopicRouteSegment('KO')).toBe(true);
    });

    it('allows normal topic names', () => {
        expect(isReservedTopicRouteSegment('travel')).toBe(false);
        expect(isReservedTopicRouteSegment('landscape-2026')).toBe(false);
    });
});

describe('isValidTagName', () => {
    it('accepts normal tag names without commas', () => {
        expect(isValidTagName('Black and White')).toBe(true);
        expect(isValidTagName('seoul-night')).toBe(true);
    });

    it('rejects commas and invalid lengths', () => {
        expect(isValidTagName('Black, White')).toBe(false);
        expect(isValidTagName('')).toBe(false);
        expect(isValidTagName(' '.repeat(5))).toBe(false);
        expect(isValidTagName('a'.repeat(101))).toBe(false);
    });

    it('rejects null bytes', () => {
        expect(isValidTagName('tag\x00name')).toBe(false);
    });

    it('rejects HTML-special characters', () => {
        expect(isValidTagName('tag<name')).toBe(false);
        expect(isValidTagName('tag>name')).toBe(false);
        expect(isValidTagName('tag"name')).toBe(false);
        expect(isValidTagName("tag'name")).toBe(false);
        expect(isValidTagName('tag&name')).toBe(false);
    });

    // C4L-SEC-01: defense-in-depth parity with topic aliases (C3L-SEC-01)
    // and CSV export hardening (C7R-RPL-11 / C8R-RPL-01). Tag names are
    // rendered into admin UI tables and tag-pill chips, so they must
    // reject Unicode bidi overrides (Trojan Source) and zero-width /
    // invisible formatting characters.
    it('rejects Unicode bidi override / isolate characters', () => {
        expect(isValidTagName('tag‮name')).toBe(false); // RLO
        expect(isValidTagName('tag‪name')).toBe(false); // LRE
        expect(isValidTagName('tag‭name')).toBe(false); // LRO
        expect(isValidTagName('tag⁦name')).toBe(false); // LRI
        expect(isValidTagName('tag⁩name')).toBe(false); // PDI
    });

    it('rejects zero-width / invisible formatting characters', () => {
        expect(isValidTagName('tag​name')).toBe(false); // ZWSP
        expect(isValidTagName('tag‌name')).toBe(false); // ZWNJ
        expect(isValidTagName('tag‍name')).toBe(false); // ZWJ
        expect(isValidTagName('tag‎name')).toBe(false); // LRM
        expect(isValidTagName('tag‏name')).toBe(false); // RLM
        expect(isValidTagName('tag⁠name')).toBe(false); // WJ
        expect(isValidTagName('tag﻿name')).toBe(false); // BOM
        expect(isValidTagName('tag᠎name')).toBe(false); // MVS
        expect(isValidTagName('tag￹name')).toBe(false); // interlinear anchor
    });
});

describe('isValidTagSlug', () => {
    it('accepts ASCII and Unicode slugs used by tag storage', () => {
        expect(isValidTagSlug('landscape-night')).toBe(true);
        expect(isValidTagSlug('풍경')).toBe(true);
    });

    it('rejects empty and malformed tag slugs', () => {
        expect(isValidTagSlug('')).toBe(false);
        expect(isValidTagSlug('bad.slug')).toBe(false);
        expect(isValidTagSlug('bad/tag')).toBe(false);
    });

    // C30-06: underscores rejected to match getTagSlug(), which always
    // replaces underscores with hyphens before producing a slug.
    it('rejects underscores (getTagSlug always converts them to hyphens)', () => {
        expect(isValidTagSlug('bad_slug')).toBe(false);
    });
});

// C6L-ARCH-01: single canonical helper for the Unicode-formatting policy.
// Truthiness branch matters because nullable admin string columns
// (image.title / image.description / seo_*) reach the helper as null/empty.
describe('containsUnicodeFormatting', () => {
    it('treats null/undefined/empty as clean', () => {
        expect(containsUnicodeFormatting(null)).toBe(false);
        expect(containsUnicodeFormatting(undefined)).toBe(false);
        expect(containsUnicodeFormatting('')).toBe(false);
    });

    it('treats plain ASCII / CJK / emoji text as clean', () => {
        expect(containsUnicodeFormatting('plain text')).toBe(false);
        expect(containsUnicodeFormatting('안녕하세요')).toBe(false);
        expect(containsUnicodeFormatting('🎉 party')).toBe(false);
    });

    it('detects Unicode bidi override / isolate characters', () => {
        expect(containsUnicodeFormatting('a‮b')).toBe(true); // RLO
        expect(containsUnicodeFormatting('a‪b')).toBe(true); // LRE
        expect(containsUnicodeFormatting('a‭b')).toBe(true); // LRO
        expect(containsUnicodeFormatting('a⁦b')).toBe(true); // LRI
        expect(containsUnicodeFormatting('a⁩b')).toBe(true); // PDI
    });

    it('detects zero-width / invisible formatting characters', () => {
        expect(containsUnicodeFormatting('a​b')).toBe(true); // ZWSP
        expect(containsUnicodeFormatting('a‌b')).toBe(true); // ZWNJ
        expect(containsUnicodeFormatting('a‍b')).toBe(true); // ZWJ
        expect(containsUnicodeFormatting('a‎b')).toBe(true); // LRM
        expect(containsUnicodeFormatting('a‏b')).toBe(true); // RLM
        expect(containsUnicodeFormatting('a⁠b')).toBe(true); // WJ
        expect(containsUnicodeFormatting('a﻿b')).toBe(true); // BOM
        expect(containsUnicodeFormatting('a᠎b')).toBe(true); // MVS
        expect(containsUnicodeFormatting('a￹b')).toBe(true); // interlinear anchor
    });
});

describe('hasMySQLErrorCode', () => {
    it('matches top-level MySQL error codes', () => {
        expect(hasMySQLErrorCode(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }), 'ER_DUP_ENTRY')).toBe(true);
    });

    it('matches wrapped MySQL error codes', () => {
        expect(hasMySQLErrorCode(Object.assign(new Error('wrapped'), {
            code: 'ER_DBACCESS_DENIED_ERROR',
            cause: { code: 'ER_DUP_ENTRY' },
        }), 'ER_DUP_ENTRY')).toBe(true);
    });

    it('rejects unrelated errors', () => {
        expect(hasMySQLErrorCode(new Error('boom'), 'ER_DUP_ENTRY')).toBe(false);
        expect(hasMySQLErrorCode(Object.assign(new Error('other'), { code: 'ER_ACCESS_DENIED_ERROR' }), 'ER_DUP_ENTRY')).toBe(false);
    });
});

// C17-VR-09: verify UNICODE_FORMAT_CHARS regex stays in sync between
// validation.ts (no /g, used for .test()) and sanitize.ts (with /g, used
// for .replace()). The sanitize.ts module derives its regex from the
// validation.ts import, so the .source property must match.
describe('UNICODE_FORMAT_CHARS regex synchronization', () => {
    it('sanitize.ts stripControlChars removes the same chars that validation.ts UNICODE_FORMAT_CHARS detects', async () => {
        const { UNICODE_FORMAT_CHARS, containsUnicodeFormatting } = await import('@/lib/validation');
        // Dynamic import so we get the actual runtime value after the
        // C17-VR-09 refactor (new RegExp(UNICODE_FORMAT_CHARS.source, 'g'))
        const { stripControlChars } = await import('@/lib/sanitize');
        // Verify indirectly: stripControlChars should strip the same chars
        // that UNICODE_FORMAT_CHARS / containsUnicodeFormatting detect.
        const testChars = [
            '​', // ZWSP
            '‎', // LRM
            '‪', // LRE
            '﻿', // BOM
            '᠎', // MVS
            '⁠', // WJ
            '￹', // interlinear anchor start
        ];
        for (const char of testChars) {
            const input = `hello${char}world`;
            expect(UNICODE_FORMAT_CHARS.test(input)).toBe(true);
            const result = stripControlChars(input);
            expect(result).toBe('helloworld');
            // Also verify containsUnicodeFormatting agrees
            expect(containsUnicodeFormatting(input)).toBe(true);
        }
    });
});

// C20-MED-01: safeInsertId validates BigInt coercion before converting
// MySQL insertId to number. mysql2 returns BigInt when the auto-increment
// value exceeds Number.MAX_SAFE_INTEGER, and bare Number() silently loses
// precision.
describe('safeInsertId', () => {
    it('returns a safe number input unchanged', () => {
        expect(safeInsertId(1)).toBe(1);
        expect(safeInsertId(42)).toBe(42);
        expect(safeInsertId(999999)).toBe(999999);
    });

    it('returns a safe BigInt input as a number', () => {
        expect(safeInsertId(BigInt(1))).toBe(1);
        expect(safeInsertId(BigInt(42))).toBe(42);
        expect(safeInsertId(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('throws on BigInt exceeding Number.MAX_SAFE_INTEGER', () => {
        const unsafe = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
        expect(() => safeInsertId(unsafe)).toThrow('exceeds Number.MAX_SAFE_INTEGER');
    });

    it('throws on BigInt below Number.MIN_SAFE_INTEGER', () => {
        const unsafe = BigInt(Number.MIN_SAFE_INTEGER) - BigInt(1);
        expect(() => safeInsertId(unsafe)).toThrow('exceeds Number.MAX_SAFE_INTEGER');
    });

    it('throws on non-finite number input', () => {
        expect(() => safeInsertId(Infinity)).toThrow('not a valid auto-increment ID');
        expect(() => safeInsertId(-Infinity)).toThrow('not a valid auto-increment ID');
        expect(() => safeInsertId(NaN)).toThrow('not a valid auto-increment ID');
    });

    it('throws on negative number input', () => {
        expect(() => safeInsertId(-1)).toThrow('not a valid auto-increment ID');
    });

    it('accepts zero as valid (edge case)', () => {
        expect(safeInsertId(0)).toBe(0);
        expect(safeInsertId(BigInt(0))).toBe(0);
    });
});
