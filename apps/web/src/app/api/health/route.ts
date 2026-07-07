import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** C1-16: readiness probes must answer within the orchestrator patience window. */
const HEALTH_DB_PROBE_TIMEOUT_MS = 2_000;

// C4-20 (run-10 c4): coalesce concurrent readiness probes onto ONE in-flight
// query. A load balancer / orchestrator can fire overlapping /api/health
// checks; without coalescing each opens its own `SELECT 1` and — during the
// very DB incident the probe reports (a stalled-but-accepting MySQL) — a burst
// piles multiple of the 10 pool connections onto the wedge. One shared promise
// caps that at a single probe connection no matter how many checks stack up.
let inflightDbProbe: Promise<boolean> | null = null;

async function runDbProbe(): Promise<boolean> {
    try {
        // C1-16 (run-10 cycle-1, CR-03): bound how long the readiness RESPONSE
        // waits. NOTE (C4-20 honesty fix): the timeout only stops us WAITING —
        // the underlying `db.execute` keeps its pool connection until MySQL
        // actually returns or the connection dies, so a bounded probe does not
        // by itself release the connection mid-incident. What it does guarantee
        // is the probe answers not-ready (-> 503) within the orchestrator
        // patience window instead of hanging, and coalescing (above) keeps the
        // pinned connection count at one.
        await Promise.race([
            db.execute(sql`SELECT 1`),
            new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new Error('health probe timeout')), HEALTH_DB_PROBE_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
        return true;
    } catch {
        // DB unreachable or probe timed out
        return false;
    }
}

function probeDb(): Promise<boolean> {
    if (!inflightDbProbe) {
        inflightDbProbe = runDbProbe().finally(() => { inflightDbProbe = null; });
    }
    return inflightDbProbe;
}

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

    const dbOk = await probeDb();

    const status = dbOk ? 'ok' : 'unavailable';
    return Response.json({ status }, {
        status: dbOk ? 200 : 503,
        headers: {
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
    });
}
