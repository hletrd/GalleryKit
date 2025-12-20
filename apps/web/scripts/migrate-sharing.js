const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../sqlite.db');
console.log("Opening DB at:", dbPath);
const db = new Database(dbPath);

try {
    console.log("Checking if share_key column exists...");
    try {
        // Step 1: Add column without UNIQUE constraint
        db.prepare("ALTER TABLE images ADD COLUMN share_key text").run();
        console.log("✅ Added share_key column to images table");

        // Step 2: Create UNIQUE index
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_images_share_key ON images(share_key)").run();
        console.log("✅ Created unique index for share_key");

    } catch (e) {
        if (e.message && e.message.includes("duplicate column name")) {
            console.log("ℹ️ share_key column already exists");
            // Ensure index exists
            try {
                db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_images_share_key ON images(share_key)").run();
                console.log("✅ Verified unique index for share_key");
            } catch (idxError) {
                console.error("❌ Failed to create index:", idxError);
            }
        } else {
            console.error("❌ Failed to add share_key column:", e);
        }
    }

    console.log("Creating shared_groups table...");
    db.prepare(`
        CREATE TABLE IF NOT EXISTS shared_groups (
            id integer PRIMARY KEY AUTOINCREMENT,
            key text NOT NULL UNIQUE,
            created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
    `).run();
    console.log("✅ Created shared_groups table");

    console.log("Creating shared_group_images table...");
    db.prepare(`
        CREATE TABLE IF NOT EXISTS shared_group_images (
            group_id integer NOT NULL REFERENCES shared_groups(id) ON DELETE CASCADE,
            image_id integer NOT NULL REFERENCES images(id) ON DELETE CASCADE
        )
    `).run();
    console.log("✅ Created shared_group_images table");

} catch (error) {
    console.error("Migration failed:", error);
}

db.close();
