import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const { getMysqlConnectionOptions } = require('./mysql-connection-options.js');
const {
    baselineAllJournalMigrations,
    getAllJournalMigrations,
    reconcileLegacySchema,
    runMigrations,
} = require('./migrate.js');

export const EXPECTED_LATEST_MIGRATION = '0033_capture_year_index';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const SAFE_DATABASE_NAME = /(^|[_-])(test|ci|e2e)([_-]|$)/i;
const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationsFolder = path.join(appRoot, 'drizzle');

const LATEST_MIGRATION_FIXTURES = {
    // Exercise both schema migrations added after the last independently
    // proven production cursor. A future latest tag must add its own explicit
    // fixture entry instead of merely changing EXPECTED_LATEST_MIGRATION.
    '0033_capture_year_index': {
        baselineTag: '0031_derivative_max_width',
        async downgrade(connection) {
            await connection.query('DROP INDEX idx_images_processed_capture_year ON images');
            await connection.query('ALTER TABLE images DROP COLUMN capture_year');
            await connection.query('DROP INDEX idx_images_processed_capture_month_day ON images');
            await connection.query('ALTER TABLE images DROP COLUMN capture_day, DROP COLUMN capture_month');
            await connection.query('DROP INDEX idx_images_processed_capture_date ON images');
            await connection.query('CREATE INDEX idx_images_processed_capture_date ON images (processed, capture_date, created_at)');
            await connection.query('DROP INDEX idx_images_topic ON images');
            await connection.query('CREATE INDEX idx_images_topic ON images (topic, processed, capture_date, created_at)');
        },
    },
};

function assertDisposableDatabase(options) {
    if (process.env.SCHEMA_CONVERGENCE_ALLOW_MUTATION !== 'true') {
        throw new Error('Set SCHEMA_CONVERGENCE_ALLOW_MUTATION=true to run the destructive disposable-DB convergence check.');
    }
    if (!LOCAL_HOSTS.has(options.host)) {
        throw new Error(`Schema convergence check only permits a local DB host; received ${options.host}.`);
    }
    if (!SAFE_DATABASE_NAME.test(options.database)) {
        throw new Error(`Schema convergence check requires a test/ci/e2e database name; received ${options.database}.`);
    }
}

function loadJournal() {
    return JSON.parse(readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
}

function latestMigrationFixture() {
    const journal = loadJournal();
    const latest = journal.entries.at(-1)?.tag;
    if (latest !== EXPECTED_LATEST_MIGRATION) {
        throw new Error(
            `Schema convergence probe is stale: expected latest ${EXPECTED_LATEST_MIGRATION}, journal latest is ${latest ?? 'missing'}.`,
        );
    }
    const fixture = LATEST_MIGRATION_FIXTURES[latest];
    if (!fixture) {
        throw new Error(`No explicit prior-release upgrade fixture exists for latest migration ${latest}.`);
    }
    if (!journal.entries.some((entry) => entry.tag === fixture.baselineTag)) {
        throw new Error(`Upgrade fixture baseline ${fixture.baselineTag} is absent from the migration journal.`);
    }
    return fixture;
}

async function schemaSnapshot(connection, dbName) {
    const queries = {
        tables: `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
                 FROM INFORMATION_SCHEMA.TABLES
                 WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
                 ORDER BY TABLE_NAME`,
        columns: `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE,
                         IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION, COLLATION_NAME
                  FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = ?
                  ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        indexes: `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
                         COLLATION, SUB_PART, INDEX_TYPE, IS_VISIBLE, EXPRESSION
                  FROM INFORMATION_SCHEMA.STATISTICS
                  WHERE TABLE_SCHEMA = ?
                  ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        foreignKeys: `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION,
                             k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
                             r.UPDATE_RULE, r.DELETE_RULE
                      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
                      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
                        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
                       AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                       AND r.TABLE_NAME = k.TABLE_NAME
                      WHERE k.CONSTRAINT_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
                      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    };
    const snapshot = {};
    for (const [name, sql] of Object.entries(queries)) {
        const [rows] = await connection.query(sql, [dbName]);
        snapshot[name] = rows;
    }
    return JSON.stringify(snapshot);
}

async function downgradeToFixture(connection, fixture, migrations) {
    const baselineIndex = migrations.findIndex((migration) => migration.tag === fixture.baselineTag);
    const pending = migrations.slice(baselineIndex + 1);
    if (pending.at(-1)?.tag !== EXPECTED_LATEST_MIGRATION) {
        throw new Error(`Upgrade fixture does not reach ${EXPECTED_LATEST_MIGRATION}.`);
    }

    await fixture.downgrade(connection);
    await connection.query(
        'DELETE FROM __drizzle_migrations WHERE hash IN (?)',
        [pending.map((migration) => migration.hash)],
    );
    return pending;
}

async function assertMigrationHashesRecorded(connection, pending) {
    const [rows] = await connection.query(
        'SELECT hash FROM __drizzle_migrations WHERE hash IN (?)',
        [pending.map((migration) => migration.hash)],
    );
    const recorded = new Set(rows.map((row) => row.hash));
    const missing = pending.filter((migration) => !recorded.has(migration.hash));
    if (missing.length > 0) {
        throw new Error(`Real pending upgrade did not record: ${missing.map((migration) => migration.tag).join(', ')}.`);
    }
}

async function simulateDefinitionDrift(connection) {
    await connection.query('DROP INDEX idx_images_processed_capture_month_day ON images');
    await connection.query('DROP INDEX idx_images_processed_capture_year ON images');
    await connection.query('ALTER TABLE images DROP COLUMN capture_year, DROP COLUMN capture_day, DROP COLUMN capture_month');
    await connection.query(`ALTER TABLE images
        ADD COLUMN capture_month tinyint unsigned NULL AFTER capture_date,
        ADD COLUMN capture_day tinyint unsigned NULL AFTER capture_month,
        ADD COLUMN capture_year smallint unsigned NULL AFTER capture_day`);
    await connection.query('CREATE INDEX idx_images_processed_capture_month_day ON images (processed, capture_month, capture_day, capture_date, created_at, id) INVISIBLE');
    await connection.query('CREATE INDEX idx_images_processed_capture_year ON images (processed, capture_year) INVISIBLE');
    await connection.query('ALTER TABLE images ALTER INDEX idx_images_processed_capture_date INVISIBLE');
    await connection.query('ALTER TABLE images ALTER INDEX idx_images_topic INVISIBLE');
}

async function verifyCaptureDateSemantics(connection) {
    const topic = '__schema_convergence_dates__';
    const prefix = '__schema_convergence_date_';
    await connection.beginTransaction();
    try {
        await connection.query(
            'INSERT INTO topics (slug, label, `order`, map_visible) VALUES (?, ?, 0, false)',
            [topic, 'Schema convergence dates'],
        );
        const dates = [
            ['2024-b', '2024-02-29 12:00:00', '2024-03-01 00:00:00'],
            ['2024-a', '2024-02-29 12:00:00', '2024-03-01 00:00:00'],
            ['2020', '2020-02-29 12:00:00', '2020-03-01 00:00:00'],
            ['2016', '2016-02-29 12:00:00', '2016-03-01 00:00:00'],
            ['2012', '2012-02-29 12:00:00', '2012-03-01 00:00:00'],
            ['2008', '2008-02-29 12:00:00', '2008-03-01 00:00:00'],
            ['2004', '2004-02-29 12:00:00', '2004-03-01 00:00:00'],
            ['max', '9999-12-31 23:59:59', '2024-03-01 00:00:00'],
            ['nonmatch', '2024-02-28 12:00:00', '2024-02-28 13:00:00'],
            ['null', null, '2024-02-28 13:00:00'],
        ];
        for (const [name, captureDate, createdAt] of dates) {
            await connection.query(
                `INSERT INTO images
                    (filename_original, filename_avif, filename_webp, filename_jpeg,
                     width, height, user_filename, topic, capture_date, created_at, updated_at, processed)
                 VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, true)`,
                [
                    `${prefix}${name}.original`, `${prefix}${name}.avif`,
                    `${prefix}${name}.webp`, `${prefix}${name}.jpg`,
                    `${prefix}${name}`, topic, captureDate, createdAt, createdAt,
                ],
            );
        }

        const [generated] = await connection.query(
            `SELECT user_filename, capture_year, capture_month, capture_day
             FROM images WHERE user_filename LIKE ? ORDER BY user_filename`,
            [`${prefix}%`],
        );
        const leap = generated.find((row) => row.user_filename === `${prefix}2020`);
        const maxDate = generated.find((row) => row.user_filename === `${prefix}max`);
        const nullDate = generated.find((row) => row.user_filename === `${prefix}null`);
        if (!leap || Number(leap.capture_year) !== 2020 || Number(leap.capture_month) !== 2 || Number(leap.capture_day) !== 29) {
            throw new Error('MySQL generated capture year/month/day values are incorrect for February 29.');
        }
        if (!nullDate || nullDate.capture_year !== null || nullDate.capture_month !== null || nullDate.capture_day !== null) {
            throw new Error('MySQL generated capture date keys must remain null for a null capture_date.');
        }
        if (!maxDate || Number(maxDate.capture_year) !== 9999 || Number(maxDate.capture_month) !== 12 || Number(maxDate.capture_day) !== 31) {
            throw new Error('MySQL generated capture date keys are incorrect at the DATETIME maximum year.');
        }

        const [maxYearRows] = await connection.query(
            `SELECT user_filename FROM images
             WHERE processed = true AND capture_date >= '9999-01-01 00:00:00'
               AND user_filename LIKE ?
             ORDER BY capture_date DESC, created_at DESC, id DESC`,
            [`${prefix}%`],
        );
        if (maxYearRows.length !== 1 || maxYearRows[0].user_filename !== `${prefix}max`) {
            throw new Error('Maximum-year archive query must not require an out-of-domain exclusive bound.');
        }

        const [yearRows] = await connection.query(
            `SELECT DISTINCT capture_year FROM images FORCE INDEX (idx_images_processed_capture_year)
             WHERE processed = true AND capture_year IS NOT NULL
             ORDER BY capture_year DESC`,
        );
        const years = yearRows.map((row) => Number(row.capture_year));
        if (!years.includes(9999) || !years.includes(2024) || years.some((year) => !Number.isFinite(year))) {
            throw new Error(`Timeline year discovery semantics mismatch: ${JSON.stringify(years)}.`);
        }

        const [yearExplainRows] = await connection.query(
            `EXPLAIN FORMAT=JSON SELECT DISTINCT capture_year
             FROM images FORCE INDEX (idx_images_processed_capture_year)
             WHERE processed = true AND capture_year IS NOT NULL
             ORDER BY capture_year DESC`,
        );
        const yearPlan = typeof yearExplainRows[0]?.EXPLAIN === 'string'
            ? yearExplainRows[0].EXPLAIN
            : JSON.stringify(yearExplainRows);
        if (!yearPlan.includes('idx_images_processed_capture_year')
            || !yearPlan.includes('capture_year')
            || !yearPlan.includes('"using_index": true')) {
            throw new Error(`Timeline year discovery is not covered by its generated-year index: ${yearPlan}.`);
        }

        const [matched] = await connection.query(
            `SELECT user_filename
             FROM images FORCE INDEX (idx_images_processed_capture_month_day)
             WHERE processed = true AND capture_date IS NOT NULL
               AND capture_month = 2 AND capture_day = 29
               AND user_filename LIKE ?
             ORDER BY capture_date DESC, created_at DESC, id DESC
             LIMIT 6`,
            [`${prefix}%`],
        );
        const names = matched.map((row) => row.user_filename);
        const expected = [
            `${prefix}2024-a`, `${prefix}2024-b`, `${prefix}2020`,
            `${prefix}2016`, `${prefix}2012`, `${prefix}2008`,
        ];
        if (JSON.stringify(names) !== JSON.stringify(expected)) {
            throw new Error(`On This Day MySQL semantics mismatch: ${JSON.stringify(names)}.`);
        }

        const [explainRows] = await connection.query(
            `EXPLAIN FORMAT=JSON SELECT id FROM images FORCE INDEX (idx_images_processed_capture_month_day)
             WHERE processed = true AND capture_month = 2 AND capture_day = 29`,
        );
        if (!JSON.stringify(explainRows).includes('idx_images_processed_capture_month_day')) {
            throw new Error('On This Day capture index is not usable by MySQL.');
        }
    } finally {
        await connection.rollback();
    }
}

async function main() {
    const fixture = latestMigrationFixture();
    const migrations = getAllJournalMigrations(migrationsFolder);
    const options = getMysqlConnectionOptions();
    assertDisposableDatabase(options);
    const connection = await mysql.createConnection(options);
    let currentSnapshot;
    try {
        currentSnapshot = await schemaSnapshot(connection, options.database);

        const pending = await downgradeToFixture(connection, fixture, migrations);
        await runMigrations(connection, migrationsFolder, migrations);
        await assertMigrationHashesRecorded(connection, pending);
        const upgradedSnapshot = await schemaSnapshot(connection, options.database);
        if (upgradedSnapshot !== currentSnapshot) {
            throw new Error('Real pending migration upgrade did not match the current bootstrap schema.');
        }

        await verifyCaptureDateSemantics(connection);
        await simulateDefinitionDrift(connection);
        await reconcileLegacySchema(connection, options.database);
        const recoveredSnapshot = await schemaSnapshot(connection, options.database);
        if (recoveredSnapshot !== currentSnapshot) {
            throw new Error('Legacy reconciliation did not recover malformed same-named schema definitions.');
        }

        await reconcileLegacySchema(connection, options.database);
        const secondSnapshot = await schemaSnapshot(connection, options.database);
        if (secondSnapshot !== recoveredSnapshot) {
            throw new Error('Legacy reconciliation is not idempotent on the current schema.');
        }
        console.log(`[Schema convergence] ${EXPECTED_LATEST_MIGRATION}: real upgrade, date semantics, definition recovery, and idempotence verified.`);
    } finally {
        if (currentSnapshot) {
            try {
                await reconcileLegacySchema(connection, options.database);
                await baselineAllJournalMigrations(connection, migrations);
            } catch (error) {
                console.error('[Schema convergence] Best-effort schema recovery failed:', error);
            }
        }
        await connection.end();
    }
}

main().catch((error) => {
    console.error('[Schema convergence] Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
