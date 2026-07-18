import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const { getMysqlConnectionOptions } = require('./mysql-connection-options.js');
const { reconcileLegacySchema } = require('./migrate.js');

export const EXPECTED_LATEST_MIGRATION = '0032_capture_date_indexes';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const SAFE_DATABASE_NAME = /(^|[_-])(test|ci|e2e)([_-]|$)/i;
const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

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

function assertLatestMigrationTag() {
    const journal = JSON.parse(readFileSync(path.join(appRoot, 'drizzle', 'meta', '_journal.json'), 'utf8'));
    const latest = journal.entries.at(-1)?.tag;
    if (latest !== EXPECTED_LATEST_MIGRATION) {
        throw new Error(
            `Schema convergence probe is stale: expected latest ${EXPECTED_LATEST_MIGRATION}, journal latest is ${latest ?? 'missing'}.`,
        );
    }
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

async function simulateLegacyDrift(connection) {
    await connection.query('DROP INDEX idx_images_processed_capture_month_day ON images');
    await connection.query('ALTER TABLE images DROP COLUMN capture_day, DROP COLUMN capture_month');
    await connection.query('DROP INDEX idx_images_processed_capture_date ON images');
    await connection.query('CREATE INDEX idx_images_processed_capture_date ON images (processed, capture_date, created_at)');
    await connection.query('DROP INDEX idx_images_topic ON images');
    await connection.query('CREATE INDEX idx_images_topic ON images (topic, processed, capture_date, created_at)');
}

async function main() {
    assertLatestMigrationTag();
    const options = getMysqlConnectionOptions();
    assertDisposableDatabase(options);
    const connection = await mysql.createConnection(options);
    let currentSnapshot;
    try {
        currentSnapshot = await schemaSnapshot(connection, options.database);
        await simulateLegacyDrift(connection);
        await reconcileLegacySchema(connection, options.database);
        const recoveredSnapshot = await schemaSnapshot(connection, options.database);
        if (recoveredSnapshot !== currentSnapshot) {
            throw new Error('Legacy reconciliation did not recover the exact current schema snapshot.');
        }

        await reconcileLegacySchema(connection, options.database);
        const secondSnapshot = await schemaSnapshot(connection, options.database);
        if (secondSnapshot !== recoveredSnapshot) {
            throw new Error('Legacy reconciliation is not idempotent on the current schema.');
        }
        console.log(`[Schema convergence] ${EXPECTED_LATEST_MIGRATION}: recovery and second-run idempotence verified.`);
    } finally {
        if (currentSnapshot) {
            try {
                await reconcileLegacySchema(connection, options.database);
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
