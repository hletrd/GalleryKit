import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getImageCached, getSeoSettings } from '@/lib/data';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { UNICODE_FORMAT_CHARS } from '@/lib/validation';
import siteConfig from '@/site-config.json';

export const runtime = 'nodejs';

// US-P13: per-photo OG image at /api/og/photo/[id]
// Cache-Control spec: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400
const OG_SUCCESS_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';
const OG_ERROR_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';

// Target the medium derivative — large enough for 1200px OG, well below 5 MB cap.
const OG_PHOTO_TARGET_SIZE = 1536;
const OG_PHOTO_MAX_BYTES = 1024 * 1024; // 1 MB — guard against oversized derivatives in base64

/**
 * Strip Unicode bidi/invisible formatting characters from a display string
 * before embedding it into an OG image. Defense-in-depth: these are already
 * rejected at admin write time, but a cheap strip here closes any future gap.
 */
function sanitizeForOg(value: string): string {
    return value.replace(UNICODE_FORMAT_CHARS, '');
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    // Validate id is a positive integer
    if (!/^\d+$/.test(id)) {
        return buildFallbackResponse(req, OG_ERROR_CACHE_CONTROL);
    }
    const imageId = parseInt(id, 10);
    if (isNaN(imageId) || imageId <= 0 || !Number.isInteger(imageId)) {
        return buildFallbackResponse(req, OG_ERROR_CACHE_CONTROL);
    }

    try {
        const [image, seo, config] = await Promise.all([
            getImageCached(imageId),
            getSeoSettings(),
            getGalleryConfig(),
        ]);

        // Fall back to site default if photo not found.
        // getImageCached already filters WHERE processed = true, so a non-null
        // result is guaranteed to be processed.
        if (!image) {
            return buildFallbackResponse(req, OG_SUCCESS_CACHE_CONTROL, seo.og_image_url || undefined);
        }

        const siteTitle = sanitizeForOg(seo.title || siteConfig.title);
        const rawTitle = getPhotoDisplayTitle(image, `Photo #${image.id}`);
        const displayTitle = sanitizeForOg(rawTitle);

        // Build absolute URL for the medium JPEG derivative.
        // next/og (Satori) fetches images by HTTP — use origin from request.
        const nearestSize = findNearestImageSize(config.imageSizes, OG_PHOTO_TARGET_SIZE);
        const jpegFilename = image.filename_jpeg.replace(/\.jpg$/i, `_${nearestSize}.jpg`);
        const origin = new URL(req.url).origin;
        const photoUrl = `${origin}/uploads/jpeg/${jpegFilename}`;

        // Fetch the photo and convert to base64 data URL so Satori embeds it
        // without a second HTTP round-trip during rendering.
        // C1-BUG-06: 10-second timeout so a hung internal fetch does not hold
        // the OG request open indefinitely.
        const photoRes = await fetch(photoUrl, { signal: AbortSignal.timeout(10000) });
        if (!photoRes.ok) {
            return buildFallbackResponse(req, OG_SUCCESS_CACHE_CONTROL, seo.og_image_url || undefined);
        }
        const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
        if (photoBuffer.length > OG_PHOTO_MAX_BYTES) {
            return buildFallbackResponse(req, OG_SUCCESS_CACHE_CONTROL, seo.og_image_url || undefined);
        }
        const photoDataUrl = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;

        return new ImageResponse(
            (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        position: 'relative',
                        backgroundColor: '#09090b',
                    }}
                >
                    {/* Full-bleed photo — object-fit cover */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={photoDataUrl}
                        alt=""
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />

                    {/* Darkening gradient overlay — bottom-to-top */}
                    <div
                        style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: '55%',
                            background:
                                'linear-gradient(to top, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.55) 50%, transparent 100%)',
                            display: 'flex',
                        }}
                    />

                    {/* Title + site name overlay */}
                    <div
                        style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            padding: '40px 56px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                        }}
                    >
                        {displayTitle && (
                            <div
                                style={{
                                    fontSize: '64px',
                                    fontWeight: 800,
                                    color: '#ffffff',
                                    letterSpacing: '-0.02em',
                                    lineHeight: 1.1,
                                    // Satori does not support line-clamp; cap with maxHeight
                                    maxHeight: '160px',
                                    overflow: 'hidden',
                                }}
                            >
                                {displayTitle}
                            </div>
                        )}
                        <div
                            style={{
                                fontSize: '28px',
                                fontWeight: 500,
                                color: 'rgba(255,255,255,0.70)',
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                            }}
                        >
                            {siteTitle}
                        </div>
                    </div>
                </div>
            ),
            {
                width: 1200,
                height: 630,
                headers: {
                    'Cache-Control': OG_SUCCESS_CACHE_CONTROL,
                },
            },
        );
    } catch (e: unknown) {
        if (e instanceof Error) {
            console.error(`[og/photo] ${e.message}`);
        }
        return buildFallbackResponse(req, OG_ERROR_CACHE_CONTROL);
    }
}

/**
 * Fallback: redirect to the admin-configured site OG image URL, or to the
 * site homepage. Uses 302 so crawlers re-check on future visits (the photo
 * may become available after background processing completes).
 */
function buildFallbackResponse(
    req: NextRequest,
    cacheControl: string,
    ogImageUrl?: string,
): Response {
    if (ogImageUrl) {
        return new Response(null, {
            status: 302,
            headers: {
                Location: ogImageUrl,
                'Cache-Control': cacheControl,
            },
        });
    }
    // No configured fallback: redirect to the site root so crawlers get
    // the homepage's own OG metadata rather than a broken image URL.
    const origin = new URL(req.url).origin;
    return new Response(null, {
        status: 302,
        headers: {
            Location: `${origin}/`,
            'Cache-Control': cacheControl,
        },
    });
}
