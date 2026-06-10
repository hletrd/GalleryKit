/**
 * Run-4 cycle 1 (COR-R4C1-13): reconcileLegacySchema coverage tripwire.
 *
 * The migration runbook (CLAUDE.md "Adding a new migration", step 3) requires
 * every new migration to be mirrored into `reconcileLegacySchema` in
 * scripts/migrate.js so a database that bootstraps through the reconcile +
 * baseline path (fresh installs per COR-R4C1-12, legacy re-baselines) comes
 * out with the COMPLETE schema. That contract was silently violated for the
 * color/HDR era (migrations 0015-0018): seven `images` columns were missing
 * and the very first INSERT failed with ER_BAD_FIELD_ERROR on every fresh
 * install.
 *
 * This test introspects the authoritative Drizzle schema (no DB connection
 * needed) and asserts that migrate.js mentions every table and every column
 * name. It is a SOURCE tripwire, not a structural validator — it cannot
 * verify types or defaults — but it catches the real failure class: a new
 * column landing in schema.ts + drizzle/*.sql without the reconcile mirror.
 * The authoritative end-to-end check remains a fresh-DB `npm run init`
 * followed by a drizzle-vs-information_schema diff (performed in R4C1).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getTableName, getTableColumns } from 'drizzle-orm';
import * as schema from '@/db/schema';

const MIGRATE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'scripts', 'migrate.js'),
    'utf8',
);

function collectTables(): Array<{ table: string; columns: string[] }> {
    const out: Array<{ table: string; columns: string[] }> = [];
    for (const exported of Object.values(schema)) {
        let table: string;
        try {
            table = getTableName(exported as never);
        } catch {
            continue;
        }
        let colsObj: unknown;
        try {
            colsObj = getTableColumns(exported as never);
        } catch {
            continue;
        }
        if (!table || !colsObj || typeof colsObj !== 'object') continue;
        const columns = Object.values(colsObj as Record<string, { name: string }>)
            .map((c) => c.name)
            .filter((n): n is string => typeof n === 'string');
        out.push({ table, columns });
    }
    return out;
}

describe('reconcileLegacySchema mirrors the full Drizzle schema (COR-R4C1-13)', () => {
    const tables = collectTables();

    it('introspects a non-trivial schema', () => {
        expect(tables.length).toBeGreaterThanOrEqual(15);
        const images = tables.find((t) => t.table === 'images');
        expect(images).toBeDefined();
        expect(images!.columns.length).toBeGreaterThanOrEqual(40);
    });

    it.each(tables.map((t) => [t.table] as const))(
        'migrate.js creates table %s',
        (table) => {
            expect(MIGRATE_SRC).toMatch(
                new RegExp(`CREATE TABLE IF NOT EXISTS \\\`?${table}\\\`?`),
            );
        },
    );

    it.each(tables.map((t) => [t.table, t.columns] as const))(
        'migrate.js mentions every column of %s',
        (_table, columns) => {
            const missing = columns.filter((c) => !MIGRATE_SRC.includes(c));
            expect(missing).toEqual([]);
        },
    );
});
