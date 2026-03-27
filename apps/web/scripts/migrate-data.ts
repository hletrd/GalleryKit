/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';


dotenv.config({ path: '.env.local' });

// SQLite connection
const sqlitePath = process.env.DB_FILE_NAME || 'sqlite.db';
const sqlite = new Database(sqlitePath);

// MySQL connection
// Parse connection string or use variables.
// Assuming DATABASE_URL format: mysql://user:pass@host:port/db
const connectionString = process.env.DATABASE_URL || `mysql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
if (!connectionString) {
    console.error("DATABASE_URL is not defined");
    process.exit(1);
}

async function migrate() {
    console.log(`Reading from SQLite: ${sqlitePath}`);
    console.log(`Writing to MySQL: ${connectionString}`);

    const mysqlConn = await mysql.createConnection(connectionString!);

    // Explicitly truncate all tables first
    console.log("Truncating all MySQL tables...");
    await mysqlConn.query("SET FOREIGN_KEY_CHECKS=0");
    const tables = [
        'image_tags',
        'shared_group_images',
        'images',
        'topics',
        'tags',
        'shared_groups',
        'admin_settings'
    ];
    for (const table of tables) {
        await mysqlConn.query(`TRUNCATE TABLE \`${table}\``);
    }
    console.log("Truncation complete.");

    try {
        // 1. Topics
        console.log("Migrating Topics...");
        const topics = sqlite.prepare("SELECT * FROM topics").all() as any[];
        for (const topic of topics) {
            await mysqlConn.execute(
                "INSERT INTO topics (slug, label, `order`, image_filename) VALUES (?, ?, ?, ?)",
                [topic.slug, topic.label, topic.order, topic.image_filename]
            );
        }
        console.log(`Migrated ${topics.length} topics.`);

        // 2. Images
        console.log("Migrating Images...");
        const images = sqlite.prepare("SELECT * FROM images").all() as any[];
        for (const img of images) {
            await mysqlConn.execute(
                `INSERT INTO images (
                    id, filename_original, filename_avif, filename_webp, filename_jpeg,
                    width, height, original_width, original_height, title, description,
                    share_key, topic, capture_date, camera_model, lens_model, iso,
                    f_number, exposure_time, focal_length, latitude, longitude,
                    color_space, created_at, updated_at, processed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    img.id ?? null, img.filename_original ?? null, img.filename_avif ?? null, img.filename_webp ?? null, img.filename_jpeg ?? null,
                    img.width ?? null, img.height ?? null, img.original_width ?? null, img.original_height ?? null, img.title ?? null, img.description ?? null,
                    img.share_key ?? null, img.topic ?? null, img.capture_date ?? null, img.camera_model ?? null, img.lens_model ?? null, img.iso ?? null,
                    img.f_number ?? null, img.exposure_time ?? null, img.focal_length ?? null, img.latitude ?? null, img.longitude ?? null,
                    img.color_space ?? null, img.created_at ?? null, img.updated_at ?? null, img.processed ?? null
                ]
            );
        }
        console.log(`Migrated ${images.length} images.`);

        // 3. Tags
        console.log("Migrating Tags...");
        const tags = sqlite.prepare("SELECT * FROM tags").all() as any[];
        for (const tag of tags) {
            await mysqlConn.execute(
                "INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)",
                [tag.id, tag.name, tag.slug]
            );
        }
        console.log(`Migrated ${tags.length} tags.`);

        // 4. ImageTags
        console.log("Migrating ImageTags...");
        const imageTags = sqlite.prepare("SELECT * FROM image_tags").all() as any[];
        for (const it of imageTags) {
            await mysqlConn.execute(
                "INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)",
                [it.image_id, it.tag_id]
            );
        }
        console.log(`Migrated ${imageTags.length} image_tags.`);

        // 5. SharedGroups
        console.log("Migrating SharedGroups...");
        const sharedGroups = sqlite.prepare("SELECT * FROM shared_groups").all() as any[];
        for (const sg of sharedGroups) {
            await mysqlConn.execute(
                "INSERT INTO shared_groups (id, `key`, created_at) VALUES (?, ?, ?)",
                [sg.id, sg.key, sg.created_at]
            );
        }
        console.log(`Migrated ${sharedGroups.length} shared_groups.`);

        // 6. SharedGroupImages
        console.log("Migrating SharedGroupImages...");
        const sharedGroupImages = sqlite.prepare("SELECT * FROM shared_group_images").all() as any[];
        for (const sgi of sharedGroupImages) {
            await mysqlConn.execute(
                "INSERT INTO shared_group_images (group_id, image_id) VALUES (?, ?)",
                [sgi.group_id, sgi.image_id]
            );
        }
        console.log(`Migrated ${sharedGroupImages.length} shared_group_images.`);

        // 7. AdminSettings
        console.log("Migrating AdminSettings...");
        const adminSettings = sqlite.prepare("SELECT * FROM admin_settings").all() as any[];
        for (const setting of adminSettings) {
            await mysqlConn.execute(
                "INSERT INTO admin_settings (`key`, value) VALUES (?, ?)",
                [setting.key, setting.value]
            );
        }
        console.log(`Migrated ${adminSettings.length} admin_settings.`);

        console.log("Migration complete!");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await mysqlConn.query("SET FOREIGN_KEY_CHECKS=1");
        await mysqlConn.end();
        sqlite.close();
    }
}

migrate();
