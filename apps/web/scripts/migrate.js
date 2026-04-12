/* eslint-disable @typescript-eslint/no-require-imports */
const { drizzle } = require('drizzle-orm/mysql2');
const { migrate } = require('drizzle-orm/mysql2/migrator');
const mysql = require('mysql2/promise');
const path = require('path');

// Database connection
const connectionString = `mysql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

if (!connectionString) {
    console.error('[Migration] Error: DATABASE_URL is not set.');
    process.exit(1);
}

console.log(`[Migration] Starting migration...`);

(async () => {
    try {
        const connection = await mysql.createConnection(connectionString);

        // 1. Run Drizzle Migrations (if any exist)
        try {
            const db = drizzle(connection);
            const migrationsFolder = path.join(process.cwd(), 'apps', 'web', 'drizzle');
            // Check if folder exists before migrating
            const fs = require('fs');
            if (fs.existsSync(migrationsFolder)) {
                 console.log(`[Migration] Reading migrations from: ${migrationsFolder}`);
                 await migrate(db, { migrationsFolder });
            } else {
                 console.log('[Migration] No migrations folder found, skipping drizzle migration.');
            }
        } catch (e) {
            console.warn('[Migration] Warning: Drizzle migration failed (safe if manual checks pass)', e);
        }

        // 2. Manual Verification of Critical Tables (Robust Fallback)
        console.log('[Migration] Verifying critical tables...');

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

        // admin_settings
        await connection.query(`
             CREATE TABLE IF NOT EXISTS admin_settings (
                \`key\` varchar(255) NOT NULL,
                \`value\` text NOT NULL,
                PRIMARY KEY (\`key\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Check for missing user_filename column in existing images table
        // This handles upgrade path if table was created before the column was added
        try {
            const [columns] = await connection.query(`SHOW COLUMNS FROM images LIKE 'user_filename'`);
            if (columns.length === 0) {
                 console.log('[Migration] Adding missing column user_filename to images...');
                 await connection.query(`ALTER TABLE images ADD COLUMN \`user_filename\` varchar(255) DEFAULT NULL;`);
            }
        } catch (e) {
             console.warn('[Migration] Failed to check/add user_filename column', e);
        }


        console.log('[Migration] Critical tables verified.');

        // 3. Seeding Admin User
        const argon2 = require('argon2');
        console.log('[Migration] Checking admin user...');

        const [rows] = await connection.query('SELECT id FROM admin_users WHERE username = ?', ['admin']);

        if (rows.length === 0) {
            console.log('[Migration] Seeding default admin user...');
            const crypto = require('crypto');
            let password = process.env.ADMIN_PASSWORD;
            if (!password || password.length < 12) {
                password = crypto.randomBytes(16).toString('base64url');
                // Write password to a restricted temp file instead of stdout/Docker logs
                const tempPwdPath = '/tmp/admin-password.txt';
                require('fs').writeFileSync(tempPwdPath, password, { mode: 0o600 });
                console.log(`[Migration] Generated random admin password. Saved to ${tempPwdPath}`);
                console.log(`[Migration] Retrieve: docker exec <container> cat ${tempPwdPath}`);
                console.log(`[Migration] Delete after saving: docker exec <container> rm ${tempPwdPath}`);
            }
            const hash = await argon2.hash(password, { type: argon2.argon2id });

            await connection.query('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
            console.log('[Migration] Admin user created.');
        } else {
            console.log('[Migration] Admin user already exists.');
        }

        await connection.end();
        console.log('[Migration] Complete.');
    } catch (error) {
        console.error('[Migration] Failed:', error);
        // Don't exit process, let the app try to start?
        // No, if DB is bad, app will fail.
        process.exit(1);
    }
})();
