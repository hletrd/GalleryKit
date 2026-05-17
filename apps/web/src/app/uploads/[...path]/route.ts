import { NextRequest } from 'next/server';
import { serveUploadFile } from '@/lib/serve-upload';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'));
}

// R11-M1: respond to SW HEAD probes that include If-None-Match. We
// reuse the same GET pipeline; NextResponse will strip the body for
// HEAD method requests when delivered, but the route handler itself
// must opt-in by exporting HEAD explicitly.
export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'));
}
