/**
 * FDR-01 (run-10 c2) — pending new migrations must be APPLIED, not baselined.
 *
 * `prepareLegacyDatabaseIfNeeded` used to treat ANY missing journal hash on a
 * gallery-bearing DB as legacy drift: it ran `reconcileLegacySchema` and then
 * `baselineAllJournalMigrations`, which inserted the new migration's hash row
 * BEFORE `drizzle.migrate()` ran — so the committed `.sql` (including any DML
 * backfill, which reconcile does NOT mirror) never executed on any deployed
 * database, and the loud `runMigrations` post-condition was structurally
 * unreachable.
 *
 * The fix distinguishes the normal "new migrations pending" case: when every
 * missing entry sits strictly ABOVE the recorded MAX(created_at) cursor, the
 * function returns without reconciling or baselining, so drizzle genuinely
 * applies the pending SQL and records the hash rows itself.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);
const migrate = require('../../scripts/migrate.js') as {
    prepareLegacyDatabaseIfNeeded: (
        connection: unknown,
        dbName: string,
        migrations: Array<{ tag: string; hash: string; folderMillis: number }>,
    ) => Promise<void>;
};

type QueryCall = { sql: string; params?: unknown[] };

/**
 * Minimal connection mock: answers the exact query shapes
 * prepareLegacyDatabaseIfNeeded issues on the covered/pending paths and
 * records every call so the assertions can prove which paths were NOT taken.
 */
function makeConnection(opts: {
    hasGalleryTables: boolean;
    recordedHashes: string[];
    cursor: number | null;
}) {
    const calls: QueryCall[] = [];
    const connection = {
        async query(sql: string, params?: unknown[]) {
            calls.push({ sql, params });
            const compact = sql.replace(/\s+/g, ' ').trim();
            if (compact.startsWith('CREATE TABLE IF NOT EXISTS __drizzle_migrations')) {
                return [[], []];
            }
            if (compact.includes('INFORMATION_SCHEMA.TABLES')) {
                return [opts.hasGalleryTables ? [{ 1: 1 }] : [], []];
            }
            if (compact.startsWith('SELECT hash FROM __drizzle_migrations')) {
                return [opts.recordedHashes.map((hash) => ({ hash })), []];
            }
            if (compact.startsWith('SELECT MAX(created_at) AS cursor')) {
                return [[{ cursor: opts.cursor }], []];
            }
            // Any other statement (reconcile DDL probes, baseline INSERTs)
            // gets a permissive empty result — the assertions below check
            // whether such statements were issued at all.
            return [[], []];
        },
    };
    return { connection, calls };
}

const journal = (whens: number[]) =>
    whens.map((when, idx) => ({
        tag: `${String(idx).padStart(4, '0')}_test`,
        hash: `hash-${idx}`,
        folderMillis: when,
    }));

describe('prepareLegacyDatabaseIfNeeded — pending vs drift (FDR-01)', () => {
    it('leaves pending new-tail migrations unbaselined so drizzle applies them', async () => {
        const migrations = journal([1000, 2000, 3000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: ['hash-0', 'hash-1'],
            cursor: 2000,
        });

        await migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations);

        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(0);
        const reconcileWork = calls.filter((c) => /ALTER TABLE|CREATE TABLE (?!IF NOT EXISTS __drizzle)/.test(c.sql));
        expect(reconcileWork).toHaveLength(0);
    });

    it('returns without any writes when the journal is fully covered', async () => {
        const migrations = journal([1000, 2000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: ['hash-0', 'hash-1'],
            cursor: 2000,
        });

        await migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations);

        expect(calls.filter((c) => c.sql.includes('INSERT'))).toHaveLength(0);
    });

    it('still routes true drift (missing hash at/below the cursor) to reconcile + baseline', async () => {
        // Missing hash-0 sits BELOW the cursor → drift path. The permissive
        // mock absorbs reconcile's probes; the proof of path selection is the
        // baseline INSERT for the missing entries.
        const migrations = journal([1000, 2000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: ['hash-1'],
            cursor: 2000,
        });

        await migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations);

        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(1);
        expect(inserts[0]?.params?.[0]).toBe('hash-0');
    });
});

describe('migrate.js source contracts (FDR-01)', () => {
    const src = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'scripts', 'migrate.js'),
        'utf8',
    );

    it('names swallowed above-cursor entries when drift repair baselines them', () => {
        expect(src).toContain('WITHOUT executing their SQL');
        expect(src).toContain('must be applied manually');
    });

    it('keeps the runMigrations post-condition throw', () => {
        expect(src).toContain('Drizzle silently skipped');
    });
});
