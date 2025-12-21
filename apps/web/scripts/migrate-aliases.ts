
import { db } from '../src/db';
import { connection } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Migrating topic aliases...');

    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS topic_aliases (
                alias varchar(255) PRIMARY KEY,
                topic_slug varchar(255) NOT NULL,
                FOREIGN KEY (topic_slug) REFERENCES topics(slug) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('Created topic_aliases table.');
    } catch (e) {
        console.error('Migration failed:', e);
    }

    process.exit(0);
}

main();
