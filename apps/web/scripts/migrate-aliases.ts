
import path from 'path';
import dotenv from 'dotenv';


// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    // Dynamic import to ensure env vars are loaded before DB connection is initialized
    const { connection } = await import('../src/db');

    console.log('Migrating topic aliases...');

    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS topic_aliases (
                alias varchar(255) PRIMARY KEY,
                topic_slug varchar(255) NOT NULL,
                FOREIGN KEY (topic_slug) REFERENCES topics(slug) ON DELETE CASCADE
            );
        `);
        console.log('Created topic_aliases table.');
    } catch (e) {
        console.error('Migration failed:', e);
    }

    process.exit(0);
}

main();
