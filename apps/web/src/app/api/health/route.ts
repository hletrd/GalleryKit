import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** C1-16: readiness probes must answer within the orchestrator's patience. */
const HEALTH_DB_PROBE_TIMEOUT_MS = 2_000;

// @public-no-rate-limit-required: operational readiness endpoint; optional DB probe is intentionally unauthenticated and low-cost.
export async function GET() {
    if (isRestoreMaintenanceActive()) {
        return Response.json({ status: 'unavailable' }, {
            status: 503,
            headers: {
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        });
    }

    if (process.env.HEALTH_CHECK_DB !== 'true') {
        return Response.json({ status: 'ok' }, {
            headers: {
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        });
    }

    let dbOk = false;
    try {
        // C1-16 (run-10 cycle-1, CR-03): bound the probe. A wedged-but-accepting
        // MySQL (lock stall, saturated pool queue) neither resolves nor rejects
        // promptly; an unbounded readiness probe then hangs past the
        // orchestrator's own HTTP timeout AND pins one of the 10 pool
        // connections during the very incident it should be reporting. Timeout
        // counts as not-ready -> 503.
        await Promise.race([
            db.execute(sql`SELECT 1`),
            new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new Error('health probe timeout')), HEALTH_DB_PROBE_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
        dbOk = true;
    } catch {
        // DB unreachable or probe timed out
    }

    const status = dbOk ? 'ok' : 'unavailable';
    return Response.json({ status }, {
        status: dbOk ? 200 : 503,
        headers: {
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
    });
}
