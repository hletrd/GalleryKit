/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const mysql = require('mysql2/promise');
const { drizzle } = require('drizzle-orm/mysql2');
const { migrate } = require('drizzle-orm/mysql2/migrator');
const { getMysqlConnectionOptions } = require('./mysql-connection-options');

const WEAK_PLAINTEXT_PASSWORDS = new Set([
    'password',
    'admin',
    'changeme',
    'gallerykit',
    '12345678',
    '123456789',
    'qwerty123',
]);

function resolveAppRoot() {
    const candidates = [
        process.cwd(),
        path.join(process.cwd(), 'apps', 'web'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'drizzle'))) {
            return candidate;
        }
    }

    throw new Error(`Unable to locate app root from ${process.cwd()}`);
}

function resolveUploadRoots(appRoot) {
    const publicRoot = path.join(appRoot, 'public', 'uploads');
    const privateOriginalRoot = process.env.UPLOAD_ORIGINAL_ROOT
        ? path.resolve(process.env.UPLOAD_ORIGINAL_ROOT)
        : path.join(appRoot, 'data', 'uploads', 'original');

    return {
        legacyOriginalRoot: path.join(publicRoot, 'original'),
        privateOriginalRoot,
    };
}

function migrateLegacyOriginalUploads(appRoot) {
    const { legacyOriginalRoot, privateOriginalRoot } = resolveUploadRoots(appRoot);
    if (legacyOriginalRoot === privateOriginalRoot || !fs.existsSync(legacyOriginalRoot)) {
        return;
    }

    fs.mkdirSync(privateOriginalRoot, { recursive: true });
    const entries = fs.readdirSync(legacyOriginalRoot, { withFileTypes: true });
    let moved = 0;

    for (const entry of entries) {
        if (!entry.isFile()) continue;

        const source = path.join(legacyOriginalRoot, entry.name);
        const target = path.join(privateOriginalRoot, entry.name);

        if (fs.existsSync(target)) {
            fs.unlinkSync(source);
            continue;
        }

        try {
            fs.renameSync(source, target);
        } catch (error) {
            if (error && typeof error === 'object' && error.code === 'EXDEV') {
                fs.copyFileSync(source, target);
                fs.unlinkSync(source);
            } else {
                throw error;
            }
        }
        moved++;
    }

    if (moved > 0) {
        console.log(`[Migration] Moved ${moved} legacy original upload(s) out of the public web root.`);
    }
}

function assertLegacyOriginalUploadsCleared(appRoot) {
    if (process.env.NODE_ENV !== 'production') {
        return;
    }

    const { legacyOriginalRoot } = resolveUploadRoots(appRoot);
    if (!fs.existsSync(legacyOriginalRoot)) {
        return;
    }

    const remainingFiles = fs.readdirSync(legacyOriginalRoot, { withFileTypes: true }).filter((entry) => entry.isFile());
    if (remainingFiles.length > 0) {
        throw new Error(`Refusing to start with ${remainingFiles.length} original upload(s) still under the public web root (${legacyOriginalRoot}).`);
    }
}

function getRequiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function assertStrongBootstrapPassword(secret) {
    if (secret.startsWith('$argon2')) return;

    const normalized = secret.trim();
    if (normalized.length < 16 || WEAK_PLAINTEXT_PASSWORDS.has(normalized.toLowerCase())) {
        throw new Error('ADMIN_PASSWORD plaintext must be a strong 16+ character secret or an Argon2 hash.');
    }
}

function formatError(error) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }

    if (error && typeof error === 'object') {
        return Object.fromEntries(
            Object.entries(error).filter(([key]) => ['code', 'errno', 'sqlState', 'message'].includes(key))
        );
    }

    return { message: String(error) };
}

function getLatestMigration(migrationsFolder) {
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    const latestEntry = journal.entries[journal.entries.length - 1];
    if (!latestEntry) {
        throw new Error(`No migration entries found in ${journalPath}`);
    }

    const migrationPath = path.join(migrationsFolder, `${latestEntry.tag}.sql`);
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    return {
        tag: latestEntry.tag,
        folderMillis: latestEntry.when,
        hash: crypto.createHash('sha256').update(migrationSql).digest('hex'),
    };
}

async function queryOne(connection, sql, params) {
    const [rows] = await connection.query(sql, params);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function columnInfo(connection, dbName, tableName, columnName) {
    return queryOne(
        connection,
        `SELECT DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [dbName, tableName, columnName]
    );
}

async function indexExists(connection, dbName, tableName, indexName) {
    return Boolean(await queryOne(
        connection,
        `SELECT 1
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [dbName, tableName, indexName]
    ));
}

async function foreignKeyExists(connection, dbName, tableName, constraintName) {
    return Boolean(await queryOne(
        connection,
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [dbName, tableName, constraintName]
    ));
}

async function ensureTable(connection, sql) {
    await connection.query(sql);
}

async function ensureColumn(connection, dbName, tableName, columnName, addSql) {
    const existing = await columnInfo(connection, dbName, tableName, columnName);
    if (!existing) {
        await connection.query(addSql);
        return true;
    }
    return false;
}

async function ensureIndex(connection, dbName, tableName, indexName, createSql) {
    if (!(await indexExists(connection, dbName, tableName, indexName))) {
        await connection.query(createSql);
        return true;
    }
    return false;
}

async function ensureForeignKey(connection, dbName, tableName, constraintName, createSql) {
    if (!(await foreignKeyExists(connection, dbName, tableName, constraintName))) {
        await connection.query(createSql);
        return true;
    }
    return false;
}

async function ensureMigrationTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
            id serial PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )
    `);
}

async function getLatestRecordedMigration(connection) {
    return queryOne(
        connection,
        'SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1'
    );
}

async function hasAnyGalleryTables(connection, dbName) {
    return Boolean(await queryOne(
        connection,
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('topics', 'images', 'admin_settings', 'shared_groups')
         LIMIT 1`,
        [dbName]
    ));
}

async function reconcileLegacySchema(connection, dbName) {
    console.log('[Migration] Reconciling legacy schema before baselining migrations...');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS topics (
            slug varchar(255) NOT NULL,
            label varchar(255) NOT NULL,
            \`order\` int DEFAULT 0,
            image_filename varchar(255),
            PRIMARY KEY (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS tags (
            id int NOT NULL AUTO_INCREMENT,
            name varchar(255) NOT NULL,
            slug varchar(255) NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY tags_name_unique (name),
            UNIQUE KEY tags_slug_unique (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS admin_settings (
            \`key\` varchar(255) NOT NULL,
            value text NOT NULL,
            PRIMARY KEY (\`key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS admin_users (
            id int NOT NULL AUTO_INCREMENT,
            username varchar(255) NOT NULL,
            password_hash varchar(512) NOT NULL,
            created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY admin_users_username_unique (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const passwordHashInfo = await columnInfo(connection, dbName, 'admin_users', 'password_hash');
    if (passwordHashInfo && Number(passwordHashInfo.CHARACTER_MAXIMUM_LENGTH || 0) < 512) {
        await connection.query('ALTER TABLE admin_users MODIFY COLUMN password_hash varchar(512) NOT NULL');
    }

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS images (
            id int NOT NULL AUTO_INCREMENT,
            filename_original varchar(255) NOT NULL,
            filename_avif varchar(255) NOT NULL,
            filename_webp varchar(255) NOT NULL,
            filename_jpeg varchar(255) NOT NULL,
            width int NOT NULL,
            height int NOT NULL,
            original_width int DEFAULT NULL,
            original_height int DEFAULT NULL,
            title varchar(255) DEFAULT NULL,
            description text,
            user_filename varchar(255) DEFAULT NULL,
            share_key varchar(255) DEFAULT NULL,
            topic varchar(255) NOT NULL,
            capture_date datetime DEFAULT NULL,
            camera_model varchar(255) DEFAULT NULL,
            lens_model varchar(255) DEFAULT NULL,
            iso int DEFAULT NULL,
            f_number float DEFAULT NULL,
            exposure_time varchar(255) DEFAULT NULL,
            focal_length float DEFAULT NULL,
            latitude double DEFAULT NULL,
            longitude double DEFAULT NULL,
            color_space varchar(255) DEFAULT NULL,
            white_balance varchar(50) DEFAULT NULL,
            metering_mode varchar(50) DEFAULT NULL,
            exposure_compensation varchar(20) DEFAULT NULL,
            exposure_program varchar(50) DEFAULT NULL,
            flash varchar(50) DEFAULT NULL,
            bit_depth int DEFAULT NULL,
            original_format varchar(10) DEFAULT NULL,
            original_file_size bigint DEFAULT NULL,
            blur_data_url text,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            processed boolean DEFAULT false,
            PRIMARY KEY (id),
            UNIQUE KEY images_share_key_unique (share_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureColumn(connection, dbName, 'images', 'user_filename', 'ALTER TABLE images ADD COLUMN user_filename varchar(255) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'white_balance', 'ALTER TABLE images ADD COLUMN white_balance varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'metering_mode', 'ALTER TABLE images ADD COLUMN metering_mode varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'exposure_compensation', 'ALTER TABLE images ADD COLUMN exposure_compensation varchar(20) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'exposure_program', 'ALTER TABLE images ADD COLUMN exposure_program varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'flash', 'ALTER TABLE images ADD COLUMN flash varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'bit_depth', 'ALTER TABLE images ADD COLUMN bit_depth int DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'original_format', 'ALTER TABLE images ADD COLUMN original_format varchar(10) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'original_file_size', 'ALTER TABLE images ADD COLUMN original_file_size bigint DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'blur_data_url', 'ALTER TABLE images ADD COLUMN blur_data_url text');

    const captureDateInfo = await columnInfo(connection, dbName, 'images', 'capture_date');
    if (captureDateInfo && captureDateInfo.DATA_TYPE !== 'datetime') {
        await connection.query('ALTER TABLE images MODIFY COLUMN capture_date datetime DEFAULT NULL');
    }

    const latitudeInfo = await columnInfo(connection, dbName, 'images', 'latitude');
    if (latitudeInfo && latitudeInfo.DATA_TYPE !== 'double') {
        await connection.query('ALTER TABLE images MODIFY COLUMN latitude double DEFAULT NULL');
    }

    const longitudeInfo = await columnInfo(connection, dbName, 'images', 'longitude');
    if (longitudeInfo && longitudeInfo.DATA_TYPE !== 'double') {
        await connection.query('ALTER TABLE images MODIFY COLUMN longitude double DEFAULT NULL');
    }

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS shared_groups (
            id int NOT NULL AUTO_INCREMENT,
            \`key\` varchar(255) NOT NULL,
            view_count int NOT NULL DEFAULT 0,
            expires_at datetime DEFAULT NULL,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY shared_groups_key_unique (\`key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await ensureColumn(connection, dbName, 'shared_groups', 'view_count', 'ALTER TABLE shared_groups ADD COLUMN view_count int NOT NULL DEFAULT 0');
    await ensureColumn(connection, dbName, 'shared_groups', 'expires_at', 'ALTER TABLE shared_groups ADD COLUMN expires_at datetime DEFAULT NULL');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS topic_aliases (
            alias varchar(255) NOT NULL,
            topic_slug varchar(255) NOT NULL,
            PRIMARY KEY (alias)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS sessions (
            id varchar(255) NOT NULL,
            user_id int NOT NULL,
            expires_at timestamp NOT NULL,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS audit_log (
            id int NOT NULL AUTO_INCREMENT,
            user_id int DEFAULT NULL,
            action varchar(64) NOT NULL,
            target_type varchar(64) DEFAULT NULL,
            target_id varchar(128) DEFAULT NULL,
            ip varchar(45) DEFAULT NULL,
            metadata text,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS rate_limit_buckets (
            ip varchar(45) NOT NULL,
            bucket_type varchar(20) NOT NULL,
            bucket_start bigint NOT NULL,
            count int NOT NULL DEFAULT 1,
            PRIMARY KEY (ip, bucket_type, bucket_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS image_tags (
            image_id int NOT NULL,
            tag_id int NOT NULL,
            UNIQUE KEY image_tags_image_id_tag_id_unique (image_id, tag_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS shared_group_images (
            group_id int NOT NULL,
            image_id int NOT NULL,
            position int NOT NULL DEFAULT 0,
            UNIQUE KEY shared_group_images_group_id_image_id_unique (group_id, image_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const addedPosition = await ensureColumn(connection, dbName, 'shared_group_images', 'position', 'ALTER TABLE shared_group_images ADD COLUMN position int NOT NULL DEFAULT 0');
    if (addedPosition) {
        await connection.query(`
            UPDATE shared_group_images AS sgi
            JOIN (
                SELECT group_id, image_id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY image_id) - 1 AS computed_position
                FROM shared_group_images
            ) AS ordered
              ON ordered.group_id = sgi.group_id AND ordered.image_id = sgi.image_id
            SET sgi.position = ordered.computed_position
            WHERE sgi.position = 0
        `);
    }

    await ensureIndex(connection, dbName, 'image_tags', 'idx_image_tags_tag_id', 'CREATE INDEX idx_image_tags_tag_id ON image_tags (tag_id)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_processed_capture_date', 'CREATE INDEX idx_images_processed_capture_date ON images (processed, capture_date, created_at)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_processed_created_at', 'CREATE INDEX idx_images_processed_created_at ON images (processed, created_at)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_topic', 'CREATE INDEX idx_images_topic ON images (topic, processed, capture_date, created_at)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_user_filename', 'CREATE INDEX idx_images_user_filename ON images (user_filename)');
    await ensureIndex(connection, dbName, 'audit_log', 'audit_user_idx', 'CREATE INDEX audit_user_idx ON audit_log (user_id, created_at)');
    await ensureIndex(connection, dbName, 'audit_log', 'audit_action_idx', 'CREATE INDEX audit_action_idx ON audit_log (action, created_at)');
    await ensureIndex(connection, dbName, 'audit_log', 'audit_created_at_idx', 'CREATE INDEX audit_created_at_idx ON audit_log (created_at)');
    await ensureIndex(connection, dbName, 'sessions', 'idx_sessions_expires_at', 'CREATE INDEX idx_sessions_expires_at ON sessions (expires_at)');
    await ensureIndex(connection, dbName, 'shared_group_images', 'idx_shared_group_images_group_position', 'CREATE INDEX idx_shared_group_images_group_position ON shared_group_images (group_id, position)');

    await ensureForeignKey(connection, dbName, 'images', 'images_topic_topics_slug_fk', 'ALTER TABLE images ADD CONSTRAINT images_topic_topics_slug_fk FOREIGN KEY (topic) REFERENCES topics(slug) ON DELETE RESTRICT');
    await ensureForeignKey(connection, dbName, 'image_tags', 'image_tags_image_id_images_id_fk', 'ALTER TABLE image_tags ADD CONSTRAINT image_tags_image_id_images_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'image_tags', 'image_tags_tag_id_tags_id_fk', 'ALTER TABLE image_tags ADD CONSTRAINT image_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'shared_group_images', 'shared_group_images_group_id_shared_groups_id_fk', 'ALTER TABLE shared_group_images ADD CONSTRAINT shared_group_images_group_id_shared_groups_id_fk FOREIGN KEY (group_id) REFERENCES shared_groups(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'shared_group_images', 'shared_group_images_image_id_images_id_fk', 'ALTER TABLE shared_group_images ADD CONSTRAINT shared_group_images_image_id_images_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'topic_aliases', 'topic_aliases_topic_slug_topics_slug_fk', 'ALTER TABLE topic_aliases ADD CONSTRAINT topic_aliases_topic_slug_topics_slug_fk FOREIGN KEY (topic_slug) REFERENCES topics(slug) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'sessions', 'sessions_user_id_admin_users_id_fk', 'ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_admin_users_id_fk FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'audit_log', 'audit_log_user_id_admin_users_id_fk', 'ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_admin_users_id_fk FOREIGN KEY (user_id) REFERENCES admin_users(id)');
}

async function baselineLatestMigrationIfNeeded(connection, latestMigration) {
    const latestRecorded = await getLatestRecordedMigration(connection);
    if (latestRecorded && Number(latestRecorded.created_at) >= latestMigration.folderMillis) {
        return false;
    }

    await connection.query(
        'INSERT INTO __drizzle_migrations (`hash`, `created_at`) VALUES (?, ?)',
        [latestMigration.hash, latestMigration.folderMillis]
    );
    console.log(`[Migration] Baseline recorded for ${latestMigration.tag}.`);
    return true;
}

async function prepareLegacyDatabaseIfNeeded(connection, dbName, latestMigration) {
    await ensureMigrationTable(connection);
    const hasGalleryTables = await hasAnyGalleryTables(connection, dbName);
    if (!hasGalleryTables) {
        return;
    }

    const latestRecorded = await getLatestRecordedMigration(connection);
    if (latestRecorded && Number(latestRecorded.created_at) >= latestMigration.folderMillis) {
        return;
    }

    await reconcileLegacySchema(connection, dbName);
    await baselineLatestMigrationIfNeeded(connection, latestMigration);
}

async function runMigrations(connection, migrationsFolder) {
    const db = drizzle(connection);
    console.log(`[Migration] Applying committed migrations from ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
}

async function seedAdmin(connection) {
    console.log('[Migration] Checking admin user...');
    const [rows] = await connection.query('SELECT id FROM admin_users WHERE username = ?', ['admin']);

    if (rows.length > 0) {
        console.log('[Migration] Admin user already exists.');
        return;
    }

    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
        throw new Error('ADMIN_PASSWORD must be set explicitly before running migrations.');
    }
    assertStrongBootstrapPassword(password);

    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await connection.query('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
    console.log('[Migration] Admin user created.');
}

(async () => {
    const appRoot = resolveAppRoot();
    migrateLegacyOriginalUploads(appRoot);
    assertLegacyOriginalUploadsCleared(appRoot);
    const migrationsFolder = path.join(appRoot, 'drizzle');
    const dbName = getRequiredEnv('DB_NAME');
    const latestMigration = getLatestMigration(migrationsFolder);
    let connection;

    try {
        console.log('[Migration] Starting migration...');
        connection = await mysql.createConnection(getMysqlConnectionOptions({
            database: dbName,
        }));

        await prepareLegacyDatabaseIfNeeded(connection, dbName, latestMigration);
        await runMigrations(connection, migrationsFolder);
        await seedAdmin(connection);
        console.log('[Migration] Complete.');
    } catch (error) {
        console.error('[Migration] Failed:', formatError(error));
        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end().catch(() => {});
        }
    }

    if (process.exitCode) {
        process.exit(process.exitCode);
    }
})();
