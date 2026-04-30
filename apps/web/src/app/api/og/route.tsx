import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { isValidSlug, isValidTagName } from '@/lib/validation';
import siteConfig from '@/site-config.json';
import { getSeoSettings, getTopicBySlug } from '@/lib/data';
import { getClientIp, preIncrementOgAttempt, rollbackOgAttempt } from '@/lib/rate-limit';
import { countCodePoints } from '@/lib/utils';

export const runtime = 'nodejs';

const MAX_TOPIC_LABEL_LENGTH = 100;
// AGG8F-01 / plan-233: success-path cache control. The OG image is
// derived from validated topic + tag list — there is no per-user content
// to leak. `public, max-age=3600` lets CDNs and crawlers cache an hour;
// `stale-while-revalidate` keeps unfurl latency low while the revalidate
// pass runs in the background. The error branch keeps `no-store`.
const OG_SUCCESS_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
const OG_ERROR_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';

// C21-AGG-01: use countCodePoints and Array.from for codepoint-safe
// truncation so supplementary characters (emoji, rare CJK) are never
// split mid-surrogate by .slice(). Produces U+FFFD replacement
// characters in the Satori-rendered OG image when split.
function clampDisplayText(value: string, maxLength: number) {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (countCodePoints(trimmed) <= maxLength) return trimmed;
  const chars = Array.from(trimmed);
  return `${chars.slice(0, maxLength - 1).join('').trimEnd()}…`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const topic = searchParams.get('topic');
    const tags = searchParams.get('tags');

    if (!topic || topic.length > 200 || !isValidSlug(topic)) {
      return new Response('Missing or invalid topic param', {
        status: 400,
        headers: { 'Cache-Control': OG_ERROR_CACHE_CONTROL },
      });
    }

    // AGG8F-01 / plan-233: per-IP rate limit. The route is the only
    // public unauthenticated CPU-bound endpoint in the repo — every
    // other public surface (`searchImagesAction`, `loadMoreImages`)
    // carries an in-memory rate limit. Bring this surface into parity
    // so a scripted abuser cannot pin Node CPU. 30 requests/minute/IP
    // is well above natural traffic from social-share unfurls.
    const ip = getClientIp(req.headers);
    const now = Date.now();
    if (preIncrementOgAttempt(ip, now)) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'Cache-Control': OG_ERROR_CACHE_CONTROL,
          'Retry-After': '60',
        },
      });
    }

    const [seo, topicRecord] = await Promise.all([
      getSeoSettings(),
      getTopicBySlug(topic),
    ]);
    if (!topicRecord) {
      // C17-LOW-06: roll back the rate-limit counter on 404 — the user
      // searched for a non-existent topic and didn't consume CPU resources
      // for image generation. Public read paths should use rollback pattern
      // (Pattern 2 from rate-limit.ts docstring). The 500 error path below
      // intentionally keeps the charge per Pattern 1 logic.
      rollbackOgAttempt(ip);
      return new Response('Topic not found', {
        status: 404,
        headers: { 'Cache-Control': OG_ERROR_CACHE_CONTROL },
      });
    }

    const topicLabel = clampDisplayText(topicRecord.label, MAX_TOPIC_LABEL_LENGTH);
    const siteTitle = seo.title || siteConfig.title;
    // C2-AGG-03 / plan-257: clamp each tag name for display to prevent
    // layout distortion in the OG image when a tag hits the 100-char
    // isValidTagName ceiling. 30 chars is comfortable for the pill layout.
    const MAX_OG_TAG_DISPLAY_LENGTH = 30;
    const tagList = tags ? tags.split(',').filter(Boolean).slice(0, 20).map(t => t.trim()).filter(t => isValidTagName(t)).map(t => clampDisplayText(t, MAX_OG_TAG_DISPLAY_LENGTH)) : [];

    // AGG8F-01 / plan-233: ETag covers the inputs that drive the
    // rendered image. If a crawler revisits with `If-None-Match`,
    // short-circuit to 304 without rerunning the SVG/PNG pipeline.
    const etag = '"' + createHash('sha256')
      .update(`${topicRecord.slug}|${topicLabel}|${tagList.join(',')}|${siteTitle}`)
      .digest('hex')
      .slice(0, 32) + '"';
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          'Cache-Control': OG_SUCCESS_CACHE_CONTROL,
          'ETag': etag,
        },
      });
    }
    const cacheControl = OG_SUCCESS_CACHE_CONTROL;

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#09090b', // zinc-950
            backgroundImage: 'radial-gradient(circle at 25px 25px, #27272a 2%, transparent 0%), radial-gradient(circle at 75px 75px, #27272a 2%, transparent 0%)',
            backgroundSize: '100px 100px',
            color: 'white',
            fontFamily: 'sans-serif',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 80px',
              backgroundColor: 'rgba(0,0,0,0.5)',
              border: '1px solid #3f3f46', // zinc-700
              borderRadius: '24px',
              boxShadow: '0 20px 80px -20px rgba(0,0,0,0.8)',
              backdropFilter: 'blur(10px)',
            }}
          >
            {/* Logo or Brand */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
                fontSize: '24px',
                fontWeight: 600,
                color: '#a1a1aa', // zinc-400
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              {siteTitle}
            </div>

            {/* Topic Title */}
            <div
              style={{
                fontSize: '80px',
                fontWeight: 800,
                letterSpacing: '-0.025em',
                lineHeight: 1,
                background: 'linear-gradient(to bottom right, #fff 30%, #a1a1aa)',
                backgroundClip: 'text',
                color: 'transparent',
                marginBottom: tagList.length > 0 ? '20px' : '0',
                textAlign: 'center',
              }}
            >
              {topicLabel}
            </div>

            {/* Tags */}
            {tagList.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: '12px',
                  maxWidth: '800px',
                }}
              >
                {tagList.map((tag) => (
                  <div
                    key={tag}
                    style={{
                      fontSize: '32px',
                      padding: '8px 24px',
                      backgroundColor: '#27272a', // zinc-800
                      color: '#e4e4e7', // zinc-200
                      borderRadius: '9999px',
                      border: '1px solid #3f3f46', // zinc-700
                    }}
                  >
                    #{tag}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: {
            'Cache-Control': cacheControl,
            'ETag': etag,
        }
      },
    );
    } catch (e: unknown) {
    if (e instanceof Error) {
        console.error(`${e.message}`);
    }
    return new Response(`Failed to generate the image`, {
      status: 500,
      headers: {
        'Cache-Control': OG_ERROR_CACHE_CONTROL,
      },
    });
  }
}
