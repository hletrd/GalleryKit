import { NextRequest } from 'next/server';
import { serveUploadFile } from '@/lib/serve-upload';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    return serveUploadFile(pathSegments);
}
