import { NextRequest } from 'next/server';
import { serveUploadFile } from '@/lib/serve-upload';

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

export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    // R20-L1: pass 'HEAD' so serveUploadFile returns headers only and does not
    // open a file stream that Next would strip anyway.
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'), 'HEAD');
}
