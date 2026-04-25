import { describe, it, expect } from 'vitest';
import { hasMySQLErrorCode, isValidSlug, isValidFilename, isValidTopicAlias, isReservedTopicRouteSegment, isValidTagName, isValidTagSlug } from '@/lib/validation';

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
