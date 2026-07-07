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
type JournalEntry = { tag: string; hash: string; folderMillis: number; containsDml?: boolean };
const migrate = require('../../scripts/migrate.js') as {
    prepareLegacyDatabaseIfNeeded: (
        connection: unknown,
        dbName: string,
        migrations: JournalEntry[],
    ) => Promise<void>;
    baselineAllJournalMigrations: (
        connection: unknown,
        migrations: JournalEntry[],
        options?: { maxFolderMillis?: number | null },
    ) => Promise<number>;
    journalSqlContainsDml: (sql: string) => boolean;
    runMigrations: (
        connection: unknown,
        migrationsFolder: string,
        expectedMigrations: JournalEntry[],
        migrateFn?: (db: unknown, opts: { migrationsFolder: string }) => Promise<void>,
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

    it('MIXED batch (drift below cursor + pending above): baselines ONLY the drift entries, never the pending tail (C3-01)', async () => {
        // Reproduces the run-10 c3 DBG3-02 empirical case: hash-2 (when=2500,
        // above cursor) and hash-4 (when=3000, above cursor) are genuinely new
        // pending migrations; hash-3 (when=1800, below cursor) is true drift
        // (e.g. a misdated `when` or out-of-band log surgery). The pre-fix
        // code baselined ALL THREE — silently dropping the pending tail's SQL
        // while the post-condition passed. The fix baselines only hash-3 and
        // leaves hash-2/hash-4 for drizzle.migrate() to genuinely apply.
        const migrations = journal([1000, 2000, 2500, 1800, 3000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: ['hash-0', 'hash-1'],
            cursor: 2000,
        });

        await migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations);

        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(1);
        expect(inserts[0]?.params?.[0]).toBe('hash-3');
        const insertedHashes = inserts.map((c) => c.params?.[0]);
        expect(insertedHashes).not.toContain('hash-2');
        expect(insertedHashes).not.toContain('hash-4');
    });

    it('legacy empty-log DB (cursor null) still baselines everything after reconcile', async () => {
        const migrations = journal([1000, 2000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: [],
            cursor: null,
        });

        await migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations);

        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(2);
        expect(inserts.map((c) => c.params?.[0])).toEqual(['hash-0', 'hash-1']);
    });
});

describe('baselineAllJournalMigrations — above-cursor guard (C3-01)', () => {
    it('throws instead of baselining an entry above the provided cursor', async () => {
        const migrations = journal([1000, 3000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: [],
            cursor: 2000,
        });

        await expect(
            migrate.baselineAllJournalMigrations(connection, migrations, { maxFolderMillis: 2000 }),
        ).rejects.toThrow(/Refusing to baseline/);
        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(0);
    });

    it('baselines normally when no cursor bound is provided (fresh/legacy bootstrap path)', async () => {
        const migrations = journal([1000, 3000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: [],
            cursor: null,
        });

        const inserted = await migrate.baselineAllJournalMigrations(connection, migrations, { maxFolderMillis: null });
        expect(inserted).toBe(2);
        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(2);
    });
});

describe('DML-baseline guard (C4-01 / DBG4-01 / TRC4-10)', () => {
    it('legacy empty-log DB (cursor null): REFUSES to baseline a non-allowlisted DML-bearing entry', async () => {
        // DBG4-01's reproduced scenario: gallery tables exist, the migrations
        // table exists but is EMPTY (cursor === null), and a brand-new
        // DML-bearing migration is missing. The C3-01 above-cursor guard is
        // structurally skipped here (no cursor), so the DML guard must refuse.
        const migrations: JournalEntry[] = [
            { tag: '0000_old_ddl', hash: 'hash-0', folderMillis: 1000 },
            { tag: '0099_new_dml_backfill', hash: 'hash-99', folderMillis: 99999, containsDml: true },
        ];
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: [],
            cursor: null,
        });

        await expect(
            migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations),
        ).rejects.toThrow(/DML-bearing/);
        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(0);
    });

    it('true-drift path (below cursor): REFUSES to baseline a non-allowlisted DML-bearing entry', async () => {
        // TRC4-10: a DML-bearing migration missing BELOW the cursor would have
        // been baselined without its DML ever running.
        const migrations: JournalEntry[] = [
            { tag: '0000_dml_drift', hash: 'hash-0', folderMillis: 1000, containsDml: true },
            { tag: '0001_recorded', hash: 'hash-1', folderMillis: 2000 },
        ];
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: ['hash-1'],
            cursor: 2000,
        });

        await expect(
            migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations),
        ).rejects.toThrow(/DML-bearing/);
        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(0);
    });

    it('allowlisted 0001_sync_current_schema still baselines despite carrying DML (mirrored by reconcile)', async () => {
        const migrations: JournalEntry[] = [
            { tag: '0000_init', hash: 'hash-0', folderMillis: 1000 },
            { tag: '0001_sync_current_schema', hash: 'hash-1', folderMillis: 2000, containsDml: true },
        ];
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: [],
            cursor: null,
        });

        await migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations);

        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(2);
        expect(inserts.map((c) => c.params?.[0])).toEqual(['hash-0', 'hash-1']);
    });

    it('DDL-only entries still baseline on the empty-log path (pinned legacy-bootstrap behavior preserved)', async () => {
        const migrations = journal([1000, 2000]);
        const { connection, calls } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: [],
            cursor: null,
        });

        await migrate.prepareLegacyDatabaseIfNeeded(connection, 'gallerykit', migrations);
        const inserts = calls.filter((c) => c.sql.includes('INSERT INTO __drizzle_migrations'));
        expect(inserts).toHaveLength(2);
    });
});

describe('journalSqlContainsDml (C4-01 detector)', () => {
    it('flags INSERT / UPDATE / DELETE / REPLACE statements', () => {
        expect(migrate.journalSqlContainsDml('INSERT INTO t VALUES (1);')).toBe(true);
        expect(migrate.journalSqlContainsDml('UPDATE t SET a = 1;')).toBe(true);
        expect(migrate.journalSqlContainsDml('DELETE FROM t;')).toBe(true);
        expect(migrate.journalSqlContainsDml('REPLACE INTO t VALUES (1);')).toBe(true);
    });

    it('does not flag DDL-only migrations', () => {
        expect(migrate.journalSqlContainsDml(
            'CREATE TABLE `a` (`id` int);--> statement-breakpoint\nALTER TABLE `a` ADD `b` int;',
        )).toBe(false);
    });

    it('ignores comment lines and detects DML after a statement-breakpoint', () => {
        const sql = [
            '-- UPDATE inside a comment must not count',
            'ALTER TABLE `shared_group_images` ADD `position` int DEFAULT 0 NOT NULL;--> statement-breakpoint',
            'UPDATE `shared_group_images` AS `sgi`',
            'SET `sgi`.`position` = 1',
            'WHERE `sgi`.`position` = 0;--> statement-breakpoint',
            'ALTER TABLE `x` ADD `y` int;',
        ].join('\n');
        expect(migrate.journalSqlContainsDml(sql)).toBe(true);
        expect(migrate.journalSqlContainsDml('-- DELETE ME (comment only)\nALTER TABLE `a` ADD `b` int;')).toBe(false);
    });

    it('flags the real 0001_sync_current_schema file (the allowlisted exception)', () => {
        const sql = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'drizzle', '0001_sync_current_schema.sql'),
            'utf8',
        );
        expect(migrate.journalSqlContainsDml(sql)).toBe(true);
    });
});

describe('runMigrations error propagation (C4-47)', () => {
    it('propagates a duplicate-DDL rejection from the migrator instead of swallowing it', async () => {
        const { connection } = makeConnection({
            hasGalleryTables: true,
            recordedHashes: [],
            cursor: null,
        });
        const duplicateDdl = Object.assign(new Error("Table 'images' already exists"), {
            code: 'ER_TABLE_EXISTS_ERROR',
        });
        await expect(
            migrate.runMigrations(connection, '/tmp/unused', journal([1000]), async () => {
                throw duplicateDdl;
            }),
        ).rejects.toThrow(/already exists/);
    });
});

describe('migrate.js source contracts (FDR-01 / C3-01)', () => {
    const src = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'scripts', 'migrate.js'),
        'utf8',
    );

    it('names the pending tail left for drizzle in the mixed drift case', () => {
        expect(src).toContain('NOT being baselined');
        expect(src).toContain('drizzle will apply their SQL');
    });

    it('keeps the baseline above-cursor refusal guard', () => {
        expect(src).toContain('Refusing to baseline');
    });

    it('keeps the runMigrations post-condition throw', () => {
        expect(src).toContain('Drizzle silently skipped');
    });
});
