import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export const dynamic = 'force-dynamic';

export async function GET() {
    if (isRestoreMaintenanceActive()) {
        return Response.json({ status: 'restore-maintenance' }, {
            status: 503,
            headers: { 'X-Content-Type-Options': 'nosniff' },
        });
    }

    let dbOk = false;
    try {
        await db.execute(sql`SELECT 1`);
        dbOk = true;
    } catch {
        // DB unreachable
    }

    const status = dbOk ? 'ok' : 'degraded';
    return Response.json({ status }, {
        status: dbOk ? 200 : 503,
        headers: { 'X-Content-Type-Options': 'nosniff' },
    });
}
