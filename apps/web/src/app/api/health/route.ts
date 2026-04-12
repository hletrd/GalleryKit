import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
    let dbOk = false;
    try {
        await db.execute(sql`SELECT 1`);
        dbOk = true;
    } catch {
        // DB unreachable
    }

    const status = dbOk ? 'ok' : 'degraded';
    return Response.json(
        { status, db: dbOk, timestamp: new Date().toISOString() },
        { status: dbOk ? 200 : 503 }
    );
}
