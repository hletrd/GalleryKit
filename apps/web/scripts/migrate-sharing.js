/* eslint-disable @typescript-eslint/no-require-imports */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../sqlite.db');
console.log('Opening DB at:', dbPath);
const db = new Database(dbPath);

function ensureColumn(sql, duplicateMessage) {
    try {
        db.prepare(sql).run();
    } catch (error) {
        if (!error.message?.includes('duplicate column name')) {
            throw error;
        }
        console.log(duplicateMessage);
    }
}

try {
    console.log('Checking if share_key column exists...');
    ensureColumn('ALTER TABLE images ADD COLUMN share_key text', 'ℹ️ share_key column already exists');
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_images_share_key ON images(share_key)').run();
    console.log('✅ Verified share_key column + unique index');

    console.log('Creating shared_groups table...');
    db.prepare(`
        CREATE TABLE IF NOT EXISTS shared_groups (
            id integer PRIMARY KEY AUTOINCREMENT,
            key text NOT NULL UNIQUE,
            view_count integer DEFAULT 0 NOT NULL,
            expires_at text,
            created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
    `).run();
    ensureColumn('ALTER TABLE shared_groups ADD COLUMN view_count integer DEFAULT 0 NOT NULL', 'ℹ️ shared_groups.view_count already exists');
    ensureColumn('ALTER TABLE shared_groups ADD COLUMN expires_at text', 'ℹ️ shared_groups.expires_at already exists');
    console.log('✅ Created/updated shared_groups table');

    console.log('Creating shared_group_images table...');
    db.prepare(`
        CREATE TABLE IF NOT EXISTS shared_group_images (
            group_id integer NOT NULL REFERENCES shared_groups(id) ON DELETE CASCADE,
            image_id integer NOT NULL REFERENCES images(id) ON DELETE CASCADE,
            position integer DEFAULT 0 NOT NULL
        )
    `).run();
    ensureColumn('ALTER TABLE shared_group_images ADD COLUMN position integer DEFAULT 0 NOT NULL', 'ℹ️ shared_group_images.position already exists');
    db.prepare(`
        UPDATE shared_group_images AS current
        SET position = (
            SELECT COUNT(*) - 1
            FROM shared_group_images AS earlier
            WHERE earlier.group_id = current.group_id
              AND earlier.rowid <= current.rowid
        )
        WHERE position = 0
    `).run();
    console.log('✅ Created/updated shared_group_images table');
} catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
} finally {
    db.close();
}
