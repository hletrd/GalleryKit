import { NextRequest, NextResponse } from 'next/server';
import { getFeedUpdatedAt, getImagesForFeed, getSeoSettings } from '@/lib/data';
import { composeAtomFeed } from '@/lib/atom-feed';
import { absoluteImageUrl, sizedImageFilename } from '@/lib/image-url';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { DEFAULT_LOCALE } from '@/lib/constants';
import { localizePath } from '@/lib/locale-path';
import { isFeedNotModified } from '@/lib/feed-conditional';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
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

export async function GET(request: NextRequest) {
    const ifModifiedSince = request.headers.get('if-modified-since');
    const feedFreshness = await getFeedUpdatedAt();
    const feedFreshnessUpdated = feedFreshness
        ? toIso(feedFreshness.updated_at) ?? toIso(feedFreshness.created_at)
        : null;
    if (feedFreshnessUpdated && isFeedNotModified(ifModifiedSince, feedFreshnessUpdated)) {
        return new NextResponse(null, {
            status: 304,
            headers: {
                'Cache-Control': CACHE_CONTROL,
                'Vary': 'Accept-Language',
                'Last-Modified': new Date(feedFreshnessUpdated).toUTCString(),
            },
        });
    }

    const [seo, config] = await Promise.all([
        getSeoSettings(),
        getGalleryConfig(),
    ]);
    const baseUrl = seo.url;

    // R17-M3: source rows from a feed-specific helper that orders by
    // updated_at DESC (publication-time convention). The masonry/gallery
    // listing still uses capture_date ordering — that's a storytelling
    // surface, not a syndication channel.
    const rows = await getImagesForFeed(FEED_LIMIT);

    const feedSelfUrl = `${baseUrl}/feed.xml`;
    const feedAlternateUrl = `${baseUrl}${localizePath(DEFAULT_LOCALE, '/')}`;

    // R25-M1: resolve the feed media-content size against the LIVE admin
    // `image_sizes` config — not against the hard-coded `DEFAULT_IMAGE_SIZES`
    // that `sizedImageFilename`'s two-arg overload silently falls back to.
    // Before this fix, dropping `1536` from `image_sizes` left every
    // <media:content> URL pointing at a `_1536.jpg` that does not exist
    // on disk (RSS-reader previews 404 silently for every entry, every
    // reader). Lineage: R21-M1 / R22-M1 / R23-M1 / R24-M1 closed the
    // equivalent failure mode on the public `<img>` and per-photo OG
    // routes; R25-M1 closes the syndication-feed side of the same class.
    //
    // We pick `findNearestImageSize(config.imageSizes, 1536)` (RSS readers
    // want a ~1.5K-ish preview), and `findNearestImageSize` already falls
    // back to the largest available size if nothing close exists.
    const feedJpegSize = findNearestImageSize(config.imageSizes, 1536);

    const entries = rows.map((img) => {
        const photoPath = localizePath(DEFAULT_LOCALE, `/p/${img.id}`);
        const photoUrl = `${baseUrl}${photoPath}`;
        const title = getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`);

        const jpegSized = sizedImageFilename(img.filename_jpeg, feedJpegSize, config.imageSizes);
        const mediaUrl = absoluteImageUrl(`/uploads/jpeg/${jpegSized}`, baseUrl);

        // R17-M2: prefer updated_at over created_at so admin edits to
        // title/description (handled by MySQL's onUpdateNow on
        // images.updated_at) advance the entry's <updated> instant and
        // re-trigger RSS reader re-renders.
        const updatedAt = toIso(img.updated_at)
            ?? toIso(img.created_at)
            ?? new Date().toISOString();

        // Privacy invariant: the public feed helper returns author_name NULL
        // so entries fall back to the feed-level author until a safe public
        // display-name field exists. Do not expose admin usernames here.
        const entryAuthorName = typeof img.author_name === 'string' ? img.author_name.trim() : '';
        const feedAuthorName = seo.author.trim() || seo.title.trim() || siteConfig.title || 'GalleryKit';
        const perEntryAuthor = entryAuthorName && entryAuthorName !== feedAuthorName
            ? { name: entryAuthorName }
            : undefined;

        return {
            id: photoUrl,
            title,
            updated: updatedAt,
            summary: img.description ?? img.capture_date ?? '',
            link: photoUrl,
            mediaContentUrl: mediaUrl,
            author: perEntryAuthor,
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
    const feedAuthorName = seo.author.trim() || seo.title.trim() || siteConfig.title || 'GalleryKit';
    const feedRights = siteCopyright || `© ${new Date().getFullYear()} ${feedAuthorName}`;

    const xml = composeAtomFeed({
        feedId: feedSelfUrl,
        feedTitle: seo.title,
        feedSelfUrl,
        feedAlternateUrl,
        feedUpdated,
        // R17-M1: feed-level <author>, satisfies RFC 4287 §4.1.1.
        feedAuthor: {
            name: feedAuthorName,
            uri: baseUrl || undefined,
        },
        feedRights,
        entries,
    });

    // R18-L3: emit Last-Modified so RSS readers honor conditional requests
    // (If-Modified-Since) and avoid full-body refetch on every poll. The
    // value derives from the max entry updated timestamp computed above;
    // bad ISO strings degrade to the current date rather than throwing.
    let lastModifiedHeader: string;
    try {
        lastModifiedHeader = new Date(feedUpdated).toUTCString();
    } catch {
        lastModifiedHeader = new Date().toUTCString();
    }

    // R19-M1: close the R18-L3 plan note's open item. RSS readers
    // (NetNewsWire, Inoreader, Feedly, Miniflux, FreshRSS, TT-RSS) all
    // issue If-Modified-Since on subsequent polls; without a 304 response
    // they re-download the full feed body even when nothing changed.
    // RFC 7232 §3.3: compare at second precision (HTTP-date is
    // second-precision; the ISO ms must be floored to match).
    if (isFeedNotModified(ifModifiedSince, feedUpdated)) {
        return new NextResponse(null, {
            status: 304,
            headers: {
                'Cache-Control': CACHE_CONTROL,
                'Vary': 'Accept-Language',
                'Last-Modified': lastModifiedHeader,
            },
        });
    }

    return new NextResponse(xml, {
        status: 200,
        headers: {
            'Content-Type': 'application/atom+xml; charset=utf-8',
            'Cache-Control': CACHE_CONTROL,
            // R17-L3: pre-emptive Vary so a future locale-aware feed
            // does not poison CDN caches with the wrong locale's titles.
            'Vary': 'Accept-Language',
            // R18-L3: Last-Modified for client-side conditional GETs.
            'Last-Modified': lastModifiedHeader,
        },
    });
}
