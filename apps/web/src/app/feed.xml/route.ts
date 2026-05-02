import { NextResponse } from 'next/server';
import { getImagesLite, getSeoSettings } from '@/lib/data';
import { composeAtomFeed } from '@/lib/atom-feed';
import { absoluteImageUrl, sizedImageFilename } from '@/lib/image-url';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { DEFAULT_LOCALE } from '@/lib/constants';
import { localizePath } from '@/lib/locale-path';

export const runtime = 'nodejs';

const FEED_LIMIT = 50;
const CACHE_CONTROL = 'public, max-age=600, s-maxage=1800';

export async function GET() {
    const seo = await getSeoSettings();
    const baseUrl = seo.url;

    const rows = await getImagesLite(undefined, undefined, FEED_LIMIT, 0);

    const feedSelfUrl = `${baseUrl}/feed.xml`;
    const feedAlternateUrl = `${baseUrl}${localizePath(DEFAULT_LOCALE, '/')}`;

    // Use the created_at of the most recent image as the feed's updated date,
    // falling back to now if the feed is empty.
    const feedUpdated = rows[0]?.created_at
        ? (rows[0].created_at instanceof Date
            ? rows[0].created_at.toISOString()
            : new Date(rows[0].created_at).toISOString())
        : new Date().toISOString();

    const entries = rows.map((img) => {
        const photoPath = localizePath(DEFAULT_LOCALE, `/p/${img.id}`);
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
        feedTitle: seo.title,
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
