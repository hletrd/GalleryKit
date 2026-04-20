import { NextRequest } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function isInternalHealthCheck(request: NextRequest) {
    const host = request.headers.get('host')?.split(':')[0] ?? '';
    return host === '127.0.0.1' || host === 'localhost';
}

export async function GET(request: NextRequest) {
    let dbOk = false;
    try {
        await db.execute(sql`SELECT 1`);
        dbOk = true;
    } catch {
        // DB unreachable
    }

    if (!isInternalHealthCheck(request)) {
        return Response.json({ status: 'ok' }, { status: 200 });
    }

    const status = dbOk ? 'ok' : 'degraded';
    return Response.json(
        { status, db: dbOk, timestamp: new Date().toISOString() },
        { status: dbOk ? 200 : 503 }
    );
}
