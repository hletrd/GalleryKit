/* eslint-disable @typescript-eslint/no-explicit-any */
import { Database } from 'bun:sqlite';

const db = new Database('sqlite.db');

try {
    console.log("Checking if share_key column exists...");
    try {
        db.run("ALTER TABLE images ADD COLUMN share_key text UNIQUE");
        console.log("✅ Added share_key column to images table");
    } catch (e: any) {
        if (e.message.includes("duplicate column name")) {
            console.log("ℹ️ share_key column already exists");
        } else {
            console.error("❌ Failed to add share_key column:", e);
        }
    }

    console.log("Creating shared_groups table...");
    db.run(`
        CREATE TABLE IF NOT EXISTS shared_groups (
            id integer PRIMARY KEY AUTOINCREMENT,
            key text NOT NULL UNIQUE,
            created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
    `);
    console.log("✅ Created shared_groups table");

    console.log("Creating shared_group_images table...");
    db.run(`
        CREATE TABLE IF NOT EXISTS shared_group_images (
            group_id integer NOT NULL REFERENCES shared_groups(id) ON DELETE CASCADE,
            image_id integer NOT NULL REFERENCES images(id) ON DELETE CASCADE
        )
    `);
    console.log("✅ Created shared_group_images table");

} catch (error) {
    console.error("Migration failed:", error);
}

db.close();
