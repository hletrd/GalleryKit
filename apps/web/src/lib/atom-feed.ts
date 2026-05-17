/**
 * Pure Atom 1.0 XML composer.
 * No I/O — all inputs are plain values. Fully testable in isolation.
 *
 * Spec: https://www.ietf.org/rfc/rfc4287.txt
 * Media RSS: http://www.rssboard.org/media-rss
 */

/**
 * Escape characters that are unsafe in XML text content and attributes.
 *
 * R17-L1: Also strips C0 control characters that XML 1.0 forbids in
 * document content (everything in 0x00-0x1F except \t \n \r). A single
 * stray control byte in an admin-edited title or description would
 * otherwise ill-form the entire feed, which strict RSS readers (Feedly,
 * NetNewsWire) reject wholesale rather than degrading per-entry. The
 * admin-string sanitizer in `lib/validation.ts` already strips bidi /
 * invisible chars but does NOT strip C0 controls — this is the defense
 * in depth for any upstream sanitizer regression.
 */
export function escapeXml(value: string): string {
    return value
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export interface AtomAuthor {
    /** Author display name. */
    name: string;
    /** Optional author URI (typically the site / portfolio URL). */
    uri?: string;
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
    /**
     * Optional per-entry author. When present, emitted as a nested
     * <author> block on the entry. Forward-looking — current callers
     * rely on the feed-level <author> alone (R17-L2 deferred).
     */
    author?: AtomAuthor;
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
    /**
     * Feed-level author. RFC 4287 §4.1.1 requires either a feed-level
     * <author> or per-entry <author> on every entry; we always emit the
     * feed-level form. R17-M1.
     */
    feedAuthor: AtomAuthor;
    /**
     * Optional copyright / rights statement (RFC 4287 §4.2.10). Rendered
     * as <rights>…</rights>. R17-M4.
     */
    feedRights?: string;
    entries: AtomEntry[];
}

/**
 * Compose a complete Atom 1.0 document as a string.
 *
 * All user-controlled string inputs are XML-escaped before insertion.
 * The media:content element uses the Yahoo Media RSS namespace.
 */
function renderAuthorBlock(indent: string, author: AtomAuthor): string {
    // R18-L2: explicit type="text" on <name> per RFC 4287 §3.1.1. Default
    // is "text" so semantics unchanged; explicit attribute silences W3C
    // feed validator advisories.
    const lines = [`${indent}<author>`, `${indent}  <name type="text">${escapeXml(author.name)}</name>`];
    if (author.uri) {
        lines.push(`${indent}  <uri>${escapeXml(author.uri)}</uri>`);
    }
    lines.push(`${indent}</author>`);
    return lines.join('\n');
}

export function composeAtomFeed(input: AtomFeedInput): string {
    const {
        feedId,
        feedTitle,
        feedSelfUrl,
        feedAlternateUrl,
        feedUpdated,
        feedAuthor,
        feedRights,
        entries,
    } = input;

    const entriesXml = entries.map((entry) => {
        const mediaType = entry.mediaContentType ?? 'image/jpeg';
        // R18-L2: explicit type="text" on <title> and <summary> (RFC 4287
        // §3.1.1 default; explicit silences validator advisories).
        // R18-L1: emit <link rel="enclosure"> alongside <media:content> so
        // RSS readers that prefetch enclosures (NetNewsWire "download
        // enclosures", Inoreader "include media") cache photos for offline
        // viewing. Media RSS coverage is wider but enclosure is the Atom-
        // native path; emit both.
        const parts = [
            '  <entry>',
            `    <id>${escapeXml(entry.id)}</id>`,
            `    <title type="text">${escapeXml(entry.title)}</title>`,
            `    <updated>${escapeXml(entry.updated)}</updated>`,
            `    <summary type="text">${escapeXml(entry.summary)}</summary>`,
            `    <link rel="alternate" type="text/html" href="${escapeXml(entry.link)}"/>`,
            `    <link rel="enclosure" type="${escapeXml(mediaType)}" href="${escapeXml(entry.mediaContentUrl)}"/>`,
            `    <media:content url="${escapeXml(entry.mediaContentUrl)}" medium="image" type="${escapeXml(mediaType)}"/>`,
        ];
        if (entry.author) {
            parts.push(renderAuthorBlock('    ', entry.author));
        }
        parts.push('  </entry>');
        return parts.join('\n');
    }).join('\n');

    // R17-M1: emit feed-level <author> per RFC 4287 §4.1.1.
    // R17-M4: emit optional <rights> per RFC 4287 §4.2.10.
    // R18-L2: explicit type="text" on <title> per RFC 4287 §3.1.1.
    const headLines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
        `  <id>${escapeXml(feedId)}</id>`,
        `  <title type="text">${escapeXml(feedTitle)}</title>`,
        renderAuthorBlock('  ', feedAuthor),
    ];
    if (feedRights) {
        headLines.push(`  <rights type="text">${escapeXml(feedRights)}</rights>`);
    }
    headLines.push(
        `  <updated>${escapeXml(feedUpdated)}</updated>`,
        `  <link rel="self" type="application/atom+xml" href="${escapeXml(feedSelfUrl)}"/>`,
        `  <link rel="alternate" type="text/html" href="${escapeXml(feedAlternateUrl)}"/>`,
    );

    return [...headLines, entriesXml, '</feed>'].join('\n');
}
