import { NextResponse } from 'next/server';
import { getImagesForFeed, getSeoSettings } from '@/lib/data';
import { composeAtomFeed } from '@/lib/atom-feed';
import { absoluteImageUrl, sizedImageFilename } from '@/lib/image-url';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { DEFAULT_LOCALE } from '@/lib/constants';
import { localizePath } from '@/lib/locale-path';
import siteConfig from '@/site-config.json';

export const runtime = 'nodejs';

const FEED_LIMIT = 50;
const CACHE_CONTROL = 'public, max-age=600, s-maxage=1800';

function toIso(value: unknown): string | null {
    if (!value) return null;
    try {
        return value instanceof Date
            ? value.toISOString()
            : new Date(value as string | number).toISOString();
    } catch {
        return null;
    }
}

export async function GET() {
    const seo = await getSeoSettings();
    const baseUrl = seo.url;

    // R17-M3: source rows from a feed-specific helper that orders by
    // updated_at DESC (publication-time convention). The masonry/gallery
    // listing still uses capture_date ordering — that's a storytelling
    // surface, not a syndication channel.
    const rows = await getImagesForFeed(FEED_LIMIT);

    const feedSelfUrl = `${baseUrl}/feed.xml`;
    const feedAlternateUrl = `${baseUrl}${localizePath(DEFAULT_LOCALE, '/')}`;

    const entries = rows.map((img) => {
        const photoPath = localizePath(DEFAULT_LOCALE, `/p/${img.id}`);
        const photoUrl = `${baseUrl}${photoPath}`;
        const title = getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`);

        const jpegSized = sizedImageFilename(img.filename_jpeg, 1536);
        const mediaUrl = absoluteImageUrl(`/uploads/jpeg/${jpegSized}`, baseUrl);

        // R17-M2: prefer updated_at over created_at so admin edits to
        // title/description (handled by MySQL's onUpdateNow on
        // images.updated_at) advance the entry's <updated> instant and
        // re-trigger RSS reader re-renders.
        const updatedAt = toIso(img.updated_at)
            ?? toIso(img.created_at)
            ?? new Date().toISOString();

        return {
            id: photoUrl,
            title,
            updated: updatedAt,
            summary: img.description ?? img.capture_date ?? '',
            link: photoUrl,
            mediaContentUrl: mediaUrl,
        };
    });

    // R17-M2: derive feed-level <updated> from the max entry updated
    // timestamp rather than rows[0].created_at. With R17-M3's ordering
    // these are equivalent, but the explicit reduce documents intent and
    // tolerates ordering changes.
    const feedUpdated = entries.length > 0
        ? entries.reduce((acc, e) => (e.updated > acc ? e.updated : acc), entries[0].updated)
        : new Date().toISOString();

    // R17-M4: emit <rights>. Prefer admin-configured copyright in
    // site-config.json; fall back to a sensible "© {year} {author}".
    const siteCopyright = typeof (siteConfig as unknown as { copyright?: unknown }).copyright === 'string'
        ? ((siteConfig as unknown as { copyright: string }).copyright).trim()
        : '';
    const feedRights = siteCopyright || `© ${new Date().getFullYear()} ${seo.author}`;

    const xml = composeAtomFeed({
        feedId: feedSelfUrl,
        feedTitle: seo.title,
        feedSelfUrl,
        feedAlternateUrl,
        feedUpdated,
        // R17-M1: feed-level <author>, satisfies RFC 4287 §4.1.1.
        feedAuthor: {
            name: seo.author,
            uri: baseUrl || undefined,
        },
        feedRights,
        entries,
    });

    return new NextResponse(xml, {
        status: 200,
        headers: {
            'Content-Type': 'application/atom+xml; charset=utf-8',
            'Cache-Control': CACHE_CONTROL,
            // R17-L3: pre-emptive Vary so a future locale-aware feed
            // does not poison CDN caches with the wrong locale's titles.
            'Vary': 'Accept-Language',
        },
    });
}
