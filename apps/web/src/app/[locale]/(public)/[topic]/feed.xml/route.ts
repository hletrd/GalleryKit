import { NextResponse } from 'next/server';
import { getImagesLite, getSeoSettings, getTopicBySlug } from '@/lib/data';
import { composeAtomFeed } from '@/lib/atom-feed';
import { absoluteImageUrl, sizedImageFilename } from '@/lib/image-url';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { localizePath } from '@/lib/locale-path';

export const runtime = 'nodejs';

const FEED_LIMIT = 50;
const CACHE_CONTROL = 'public, max-age=600, s-maxage=1800';

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ locale: string; topic: string }> },
) {
    const { locale, topic: topicSlug } = await params;

    const [seo, topicData] = await Promise.all([
        getSeoSettings(),
        getTopicBySlug(topicSlug),
    ]);

    if (!topicData) {
        return new NextResponse(null, { status: 404 });
    }

    const baseUrl = seo.url;
    const rows = await getImagesLite(topicData.slug, undefined, FEED_LIMIT, 0);

    const topicPath = localizePath(locale, `/${topicData.slug}`);
    const feedSelfUrl = `${baseUrl}${topicPath}/feed.xml`;
    const feedAlternateUrl = `${baseUrl}${topicPath}`;

    const feedUpdated = rows[0]?.created_at
        ? (rows[0].created_at instanceof Date
            ? rows[0].created_at.toISOString()
            : new Date(rows[0].created_at).toISOString())
        : new Date().toISOString();

    const entries = rows.map((img) => {
        const photoPath = localizePath(locale, `/p/${img.id}`);
        const photoUrl = `${baseUrl}${photoPath}`;
        const title = getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`);

        const jpegSized = sizedImageFilename(img.filename_jpeg, 1536);
        const mediaUrl = absoluteImageUrl(`/uploads/jpeg/${jpegSized}`, baseUrl);

        const updatedAt = img.created_at instanceof Date
            ? img.created_at.toISOString()
            : new Date(img.created_at).toISOString();

        return {
            id: photoUrl,
            title,
            updated: updatedAt,
            summary: img.description ?? img.capture_date ?? '',
            link: photoUrl,
            mediaContentUrl: mediaUrl,
        };
    });

    const xml = composeAtomFeed({
        feedId: feedSelfUrl,
        feedTitle: `${topicData.label} | ${seo.title}`,
        feedSelfUrl,
        feedAlternateUrl,
        feedUpdated,
        entries,
    });

    return new NextResponse(xml, {
        status: 200,
        headers: {
            'Content-Type': 'application/atom+xml; charset=utf-8',
            'Cache-Control': CACHE_CONTROL,
        },
    });
}
