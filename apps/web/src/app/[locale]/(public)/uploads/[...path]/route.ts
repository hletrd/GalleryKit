import { NextRequest } from 'next/server';
import { serveUploadFile } from '@/lib/serve-upload';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'), 'GET');
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
