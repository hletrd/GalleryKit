import { NextRequest, NextResponse } from 'next/server';
import { getImagesForFeed, getSeoSettings, getTopicBySlug } from '@/lib/data';
import { composeAtomFeed } from '@/lib/atom-feed';
import { absoluteImageUrl, sizedImageFilename } from '@/lib/image-url';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
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

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ locale: string; topic: string }> },
) {
    const { locale, topic: topicSlug } = await params;

    const [seo, topicData, config] = await Promise.all([
        getSeoSettings(),
        getTopicBySlug(topicSlug),
        getGalleryConfig(),
    ]);

    if (!topicData) {
        return new NextResponse(null, { status: 404 });
    }

    const baseUrl = seo.url;
    // R17-M3: publication-time ordering for the topic feed (same
    // rationale as the root feed).
    const rows = await getImagesForFeed(FEED_LIMIT, topicData.slug);

    const topicPath = localizePath(locale, `/${topicData.slug}`);
    const feedSelfUrl = `${baseUrl}${topicPath}/feed.xml`;
    const feedAlternateUrl = `${baseUrl}${topicPath}`;

    // R25-M1: resolve the feed media-content size against the LIVE admin
    // `image_sizes` config (see root /feed.xml/route.ts for full lineage).
    // Without this, dropping `1536` from `image_sizes` silently 404s every
    // per-topic feed entry's <media:content> preview.
    const feedJpegSize = findNearestImageSize(config.imageSizes, 1536);

    const entries = rows.map((img) => {
        const photoPath = localizePath(locale, `/p/${img.id}`);
        const photoUrl = `${baseUrl}${photoPath}`;
        const title = getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`);

        const jpegSized = sizedImageFilename(img.filename_jpeg, feedJpegSize, config.imageSizes);
        const mediaUrl = absoluteImageUrl(`/uploads/jpeg/${jpegSized}`, baseUrl);

        // R17-M2: prefer updated_at so admin edits propagate to RSS.
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

    // R17-M2: derive feed-level <updated> from max entry timestamp.
    const feedUpdated = entries.length > 0
        ? entries.reduce((acc, e) => (e.updated > acc ? e.updated : acc), entries[0].updated)
        : new Date().toISOString();

    // R17-M4: feed-level <rights>.
    const siteCopyright = typeof (siteConfig as unknown as { copyright?: unknown }).copyright === 'string'
        ? ((siteConfig as unknown as { copyright: string }).copyright).trim()
        : '';
    const feedRights = siteCopyright || `© ${new Date().getFullYear()} ${seo.author}`;

    const xml = composeAtomFeed({
        feedId: feedSelfUrl,
        feedTitle: `${topicData.label} | ${seo.title}`,
        feedSelfUrl,
        feedAlternateUrl,
        feedUpdated,
        // R17-M1: feed-level <author> required by RFC 4287 §4.1.1.
        feedAuthor: {
            name: seo.author,
            uri: baseUrl || undefined,
        },
        feedRights,
        entries,
    });

    // R18-L3: emit Last-Modified for RSS-reader conditional GETs.
    let lastModifiedHeader: string;
    try {
        lastModifiedHeader = new Date(feedUpdated).toUTCString();
    } catch {
        lastModifiedHeader = new Date().toUTCString();
    }

    // R19-M1: 304 Not Modified when If-Modified-Since covers feedUpdated
    // (second precision per RFC 7232 §3.3). Mirrors the root /feed.xml.
    const ifModifiedSince = request.headers.get('if-modified-since');
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
            // R17-L3: pre-emptive Vary for future locale-aware feeds.
            'Vary': 'Accept-Language',
            // R18-L3: Last-Modified for client-side conditional GETs.
            'Last-Modified': lastModifiedHeader,
        },
    });
}
