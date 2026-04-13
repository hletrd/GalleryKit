/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const sqlitePath = process.env.DB_FILE_NAME || 'sqlite.db';
const sqlite = new Database(sqlitePath);

function getRequiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const connectionString = process.env.DATABASE_URL || `mysql://${getRequiredEnv('DB_USER')}:${getRequiredEnv('DB_PASSWORD')}@${getRequiredEnv('DB_HOST')}:${getRequiredEnv('DB_PORT')}/${getRequiredEnv('DB_NAME')}`;

function formatMysqlTarget() {
    if (process.env.DATABASE_URL) {
        try {
            const target = new URL(process.env.DATABASE_URL);
            return `${target.protocol}//${target.hostname}:${target.port || '3306'}${target.pathname}`;
        } catch {
            return '[invalid DATABASE_URL]';
        }
    }

    return `mysql://${getRequiredEnv('DB_HOST')}:${getRequiredEnv('DB_PORT')}/${getRequiredEnv('DB_NAME')}`;
}

async function migrate() {
    console.log(`Reading from SQLite: ${sqlitePath}`);
    console.log(`Writing to MySQL: ${formatMysqlTarget()}`);

    const mysqlConn = await mysql.createConnection(connectionString);

    console.log('Truncating all MySQL tables...');
    await mysqlConn.query('SET FOREIGN_KEY_CHECKS=0');
    const tables = [
        'image_tags',
        'shared_group_images',
        'images',
        'topics',
        'tags',
        'shared_groups',
        'admin_settings',
    ];
    for (const table of tables) {
        await mysqlConn.query(`TRUNCATE TABLE \`${table}\``);
    }
    console.log('Truncation complete.');

    try {
        console.log('Migrating Topics...');
        const topics = sqlite.prepare('SELECT * FROM topics').all() as any[];
        for (const topic of topics) {
            await mysqlConn.execute(
                'INSERT INTO topics (slug, label, `order`, image_filename) VALUES (?, ?, ?, ?)',
                [topic.slug, topic.label, topic.order, topic.image_filename]
            );
        }
        console.log(`Migrated ${topics.length} topics.`);

        console.log('Migrating Images...');
        const images = sqlite.prepare('SELECT * FROM images').all() as any[];
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
                    img.color_space ?? null, img.created_at ?? null, img.updated_at ?? null, img.processed ?? null,
                ]
            );
        }
        console.log(`Migrated ${images.length} images.`);

        console.log('Migrating Tags...');
        const tags = sqlite.prepare('SELECT * FROM tags').all() as any[];
        for (const tag of tags) {
            await mysqlConn.execute(
                'INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)',
                [tag.id, tag.name, tag.slug]
            );
        }
        console.log(`Migrated ${tags.length} tags.`);

        console.log('Migrating ImageTags...');
        const imageTags = sqlite.prepare('SELECT * FROM image_tags').all() as any[];
        for (const imageTag of imageTags) {
            await mysqlConn.execute(
                'INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)',
                [imageTag.image_id, imageTag.tag_id]
            );
        }
        console.log(`Migrated ${imageTags.length} image_tags.`);

        console.log('Migrating SharedGroups...');
        const sharedGroups = sqlite.prepare('SELECT * FROM shared_groups').all() as any[];
        for (const sharedGroup of sharedGroups) {
            await mysqlConn.execute(
                'INSERT INTO shared_groups (id, `key`, view_count, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
                [
                    sharedGroup.id,
                    sharedGroup.key,
                    sharedGroup.view_count ?? 0,
                    sharedGroup.expires_at ?? null,
                    sharedGroup.created_at,
                ]
            );
        }
        console.log(`Migrated ${sharedGroups.length} shared_groups.`);

        console.log('Migrating SharedGroupImages...');
        const sharedGroupImages = sqlite.prepare('SELECT * FROM shared_group_images ORDER BY group_id, rowid').all() as any[];
        const nextPositionByGroup = new Map<number, number>();
        for (const sharedGroupImage of sharedGroupImages) {
            const fallbackPosition = nextPositionByGroup.get(sharedGroupImage.group_id) ?? 0;
            const position = sharedGroupImage.position ?? fallbackPosition;
            nextPositionByGroup.set(sharedGroupImage.group_id, position + 1);

            await mysqlConn.execute(
                'INSERT INTO shared_group_images (group_id, image_id, position) VALUES (?, ?, ?)',
                [sharedGroupImage.group_id, sharedGroupImage.image_id, position]
            );
        }
        console.log(`Migrated ${sharedGroupImages.length} shared_group_images.`);

        console.log('Migrating AdminSettings...');
        const adminSettings = sqlite.prepare('SELECT * FROM admin_settings').all() as any[];
        for (const setting of adminSettings) {
            await mysqlConn.execute(
                'INSERT INTO admin_settings (`key`, value) VALUES (?, ?)',
                [setting.key, setting.value]
            );
        }
        console.log(`Migrated ${adminSettings.length} admin_settings.`);

        console.log('Migration complete!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        await mysqlConn.query('SET FOREIGN_KEY_CHECKS=1');
        await mysqlConn.end();
        sqlite.close();
    }
}

migrate().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
