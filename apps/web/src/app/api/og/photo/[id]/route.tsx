import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getImageCached, getSeoSettings } from '@/lib/data';
import { getGalleryConfig } from '@/lib/gallery-config';
import { pickFirstAvailablePhotoBuffer } from '@/lib/og-photo-fetch';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { sanitizeForOg } from '@/lib/og-sanitize';
import { preIncrementOgAttempt, rollbackOgAttempt, getClientIp } from '@/lib/rate-limit';
import { BASE_URL } from '@/lib/constants';
import siteConfig from '@/site-config.json';
import { parseSafePositiveInteger } from '@/lib/validation';

export const runtime = 'nodejs';

// US-P13: per-photo OG image at /api/og/photo/[id]
// Cache-Control spec: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400
const OG_SUCCESS_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';
const OG_ERROR_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';

// sanitizeForOg now lives in @/lib/og-sanitize (AGG-R8-13) so this route and
// the home/site OG route share one Unicode-format + C0-control strip. See that
// module for the AGG-4 / R17-L4 rationale.

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

    const imageId = parseSafePositiveInteger(id);
    if (imageId === null) {
        rollbackOgAttempt(ip);
        return buildFallbackResponse(BASE_URL, OG_ERROR_CACHE_CONTROL);
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
        // SEC-R4C17-01: the attempt stays CHARGED — this branch is reached
        // only after real DB work, and refunding it made this route a free
        // image-id-enumeration oracle with unmetered DB load. The sibling
        // /api/og route documents and test-locks the same charged-404
        // policy (og-route-source-contracts.test.ts); this route's contract
        // is locked by og-photo-fallback.test.ts.
        if (!image) {
            return buildFallbackResponse(seo.url, OG_SUCCESS_CACHE_CONTROL, seo.og_image_url || undefined);
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
        // next/og (Satori) fetches the photo derivative by HTTP.
        // SEC-01 / AGG-M7 (run-6 cycle-2): pin the internal fetch base to the
        // TRUSTED effective canonical site origin (`BASE_URL || siteConfig.url`) rather than
        // `new URL(req.url).origin`. The request origin is derived from the
        // inbound Host / X-Forwarded-Host; a fronting proxy that forwards an
        // arbitrary Host could otherwise coerce this server-side fetch into
        // hitting `http://attacker/uploads/jpeg/<uuid>` (a weak blind-SSRF /
        // cache-poison primitive). The path component is already a validated
        // UUID derivative — pinning the host closes the only attacker lever.
        // If the effective canonical URL is unset / unparseable, do NOT fall back to the
        // attacker-controllable request origin; return a canonical fallback
        // response or fail closed.
        let fetchOrigin: string;
        try {
            fetchOrigin = new URL(BASE_URL).origin;
        } catch {
            // R5-H4: fail closed — when the canonical URL is unset (dev), do NOT
            // fall back to the attacker-controllable request origin. Return the
            // fallback response instead of exposing a blind-SSRF primitive.
            return buildFallbackResponse(seo.url, OG_ERROR_CACHE_CONTROL, seo.og_image_url || undefined);
        }
        const fetched = await pickFirstAvailablePhotoBuffer(
            fetchOrigin,
            image.filename_jpeg,
            config.imageSizes,
        );
        if (!fetched) {
            // SEC-R4C17-01: charged — this branch consumed DB work plus up
            // to |imageSizes| internal fetch attempts (10 s timeout / 1 MB
            // cap each); refunding it let one legacy photo in a backfill
            // window become an unmetered internal-fetch amplifier.
            return buildFallbackResponse(seo.url, OG_SUCCESS_CACHE_CONTROL, seo.og_image_url || undefined);
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
        // SEC-R4C17-01: charged — failures landing here consumed DB work
        // and potentially Satori/Sharp CPU; refunding them allowed
        // error-triggering inputs (e.g. a corrupt derivative) to retry
        // without ever tripping the limiter. Matches the sibling /api/og
        // route's catch path, which has never refunded.
        if (e instanceof Error) {
            console.error(`[og/photo] ${e.message}`);
        }
        return buildFallbackResponse(BASE_URL, OG_ERROR_CACHE_CONTROL);
    }
}

/**
 * Fallback: redirect to the admin-configured site OG image URL, or to the
 * site homepage. Uses 302 so crawlers re-check on future visits (the photo
 * may become available after background processing completes).
 */
function buildFallbackResponse(
    canonicalBaseUrl: string,
    cacheControl: string,
    ogImageUrl?: string,
): Response {
    let canonicalOrigin: string;
    try {
        canonicalOrigin = new URL(canonicalBaseUrl).origin;
    } catch {
        return new Response('Not found', {
            status: 404,
            headers: {
                'Cache-Control': OG_ERROR_CACHE_CONTROL,
                'X-Content-Type-Options': 'nosniff',
            },
        });
    }

    if (ogImageUrl) {
        // R5-H5: validate the admin-configured OG image URL is same-origin
        // before redirecting. Prevents an open-redirect primitive if the
        // admin SEO settings are ever compromised or poisoned.
        try {
            const url = new URL(ogImageUrl, canonicalOrigin);
            if (url.origin === canonicalOrigin) {
                return new Response(null, {
                    status: 302,
                    headers: {
                        Location: url.toString(),
                        'Cache-Control': cacheControl,
                    },
                });
            }
        } catch {
            // Invalid URL — fall through to the site-root redirect below.
        }
    }
    // No configured fallback: redirect to the site root so crawlers get
    // the homepage's own OG metadata rather than a broken image URL.
    return new Response(null, {
        status: 302,
        headers: {
            Location: `${canonicalOrigin}/`,
            'Cache-Control': cacheControl,
        },
    });
}
