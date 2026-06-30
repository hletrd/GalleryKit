import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getImagesForFeed, getSeoSettings, getTopicBySlug } from '@/lib/data';
import { composeAtomFeed } from '@/lib/atom-feed';
import { absoluteImageUrl, sizedImageFilename } from '@/lib/image-url';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { isSupportedLocale, localizePath } from '@/lib/locale-path';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { getTranslations } from 'next-intl/server';
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

function createAtomFeedEtag(xml: string): string {
    return `W/"atom-${createHash('sha256').update(xml).digest('base64url').slice(0, 22)}"`;
}

function isEtagMatch(ifNoneMatch: string | null, etag: string): boolean {
    if (!ifNoneMatch) return false;
    return ifNoneMatch.split(',').some((candidate) => {
        const value = candidate.trim();
        return value === '*' || value === etag;
    });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ locale: string; topic: string }> },
) {
    const { locale, topic: topicSlug } = await params;

    // COR-R4C18-01: route handlers bypass BOTH locale guards the rest of
    // the app relies on — the next-intl middleware never runs here
    // (proxy.ts's matcher excludes every dotted path, and this path ends
    // in `.xml`) and the `[locale]/layout.tsx` notFound() gate wraps
    // pages, not route handlers. Without this check, ANY locale segment
    // (`/kr/<topic>/feed.xml`, typo'd or crafted) returned a 200 feed
    // whose alternate link and every entry link carried the bogus prefix
    // and 404'd for all subscribers — CDN-cached per arbitrary locale
    // string. Any new dotted route under `[locale]` must self-validate
    // its locale param the same way. Source-locked by
    // feed-sized-derivative.test.ts.
    if (!isSupportedLocale(locale)) {
        return new NextResponse(null, { status: 404 });
    }

    const ifNoneMatch = request.headers.get('if-none-match');
    const topicData = await getTopicBySlug(topicSlug);

    if (!topicData) {
        return new NextResponse(null, { status: 404 });
    }

    const [seo, config, tCommon] = await Promise.all([
        getSeoSettings(),
        getGalleryConfig(),
        getTranslations({ locale, namespace: 'common' }),
    ]);

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
        const title = getPhotoDisplayTitleFromTagNames(img, `${tCommon('photo')} ${img.id}`);

        const jpegSized = sizedImageFilename(img.filename_jpeg, feedJpegSize, config.imageSizes);
        const mediaUrl = absoluteImageUrl(`/uploads/jpeg/${jpegSized}`, baseUrl);

        // R17-M2: prefer updated_at so admin edits propagate to RSS.
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

    // R17-M2: derive feed-level <updated> from max entry timestamp.
    const feedUpdated = entries.length > 0
        ? entries.reduce((acc, e) => (e.updated > acc ? e.updated : acc), entries[0].updated)
        : new Date().toISOString();

    // R17-M4: feed-level <rights>.
    const siteCopyright = typeof (siteConfig as unknown as { copyright?: unknown }).copyright === 'string'
        ? ((siteConfig as unknown as { copyright: string }).copyright).trim()
        : '';
    const feedAuthorName = seo.author.trim() || seo.title.trim() || siteConfig.title || 'GalleryKit';
    const feedRights = siteCopyright || `© ${new Date().getFullYear()} ${feedAuthorName}`;

    const xml = composeAtomFeed({
        feedId: feedSelfUrl,
        feedTitle: `${topicData.label} | ${seo.title}`,
        feedSelfUrl,
        feedAlternateUrl,
        feedUpdated,
        // R17-M1: feed-level <author> required by RFC 4287 §4.1.1.
        feedAuthor: {
            name: feedAuthorName,
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

    // C32-FEED: the rendered XML also depends on SEO/feed-shaping settings
    // that do not expose a reliable updated_at. Use a content-derived ETag
    // for 304s so settings-only changes force a fresh 200 instead of a stale
    // If-Modified-Since short-circuit.
    const etag = createAtomFeedEtag(xml);
    if (isEtagMatch(ifNoneMatch, etag)) {
        return new NextResponse(null, {
            status: 304,
            headers: {
                'Cache-Control': CACHE_CONTROL,
                'Vary': 'Accept-Language',
                'Last-Modified': lastModifiedHeader,
                'ETag': etag,
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
            'ETag': etag,
        },
    });
}
