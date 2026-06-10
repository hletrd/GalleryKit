import { NextRequest } from 'next/server';
import { serveUploadFile } from '@/lib/serve-upload';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'), 'GET');
}

// R11-M1: respond to SW HEAD probes that include If-None-Match.
export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    // R20-L1 / R4C3 COR-R4C3-01: pass 'HEAD' so serveUploadFile returns
    // headers only and does not open a file stream that Next would strip
    // anyway. This route previously omitted the argument (defaulting to
    // 'GET') while the locale-prefixed twin passed it — so the headers-only
    // fast path was dead on the PRIMARY serving route and every SW HEAD
    // revalidate opened a discarded createReadStream fd.
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'), 'HEAD');
}
