import { NextRequest } from 'next/server';
import { serveUploadFile } from '@/lib/serve-upload';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'));
}

export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    return serveUploadFile(pathSegments, request.headers.get('if-none-match'));
}
