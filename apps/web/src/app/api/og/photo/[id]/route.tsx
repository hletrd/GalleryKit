import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getImageCached, getSeoSettings } from '@/lib/data';
import { getGalleryConfig } from '@/lib/gallery-config';
import { pickFirstAvailablePhotoBuffer } from '@/lib/og-photo-fetch';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { UNICODE_FORMAT_CHARS } from '@/lib/validation';
import { preIncrementOgAttempt, rollbackOgAttempt, getClientIp } from '@/lib/rate-limit';
import siteConfig from '@/site-config.json';

export const runtime = 'nodejs';

// US-P13: per-photo OG image at /api/og/photo/[id]
// Cache-Control spec: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400
const OG_SUCCESS_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';
const OG_ERROR_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';

/**
 * Strip Unicode bidi/invisible formatting characters from a display string
 * before embedding it into an OG image. Defense-in-depth: these are already
 * rejected at admin write time, but a cheap strip here closes any future gap.
 *
 * R17-L4: also strips C0 control characters (XML-forbidden in document
 * content; equally inappropriate inside an OG image string — Satori
 * renders them as missing glyphs or drops them, depending on font).
 * Mirrors the same defense in `lib/atom-feed.ts` (R17-L1).
 */
const OG_C0_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
function sanitizeForOg(value: string): string {
    return value.replace(UNICODE_FORMAT_CHARS, '').replace(OG_C0_CONTROL_CHARS, '');
}

/**
 * Post-process Satori PNG output through Sharp to embed sRGB ICC.
 * WI-04: Satori internally flattens to sRGB via resvg. Writing a P3 ICC
 * tag over sRGB-clipped pixels would mislead color-managed viewers.
 * Always emit sRGB JPEG regardless of source gamut.
 */
async function postProcessOgImage(pngBuffer: Buffer): Promise<Buffer> {
    return sharp(pngBuffer)
        .toColorspace('srgb')
        .withIccProfile('srgb')
        .jpeg({ quality: 88 })
        .toBuffer();
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    // C7-SEC-01: rate-limit the CPU-intensive OG image generation endpoint.
    // Budget: 30 requests / 60s / IP (same as main /api/og route).
    const ip = getClientIp(req.headers);
    if (preIncrementOgAttempt(ip, Date.now())) {
        return new Response('Rate limited', { status: 429, headers: { 'Cache-Control': 'no-store' } });
    }

    // Validate id is a positive integer
    if (!/^\d+$/.test(id)) {
        rollbackOgAttempt(ip);
        return buildFallbackResponse(req, OG_ERROR_CACHE_CONTROL);
    }
    const imageId = parseInt(id, 10);
    if (isNaN(imageId) || imageId <= 0 || !Number.isInteger(imageId)) {
        rollbackOgAttempt(ip);
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
            rollbackOgAttempt(ip);
            return buildFallbackResponse(req, OG_SUCCESS_CACHE_CONTROL, seo.og_image_url || undefined);
        }

        const siteTitle = sanitizeForOg(seo.title || siteConfig.title);
        const rawTitle = getPhotoDisplayTitle(image, `Photo #${image.id}`);
        const displayTitle = sanitizeForOg(rawTitle);

        // R24-M1: iterate configured `imageSizes` ascending; first available
        // sized JPEG derivative wins. This degrades cleanly through the
        // backfill window where the originally-targeted size may not yet
        // exist on disk for legacy photos (e.g. after an `image_sizes`
        // admin reconfigure). Only after ALL sizes 404 / overflow do we
        // fall back to the admin-configured site-default OG.
        //
        // Lineage: R21-M1 / R22-M1 / R23-M1 closed the browser-side onError
        // fallback contract on every public `<img>`. R24-M1 closes the
        // equivalent server-side fallback contract on the only remaining
        // sized-derivative-only consumer (per-photo OG generator). The
        // encoder atomic-rename contract guarantees every configured size
        // for `processed = true` photos eventually exists; the fallback
        // chain bridges the transient backfill / reconfigure window.
        //
        // next/og (Satori) fetches images by HTTP — use origin from request.
        // The helper carries the existing 10 s AbortSignal.timeout and the
        // existing Content-Length / buffer byte caps per attempt.
        const origin = new URL(req.url).origin;
        const fetched = await pickFirstAvailablePhotoBuffer(
            origin,
            image.filename_jpeg,
            config.imageSizes,
        );
        if (!fetched) {
            rollbackOgAttempt(ip);
            return buildFallbackResponse(req, OG_SUCCESS_CACHE_CONTROL, seo.og_image_url || undefined);
        }
        const photoDataUrl = `data:image/jpeg;base64,${fetched.buffer.toString('base64')}`;

        // US-CM08: generate OG as PNG via Satori, then post-process through
        // Sharp to embed the correct ICC profile and re-encode as JPEG.
        const ogResponse = new ImageResponse(
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
            },
        );

        const pngBuffer = Buffer.from(await ogResponse.arrayBuffer());
        const jpegBuffer = await postProcessOgImage(pngBuffer);
        return new Response(new Uint8Array(jpegBuffer), {
            headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': OG_SUCCESS_CACHE_CONTROL,
            },
        });
    } catch (e: unknown) {
        rollbackOgAttempt(ip);
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
