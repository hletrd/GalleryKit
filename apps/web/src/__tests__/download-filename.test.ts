import { describe, expect, it } from 'vitest';
import { buildDownloadFilename, _internal } from '@/lib/download-filename';

const { slugifyTitle, MAX_SLUG_LENGTH } = _internal;

describe('buildDownloadFilename', () => {
    it('falls back to photo-{id}.{ext} when title is null', () => {
        expect(buildDownloadFilename(null, 12345, 'jpg')).toBe('photo-12345.jpg');
    });

    it('falls back to photo-{id}.{ext} when title is empty string', () => {
        expect(buildDownloadFilename('', 99, 'avif')).toBe('photo-99.avif');
    });

    it('falls back to photo-{id}.{ext} when title is whitespace-only', () => {
        expect(buildDownloadFilename('   \t  ', 42, 'jpg')).toBe('photo-42.jpg');
    });

    it('uses slugified title for ASCII text', () => {
        expect(buildDownloadFilename('Bride and Groom', 9111, 'jpg')).toBe('bride-and-groom-9111.jpg');
    });

    it('strips diacritics for accented Latin', () => {
        expect(buildDownloadFilename('Café Bordée', 7, 'jpg')).toBe('cafe-bordee-7.jpg');
    });

    it('strips path separators and shell metacharacters', () => {
        // These are not allowed in filenames on Windows; they must not
        // leak. Non-alphanumeric runs collapse into a single `-` so the
        // shape is "boundaries-become-dashes" rather than "elided."
        expect(buildDownloadFilename('Beach <2024>/Trip:1', 100, 'jpg'))
            .toBe('beach-2024-trip-1-100.jpg');
    });

    it('caps length at 60 chars for the title portion', () => {
        const long = 'a-very-long-title-that-definitely-exceeds-the-sixty-character-cap-limit-here';
        const out = buildDownloadFilename(long, 1, 'jpg');
        // Title portion <= 60 chars; total = title + '-' + id + '.' + ext.
        const titlePart = out.replace(/-1\.jpg$/, '');
        expect(titlePart.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
        expect(out.endsWith('-1.jpg')).toBe(true);
    });

    it('falls back to photo-{id} when title is non-Latin (CJK)', () => {
        // Korean / CJK characters slugify to empty; better the legacy
        // fallback than partial romanization.
        expect(buildDownloadFilename('한국어 제목', 200, 'jpg')).toBe('photo-200.jpg');
    });

    it('strips Unicode bidi / zero-width chars before slugifying', () => {
        // RLO (U+202E) + zero-width-space (U+200B) injected into a title
        // must not affect the output beyond being silently removed.
        const malicious = 'foo‮bar​baz';
        const out = buildDownloadFilename(malicious, 5, 'jpg');
        expect(out).toBe('foobarbaz-5.jpg');
    });

    it('strips C0/C1 control chars', () => {
        expect(buildDownloadFilename('hello\x00\x07world', 9, 'jpg')).toBe('helloworld-9.jpg');
    });

    it('collapses runs of separators', () => {
        expect(buildDownloadFilename('foo----bar    baz', 1, 'jpg')).toBe('foo-bar-baz-1.jpg');
    });

    it('rejects extension with non-alphanumeric chars', () => {
        // Defensive: even if the caller passes a weird ext, we sanitize.
        expect(buildDownloadFilename('hi', 1, '../jpg')).toBe('hi-1.jpg');
        expect(buildDownloadFilename('hi', 1, '.JPG')).toBe('hi-1.jpg');
    });

    it('falls back to jpg ext when ext sanitizes to empty', () => {
        expect(buildDownloadFilename('hi', 1, '....')).toBe('hi-1.jpg');
    });

    it('sanitizes id to digits only', () => {
        // Defensive: id should always be numeric in production but guard
        // against accidental string-typed callers.
        expect(buildDownloadFilename('hi', '123abc', 'jpg')).toBe('hi-123.jpg');
    });
});

describe('slugifyTitle', () => {
    it('returns empty string for null/undefined/empty', () => {
        expect(slugifyTitle(null)).toBe('');
        expect(slugifyTitle(undefined)).toBe('');
        expect(slugifyTitle('')).toBe('');
    });

    it('trims leading and trailing separators', () => {
        expect(slugifyTitle('   -hello-   ')).toBe('hello');
    });
});
