/**
 * view-retention.ts — retention sweep for the anonymous analytics view-event
 * tables (image_views / topic_views / shared_group_views).
 *
 * AGG-H2 (run-6 cycle-2): these tables are written by per-IP-rate-limited but
 * otherwise anonymous public endpoints (`app/actions/public.ts`) with no global
 * write ceiling and — before this module — no retention sweep. A rotating-IP
 * scraper could grow them (and their composite indexes) without bound on the
 * single MySQL writer until disk pressure. The hourly background GC
 * (`image-queue.ts`) already purges sessions / rate-limit buckets / audit log;
 * this adds the view tables to that sweep.
 *
 * Retention: default 395 days (13 months) so year-in-review / on-this-day
 * analytics keep a full prior year. Override with VIEW_RETENTION_DAYS.
 *
 * Safety: mirrors the audit-log retention guard (R4C6 COR-R4C6-10) — a NEGATIVE
 * or non-finite retention must NOT put the cutoff in the future (which would
 * match every row and wipe the tables). Any non-positive / non-finite input
 * falls back to the default. The DELETE is chunked so a large backlog cannot
 * hold a long table lock.
 */

import { lt } from 'drizzle-orm';

import { db } from '@/db';
import { imageViews, topicViews, sharedGroupViews } from '@/db/schema';

// 13 months — preserves a full prior year for year-in-review style features.
const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;

// Per-statement row cap so a multi-million-row backlog drains in bounded
// chunks instead of one table-locking DELETE.
const VIEW_PURGE_BATCH = 5000;
// Hard cap on chunk iterations per table per sweep, so an unexpectedly huge
// backlog can't spin the hourly job indefinitely — the remainder is cleared on
// the next sweep.
const MAX_BATCHES_PER_TABLE = 200;

function resolveRetentionMs(maxAgeMs?: number): number {
    if (maxAgeMs !== undefined) {
        return Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DEFAULT_VIEW_RETENTION_MS;
    }
    // R19C19 F1: parse with Number(), not Number.parseInt(..., 10). parseInt
    // stops at the first non-digit, so VIEW_RETENTION_DAYS='1e3' silently became
    // 1 (parseInt('1e3') === 1) — a 1-day retention that passes the `> 0` guard
    // and near-empties all three view tables on the next hourly GC. Number('1e3')
    // === 1000. NaN/'' (Number('') === 0) / negative inputs still fall through to
    // the default via the finite-and-positive guard below — matching the rest of
    // the config layer's coercion.
    const retentionDays = Number(process.env.VIEW_RETENTION_DAYS ?? '');
    return Number.isFinite(retentionDays) && retentionDays > 0
        ? retentionDays * 24 * 60 * 60 * 1000
        : DEFAULT_VIEW_RETENTION_MS;
}

/**
 * Delete view-event rows older than the retention window, in bounded chunks.
 * Uses the `(…, viewed_at)` composite indexes for the range scan.
 *
 * @param maxAgeMs optional explicit retention window (positive ms); falls back
 *                 to VIEW_RETENTION_DAYS env / the 395-day default.
 * @returns total rows deleted across all three tables.
 */
export async function purgeOldViewEvents(maxAgeMs?: number): Promise<number> {
    const cutoff = new Date(Date.now() - resolveRetentionMs(maxAgeMs));
    let deletedTotal = 0;

    // mysql2/drizzle DELETE supports a row LIMIT; loop until a batch deletes
    // fewer than the cap (table drained for now) or we hit the iteration cap.
    const tables = [
        { table: imageViews, col: imageViews.viewed_at },
        { table: topicViews, col: topicViews.viewed_at },
        { table: sharedGroupViews, col: sharedGroupViews.viewed_at },
    ] as const;

    for (const { table, col } of tables) {
        for (let i = 0; i < MAX_BATCHES_PER_TABLE; i++) {
            const result = await db
                .delete(table)
                .where(lt(col, cutoff))
                .limit(VIEW_PURGE_BATCH);
            // mysql2 returns affectedRows on the result header.
            const affected = (result as unknown as { affectedRows?: number })?.affectedRows ?? 0;
            deletedTotal += affected;
            if (affected < VIEW_PURGE_BATCH) break;
        }
    }

    return deletedTotal;
}
