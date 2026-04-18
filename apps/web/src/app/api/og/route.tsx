import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const topic = searchParams.get('topic');
    const tags = searchParams.get('tags');

    if (!topic || topic.length > 200) {
      return new Response('Missing or invalid topic param', { status: 400 });
    }

    const tagList = tags ? tags.split(',').filter(Boolean).slice(0, 20).map(t => t.slice(0, 100)) : [];

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
              GalleryKit
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
              {(() => { const t = topic.length > 50 ? topic.slice(0, 50) + '...' : topic; return t.charAt(0).toUpperCase() + t.slice(1); })()}
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
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
}
