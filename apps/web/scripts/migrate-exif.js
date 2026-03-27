/* eslint-disable @typescript-eslint/no-require-imports */
const Database = require('better-sqlite3');
const db = new Database('sqlite.db');

try {
  console.log('Adding latitude column...');
  db.prepare('ALTER TABLE images ADD COLUMN latitude REAL').run();
  console.log('Adding longitude column...');
  db.prepare('ALTER TABLE images ADD COLUMN longitude REAL').run();
  console.log('Migration successful.');
} catch (e) {
  if (e.message.includes('duplicate column name')) {
    console.log('Columns already exist.');
  } else {
    console.error('Migration failed:', e);
    process.exit(1);
  }
}
