import { describe, it, expect } from 'vitest';
import { isValidSlug, isValidFilename, isValidTopicAlias, isReservedTopicRouteSegment, isValidTagName } from '@/lib/validation';

describe('isValidSlug', () => {
    it('accepts lowercase alphanumeric with hyphens and underscores', () => {
        expect(isValidSlug('my-topic')).toBe(true);
        expect(isValidSlug('my_topic')).toBe(true);
        expect(isValidSlug('topic123')).toBe(true);
    });

    it('accepts uppercase letters', () => {
        expect(isValidSlug('MyTopic')).toBe(true);
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

    it('rejects whitespace', () => {
        expect(isValidTopicAlias('a b')).toBe(false);
    });

    it('rejects query and fragment markers', () => {
        expect(isValidTopicAlias('a?b')).toBe(false);
        expect(isValidTopicAlias('a#b')).toBe(false);
    });
});

describe('isReservedTopicRouteSegment', () => {
    it('rejects static locale route segments', () => {
        expect(isReservedTopicRouteSegment('admin')).toBe(true);
        expect(isReservedTopicRouteSegment('P')).toBe(true);
        expect(isReservedTopicRouteSegment('uploads')).toBe(true);
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
});
