import { NextRequest } from 'next/server';
import { serveUploadFile } from '@/lib/serve-upload';

// @public-no-rate-limit-required: public upload derivative serving is bounded by path containment, ETag/HEAD validators, range handling, and cache headers; rate limiting would break normal gallery image delivery.
export const runtime = 'nodejs';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    // AGG-H5 (run-6 cycle-2): pass request.signal so a client abort mid-transfer
    // releases the file descriptor (belt-and-braces on top of Readable.toWeb's
    // cancel→destroy), preventing fd accumulation under rapid grid navigation.
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'), 'GET', request.signal);
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
