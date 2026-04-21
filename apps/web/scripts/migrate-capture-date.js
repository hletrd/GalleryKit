#!/usr/bin/env node
/**
 * Migration: capture_date VARCHAR(255) → DATETIME
 *
 * Converts ISO-8601 strings (e.g. "2024-03-15T10:30:00.000Z") stored in
 * the varchar column to proper MySQL DATETIME values. This enables:
 * - Correct date-based sorting via index (not lexicographic string sort)
 * - Range queries (BETWEEN, DATE(), YEAR(), etc.)
 * - Smaller storage footprint (8 bytes vs up to 255 bytes)
 *
 * Run manually: node scripts/migrate-capture-date.js
 * Requires DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME env vars.
 *
 * Safe to run multiple times — checks column type before modifying.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { getMysqlConnectionOptions } = require('./mysql-connection-options');

dotenv.config({ path: '.env.local' });

async function migrate() {
    const connection = await mysql.createConnection(getMysqlConnectionOptions());

    try {
        // Check current column type
        const [columns] = await connection.query(
            `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'images' AND COLUMN_NAME = 'capture_date'`,
            [process.env.DB_NAME]
        );

        if (columns.length === 0) {
            console.log('[Migration] capture_date column not found. Skipping.');
            return;
        }

        const currentType = columns[0].DATA_TYPE.toLowerCase();
        if (currentType === 'datetime') {
            console.log('[Migration] capture_date is already DATETIME. Nothing to do.');
            return;
        }

        console.log(`[Migration] capture_date is currently ${currentType.toUpperCase()}. Converting to DATETIME...`);

        // Count rows with data
        const [countResult] = await connection.query('SELECT COUNT(*) as total, COUNT(capture_date) as withDate FROM images');
        console.log(`[Migration] ${countResult[0].total} total images, ${countResult[0].withDate} with capture_date.`);

        // Step 1: Convert ISO-8601 strings to MySQL DATETIME format in-place
        // ISO-8601: "2024-03-15T10:30:00.000Z" → "2024-03-15 10:30:00"
        // Strip milliseconds (.000Z) and replace T with space
        const [updateResult] = await connection.query(`
            UPDATE images
            SET capture_date = REPLACE(SUBSTRING_INDEX(capture_date, '.', 1), 'T', ' ')
            WHERE capture_date IS NOT NULL
              AND capture_date LIKE '%T%'
        `);
        console.log(`[Migration] Converted ${updateResult.affectedRows} date strings to DATETIME format.`);

        // Step 2: ALTER column type
        await connection.query('ALTER TABLE images MODIFY COLUMN capture_date DATETIME');
        console.log('[Migration] Column type changed to DATETIME.');

        // Step 3: Verify
        const [verify] = await connection.query(
            `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'images' AND COLUMN_NAME = 'capture_date'`,
            [process.env.DB_NAME]
        );
        console.log(`[Migration] Verified: capture_date is now ${verify[0].DATA_TYPE.toUpperCase()}.`);
        console.log('[Migration] Done. The composite indexes on (processed, capture_date, created_at) will automatically benefit from the type change.');

    } finally {
        await connection.end();
    }
}

migrate().catch(err => {
    console.error('[Migration] Failed:', err);
    process.exit(1);
});
