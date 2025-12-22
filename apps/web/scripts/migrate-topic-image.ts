
import Database from 'better-sqlite3';

const sqlite = new Database('sqlite.db');

try {
    console.log('Adding image_filename column to topics table...');
    sqlite.prepare('ALTER TABLE topics ADD COLUMN image_filename text').run();
    console.log('Migration successful');
} catch (error) {
    if (error.message.includes('duplicate column name')) {
        console.log('Column image_filename already exists');
    } else {
        console.error('Migration failed:', error);
    }
}
