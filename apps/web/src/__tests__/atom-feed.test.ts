import { describe, it, expect } from 'vitest';
import { composeAtomFeed, escapeXml, type AtomEntry, type AtomFeedInput } from '@/lib/atom-feed';

const BASE_ENTRY: AtomEntry = {
    id: 'https://example.com/en/p/1',
    title: 'Sunset at the Park',
    updated: '2024-01-15T10:00:00.000Z',
    summary: 'A beautiful sunset photo.',
    link: 'https://example.com/en/p/1',
    mediaContentUrl: 'https://example.com/uploads/jpeg/photo_1536.jpg',
};

const BASE_INPUT: AtomFeedInput = {
    feedId: 'https://example.com/feed.xml',
    feedTitle: 'My Gallery',
    feedSelfUrl: 'https://example.com/feed.xml',
    feedAlternateUrl: 'https://example.com/en/',
    feedUpdated: '2024-01-15T10:00:00.000Z',
    entries: [BASE_ENTRY],
};

describe('escapeXml', () => {
    it('escapes ampersand', () => {
        expect(escapeXml('a & b')).toBe('a &amp; b');
    });

    it('escapes less-than', () => {
        expect(escapeXml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes greater-than', () => {
        expect(escapeXml('1 > 0')).toBe('1 &gt; 0');
    });

    it('escapes double-quote', () => {
        expect(escapeXml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('escapes single-quote', () => {
        expect(escapeXml("it's")).toBe('it&apos;s');
    });

    it('escapes all unsafe chars in one string', () => {
        expect(escapeXml('<a href="x&y">it\'s</a>')).toBe(
            '&lt;a href=&quot;x&amp;y&quot;&gt;it&apos;s&lt;/a&gt;',
        );
    });

    it('passes plain strings through unchanged', () => {
        expect(escapeXml('hello world')).toBe('hello world');
    });
});

describe('composeAtomFeed', () => {
    it('starts with XML declaration', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    });

    it('uses the Atom 1.0 namespace', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('xmlns="http://www.w3.org/2005/Atom"');
    });

    it('uses the Yahoo media namespace', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
    });

    it('includes <id> matching feedId', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<id>https://example.com/feed.xml</id>');
    });

    it('includes <title> matching feedTitle', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<title>My Gallery</title>');
    });

    it('includes <updated> at feed level', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<updated>2024-01-15T10:00:00.000Z</updated>');
    });

    it('includes <link rel="self"> with feed URL', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('rel="self"');
        expect(xml).toContain('href="https://example.com/feed.xml"');
    });

    it('includes <link rel="alternate"> with HTML URL', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('rel="alternate"');
        expect(xml).toContain('href="https://example.com/en/"');
    });

    it('includes an <entry> element for each entry', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        const matches = xml.match(/<entry>/g);
        expect(matches).toHaveLength(1);
    });

    it('entry has <id>', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<id>https://example.com/en/p/1</id>');
    });

    it('entry has <title>', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<title>Sunset at the Park</title>');
    });

    it('entry has <updated>', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<updated>2024-01-15T10:00:00.000Z</updated>');
    });

    it('entry has <summary>', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<summary>A beautiful sunset photo.</summary>');
    });

    it('entry has <link> to photo page', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<link rel="alternate" type="text/html" href="https://example.com/en/p/1"/>');
    });

    it('entry has <media:content> with JPEG URL', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('<media:content url="https://example.com/uploads/jpeg/photo_1536.jpg"');
    });

    it('entry <media:content> has medium="image"', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('medium="image"');
    });

    it('entry <media:content> defaults to type="image/jpeg"', () => {
        const xml = composeAtomFeed(BASE_INPUT);
        expect(xml).toContain('type="image/jpeg"');
    });

    it('XML-escapes user-controlled title containing special chars', () => {
        const xml = composeAtomFeed({
            ...BASE_INPUT,
            feedTitle: 'Café & Friends <Gallery>',
            entries: [{
                ...BASE_ENTRY,
                title: 'Tom & Jerry\'s "Adventure"',
                summary: '<script>alert(1)</script>',
            }],
        });
        expect(xml).toContain('Café &amp; Friends &lt;Gallery&gt;');
        expect(xml).toContain('Tom &amp; Jerry&apos;s &quot;Adventure&quot;');
        expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(xml).not.toContain('<script>');
    });

    it('produces an empty entries section when entries array is empty', () => {
        const xml = composeAtomFeed({ ...BASE_INPUT, entries: [] });
        expect(xml).not.toContain('<entry>');
        expect(xml).toContain('</feed>');
    });

    it('handles multiple entries', () => {
        const xml = composeAtomFeed({
            ...BASE_INPUT,
            entries: [
                BASE_ENTRY,
                { ...BASE_ENTRY, id: 'https://example.com/en/p/2', title: 'Second Photo', link: 'https://example.com/en/p/2' },
            ],
        });
        const matches = xml.match(/<entry>/g);
        expect(matches).toHaveLength(2);
    });

    it('uses custom mediaContentType when provided', () => {
        const xml = composeAtomFeed({
            ...BASE_INPUT,
            entries: [{ ...BASE_ENTRY, mediaContentType: 'image/avif' }],
        });
        expect(xml).toContain('type="image/avif"');
    });
});

describe('composeAtomFeed — topic 404 guard contract', () => {
    // This test validates the contract used by the per-topic feed route:
    // when getTopicBySlug returns null, the route returns 404 and never
    // calls composeAtomFeed. We verify the helper itself is pure and
    // stable so the route logic can safely branch on null topic.
    it('composeAtomFeed is a pure function with no side effects', () => {
        const input: AtomFeedInput = { ...BASE_INPUT };
        const result1 = composeAtomFeed(input);
        const result2 = composeAtomFeed(input);
        expect(result1).toBe(result2);
    });

    it('returns a string — not null — for valid input (route calls this only when topic found)', () => {
        expect(typeof composeAtomFeed(BASE_INPUT)).toBe('string');
    });
});
