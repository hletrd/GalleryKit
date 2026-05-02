/**
 * Pure Atom 1.0 XML composer.
 * No I/O — all inputs are plain values. Fully testable in isolation.
 *
 * Spec: https://www.ietf.org/rfc/rfc4287.txt
 * Media RSS: http://www.rssboard.org/media-rss
 */

/** Escape characters that are unsafe in XML text content and attributes. */
export function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export interface AtomEntry {
    /** Globally unique IRI for this entry — typically the photo page URL. */
    id: string;
    /** Human-readable title. */
    title: string;
    /** ISO-8601 date string for the last-modified time. */
    updated: string;
    /** Short text summary / description. */
    summary: string;
    /** Canonical link to the photo page. */
    link: string;
    /** Absolute URL to the medium-sized JPEG derivative. */
    mediaContentUrl: string;
    /** Optional MIME type for media:content (default: image/jpeg). */
    mediaContentType?: string;
}

export interface AtomFeedInput {
    /** The feed's own IRI (e.g. https://example.com/feed.xml). */
    feedId: string;
    /** Human-readable feed title. */
    feedTitle: string;
    /** Absolute URL of the feed itself — emitted as <link rel="self">. */
    feedSelfUrl: string;
    /** Absolute URL of the HTML page this feed represents — emitted as <link rel="alternate">. */
    feedAlternateUrl: string;
    /** ISO-8601 date string for the most recent update across all entries. */
    feedUpdated: string;
    entries: AtomEntry[];
}

/**
 * Compose a complete Atom 1.0 document as a string.
 *
 * All user-controlled string inputs are XML-escaped before insertion.
 * The media:content element uses the Yahoo Media RSS namespace.
 */
export function composeAtomFeed(input: AtomFeedInput): string {
    const { feedId, feedTitle, feedSelfUrl, feedAlternateUrl, feedUpdated, entries } = input;

    const entriesXml = entries.map((entry) => {
        const mediaType = entry.mediaContentType ?? 'image/jpeg';
        return [
            '  <entry>',
            `    <id>${escapeXml(entry.id)}</id>`,
            `    <title>${escapeXml(entry.title)}</title>`,
            `    <updated>${escapeXml(entry.updated)}</updated>`,
            `    <summary>${escapeXml(entry.summary)}</summary>`,
            `    <link rel="alternate" type="text/html" href="${escapeXml(entry.link)}"/>`,
            `    <media:content url="${escapeXml(entry.mediaContentUrl)}" medium="image" type="${escapeXml(mediaType)}"/>`,
            '  </entry>',
        ].join('\n');
    }).join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
        `  <id>${escapeXml(feedId)}</id>`,
        `  <title>${escapeXml(feedTitle)}</title>`,
        `  <updated>${escapeXml(feedUpdated)}</updated>`,
        `  <link rel="self" type="application/atom+xml" href="${escapeXml(feedSelfUrl)}"/>`,
        `  <link rel="alternate" type="text/html" href="${escapeXml(feedAlternateUrl)}"/>`,
        entriesXml,
        '</feed>',
    ].join('\n');
}
