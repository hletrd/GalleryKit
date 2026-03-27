
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import path from 'path';
import mysql from 'mysql2/promise';

// Load env vars
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function run() {
    console.log('🔄 initializing database...');

    // 1. Try running drizzle-kit push
    try {
        console.log('Running drizzle-kit push...');
        execSync('npx drizzle-kit push', { stdio: 'inherit' });
    } catch {
        console.warn('⚠️  drizzle-kit push encountered an error (likely safe if verifying existing schema). Continuing to verification...');
    }

    // 2. Verified critical tables exist manually
    // This safeguards against db:push crashing midway on first run or migrations
    console.log('🛡️  Verifying critical table schemas...');

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        // admin_users
        await connection.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`username\` varchar(255) NOT NULL,
                \`password_hash\` varchar(255) NOT NULL,
                \`created_at\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`admin_users_username_unique\` (\`username\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // sessions
        await connection.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                \`id\` varchar(255) NOT NULL,
                \`user_id\` int NOT NULL,
                \`expires_at\` timestamp NOT NULL,
                PRIMARY KEY (\`id\`),
                KEY \`sessions_user_id_idx\` (\`user_id\`),
                CONSTRAINT \`sessions_user_id_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        console.log('✅ Critical tables verified (tables).');

        // images (Essential for app start)
         await connection.query(`
            CREATE TABLE IF NOT EXISTS images (
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`filename_original\` varchar(255) NOT NULL,
                \`filename_avif\` varchar(255) NOT NULL,
                \`filename_webp\` varchar(255) NOT NULL,
                \`filename_jpeg\` varchar(255) NOT NULL,
                \`width\` int NOT NULL,
                \`height\` int NOT NULL,
                \`original_width\` int DEFAULT NULL,
                \`original_height\` int DEFAULT NULL,
                \`title\` varchar(255) DEFAULT NULL,
                \`description\` text,
                \`user_filename\` varchar(255) DEFAULT NULL,
                \`share_key\` varchar(255) DEFAULT NULL,
                \`topic\` varchar(255) NOT NULL,
                \`capture_date\` varchar(255) DEFAULT NULL,
                \`camera_model\` varchar(255) DEFAULT NULL,
                \`lens_model\` varchar(255) DEFAULT NULL,
                \`iso\` int DEFAULT NULL,
                \`f_number\` float DEFAULT NULL,
                \`exposure_time\` varchar(255) DEFAULT NULL,
                \`focal_length\` float DEFAULT NULL,
                \`latitude\` float DEFAULT NULL,
                \`longitude\` float DEFAULT NULL,
                \`color_space\` varchar(255) DEFAULT NULL,
                \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                \`processed\` boolean DEFAULT true,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`images_share_key_unique\` (\`share_key\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // topic_aliases
        await connection.query(`
            CREATE TABLE IF NOT EXISTS topic_aliases (
                alias varchar(255) PRIMARY KEY,
                topic_slug varchar(255) NOT NULL,
                FOREIGN KEY (topic_slug) REFERENCES topics(slug) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Check for missing user_filename column in existing images table
        try {
            const [columns] = await connection.query(`SHOW COLUMNS FROM images LIKE 'user_filename'`);
            // @ts-expect-error -- mysql2 query returns unknown tuple
            if (Array.isArray(columns) && columns.length === 0) {
                 console.log('[Migration] Adding missing column user_filename to images...');
                 await connection.query(`ALTER TABLE images ADD COLUMN \`user_filename\` varchar(255) DEFAULT NULL;`);
            }
        } catch (e) {
             console.warn('[Migration] Failed to check/add user_filename column', e);
        }

        console.log('✅ Critical tables verified (columns).');

    } catch (e) {
        console.error('❌ Failed to verify schemas:', e);
        process.exit(1);
    } finally {
        await connection.end();
    }

    // 3. Run Seed
    try {
        console.log('🌱 Seeding admin...');
        execSync('npx tsx scripts/seed-admin.ts', { stdio: 'inherit' });
        console.log('✅ Initialization complete.');
    } catch (e) {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    }
}

run();
